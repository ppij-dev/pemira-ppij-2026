import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import lockSql from "../migrations/0003_election_lock.sql?raw";
import memberNumberSql from "../migrations/0008_member_number.sql?raw";
import categorySql from "../migrations/0009_voter_category.sql?raw";
import canVoteSql from "../migrations/0010_voter_can_vote.sql?raw";
import liveRollSql from "../migrations/0015_live_voter_roll.sql?raw";
import { app } from "../src/server/app";
import { sealSession } from "../src/server/auth/session";
import { daftarPemilihStatement, kordaKomsatLabels, type PemilihRollRow } from "../src/server/pemilih/daftar";
import pemilihPage from "../src/pages/admin/pemilih.astro?raw";
import { verifyChain, type AuditRow } from "../src/server/lib/audit";

declare module "*.sql?raw" { const sql: string; export default sql; }
declare module "*.astro?raw" { const source: string; export default source; }

const MASTER_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const SCOPE = "/ppij/okayama";
const bindings = { DB: env.DB, APP_MASTER_KEY: MASTER_KEY };

async function sessionCookie(memberId: string, name = memberId, affiliation: string | string[] | null = SCOPE) {
  const value = await sealSession({ member_id: memberId, name, affiliation, auth_time: Math.floor(Date.now() / 1000) }, MASTER_KEY);
  return `ppij_session=${value}`;
}
async function request(path: string, memberId: string | null, init: RequestInit = {}, affiliation: string | string[] | null = SCOPE) {
  const headers = new Headers(init.headers);
  if (memberId) headers.set("cookie", await sessionCookie(memberId, memberId === "admin-1" ? "Admin Satu" : memberId, affiliation));
  return app.request(path, { ...init, headers }, bindings);
}

const UNITS = [
  ["'/ppij','PPI Jepang','','national'"],
  ["'/ppij/okayama','Korda Okayama','/ppij','korda'"],
  ["'/ppij/okayama/komsat-momotaro','Komsat Momotaro','/ppij/okayama','komsat'"],
  ["'/ppij/okayama/komsat-shirayuki','Komsat Shirayuki','/ppij/okayama','komsat'"],
  ["'/ppij/kobe','Korda Kobe','/ppij','korda'"],
  ["'/ppij/kobe/komsat-akashi','Komsat Akashi','/ppij/kobe','komsat'"],
].map((tuple) => `INSERT INTO units (path,name,parent_path,type) VALUES (${tuple[0]})`);

/** 135 pemilih deterministik: 90 Okayama (dua komsat), 45 Kobe — lebih dari dua halaman 50 baris. */
function seedVoters(): { memberId: string; name: string; path: string; voted: boolean }[] {
  const voters = [];
  for (let i = 1; i <= 135; i++) {
    const path = i <= 45 ? `${SCOPE}/komsat-momotaro` : i <= 90 ? `${SCOPE}/komsat-shirayuki` : `/ppij/kobe/komsat-akashi`;
    // Nama berurutan A…Z, AA…: memaksa urutan ORDER BY v.name berbeda dari urutan id.
    const name = `Pemilih ${String(Math.floor((i - 1) / 26)).repeat(Math.floor((i - 1) / 26))}${String.fromCharCode(65 + ((i - 1) % 26))}`;
    voters.push({ memberId: `member-${String(i).padStart(4, "0")}`, name, path, voted: i % 3 === 0 });
  }
  return voters;
}

beforeEach(async () => {
  await reset();
  const statements = [initSql, unitsSql, lockSql, memberNumberSql, categorySql, canVoteSql, liveRollSql].join(";").split(";").map((statement) => statement.trim()).filter(Boolean);
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO system_config (key,value) VALUES ('initialized','1'),('site_scope',?)").bind(SCOPE),
    env.DB.prepare("INSERT INTO elections (title,status_lock,opens_at,closes_at) VALUES ('Pemilihan Uji','locked',?,?)").bind(new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 3600_000).toISOString()),
    env.DB.prepare("INSERT INTO admin_voting (member_id,name,is_technical,created_at) VALUES ('admin-1','Admin Satu',1,?)").bind(new Date().toISOString()),
    ...UNITS.map((sql) => env.DB.prepare(sql)),
  ]);
  const voters = seedVoters();
  await env.DB.batch([
    // Admin Voting juga ada di roll supaya nama auditnya nama resmi roll.
    env.DB.prepare("INSERT INTO voters (member_id,name,member_number,category,can_vote,komsat_path,status,synced_at) VALUES ('admin-1','Admin Satu','OKA-2026-9999','BIASA',1,?,'ACTIVE',?)").bind(`${SCOPE}/komsat-momotaro`, new Date().toISOString()),
    ...voters.map((voter) =>
    env.DB.prepare("INSERT INTO voters (member_id,name,member_number,category,can_vote,komsat_path,status,synced_at) VALUES (?,?,?,?,?,?, 'ACTIVE', ?)")
      .bind(voter.memberId, voter.name, `OKA-2026-${voter.memberId.slice(-4)}`, "BIASA", 1, voter.path, new Date().toISOString())),
  ]);
  const election = await env.DB.prepare("SELECT id FROM elections ORDER BY id LIMIT 1").first<{ id: number }>();
  await env.DB.batch(voters.filter((voter) => voter.voted).map((voter) =>
    env.DB.prepare("INSERT INTO participation (election_id,member_id,member_name,voted_at) VALUES (?,?,?,?)")
      .bind(election!.id, voter.memberId, voter.name, "2026-11-24T10:00:00.000Z"),
  ));
});

async function auditRows() {
  const { results } = await env.DB.prepare("SELECT seq,at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash FROM audit_log ORDER BY seq").all<AuditRow>();
  expect(await verifyChain(results)).toBeNull();
  return results;
}

/** Baris halaman: halaman 50 baris berurutan dari penyusun bersama, sampai habis. */
async function pageConcat(filter: { q: string; komsat: string; status: string }): Promise<PemilihRollRow[]> {
  const pages: PemilihRollRow[] = [];
  for (let offset = 0; ; offset += 50) {
    const page = await daftarPemilihStatement(env.DB, filter, { limit: 50, offset }).all<PemilihRollRow>();
    pages.push(...page.results);
    if (page.results.length < 50) break;
  }
  return pages;
}

describe("GET /api/admin/pemilih/export", () => {
  const FILTERS = [
    { q: "", komsat: "", status: "" },
    { q: "C", komsat: "", status: "" },
    { q: "", komsat: `${SCOPE}/komsat-shirayuki`, status: "" },
    { q: "", komsat: "", status: "voted" },
    { q: "", komsat: "", status: "not-voted" },
    { q: "Pemilih", komsat: `${SCOPE}/komsat-momotaro`, status: "voted" },
  ];

  it("setiap kombinasi filter: baris ekspor sama dengan gabungan semua halaman, urutan sama", async () => {
    for (const filter of FILTERS) {
      const response = await request(`/api/admin/pemilih/export?q=${encodeURIComponent(filter.q)}&komsat=${encodeURIComponent(filter.komsat)}&status=${filter.status}`, "admin-1");
      expect(response.status).toBe(200);
      const payload = await response.json() as { jumlah: number; rows: { name: string; member_number: string | null; kategori: string; korda: string; komsat: string; voted: number; voted_at: string | null }[] };
      const expected = await pageConcat(filter);
      expect(payload.jumlah).toBe(expected.length);
      expect(payload.rows.map((row) => row.name)).toEqual(expected.map((row) => row.name));
      // Angka pembanding independen: jumlah dari SQL mentah.
      const raw = await env.DB.prepare("SELECT COUNT(*) AS n FROM voters v LEFT JOIN participation p ON p.member_id=v.member_id AND p.election_id=(SELECT MAX(id) FROM elections) WHERE (?='' OR v.name LIKE ?) AND (?='' OR v.komsat_path=?) AND (?='' OR (?='voted' AND p.member_id IS NOT NULL) OR (?='not-voted' AND p.member_id IS NULL))")
        .bind(filter.q, filter.q ? `%${filter.q}%` : "", filter.komsat, filter.komsat, filter.status, filter.status, filter.status).first<{ n: number }>();
      expect(payload.jumlah).toBe(raw?.n);
      expect(payload.jumlah).toBeGreaterThan(0);
    }
    // Filter khusus benar-benar memilah (bukan seluruh roll yang sama).
    const all = await request("/api/admin/pemilih/export", "admin-1").then((response) => response.json() as Promise<{ jumlah: number }>);
    const voted = await request("/api/admin/pemilih/export?status=voted", "admin-1").then((response) => response.json() as Promise<{ jumlah: number }>);
    expect(voted.jumlah).toBeLessThan(all.jumlah);
    expect(all.jumlah).toBe(136); // 135 pemilih uji + 1 baris roll Admin Voting
  });

  it("label Kategori, Korda dan Komsat sama dengan tampilan halaman", async () => {
    const response = await request("/api/admin/pemilih/export", "admin-1");
    const payload = await response.json() as { rows: { name: string; korda: string; komsat: string; kategori: string; voted: number; voted_at: string | null }[] };
    // Pemecahan Korda/Komsat per kelompok komsat, dengan nama resmi units.
    const byKomsat = (komsat: string) => payload.rows.filter((row) => row.komsat === komsat);
    expect(byKomsat("Komsat Momotaro").length).toBeGreaterThan(0);
    expect(byKomsat("Komsat Momotaro").every((row) => row.korda === "Korda Okayama" && row.kategori === "Anggota Biasa")).toBe(true);
    expect(byKomsat("Komsat Shirayuki").every((row) => row.korda === "Korda Okayama")).toBe(true);
    const akashi = byKomsat("Komsat Akashi");
    expect(akashi.length).toBeGreaterThan(0);
    expect(akashi.every((row) => row.korda === "Korda Kobe")).toBe(true);
    // Pemisahan memakai helper yang sama (nama unit portal per ruas jalur).
    const names = await env.DB.prepare("SELECT path,name FROM units").all<{ path: string; name: string }>();
    const unitNames = Object.fromEntries(names.results.map((unit) => [unit.path, unit.name]));
    const split = kordaKomsatLabels("/ppij/kobe/komsat-akashi", unitNames);
    expect(split).toEqual({ korda: "Korda Kobe", komsat: "Komsat Akashi" });
    // Yang sudah memilih punya waktu; yang belum kosong (keputusan owner Q245).
    expect(payload.rows.filter((row) => row.voted).every((row) => row.voted_at !== null && row.voted_at !== "")).toBe(true);
    expect(payload.rows.filter((row) => !row.voted).every((row) => row.voted_at === null)).toBe(true);
  });

  it("non-admin mendapat 403 tanpa baris dan tanpa entri audit", async () => {
    const anonymous = await request("/api/admin/pemilih/export", null);
    expect(anonymous.status).toBe(403);
    const outsider = await request("/api/admin/pemilih/export", "bukan-panitia");
    expect(outsider.status).toBe(403);
    expect(((await anonymous.json()) as { error: string }).error).toBe("admin_voting_tidak_aktif_atau_tidak_dalam_cakupan");
    expect(await auditRows()).toEqual([]);
  });

  it("ekspor berhasil menulis SATU entri audit dengan filter dan jumlah saja — tanpa data anggota", async () => {
    const response = await request("/api/admin/pemilih/export?status=voted&komsat=" + encodeURIComponent(`${SCOPE}/komsat-momotaro`), "admin-1");
    expect(response.status).toBe(200);
    const payload = await response.json() as { jumlah: number };
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    const entry = rows[0];
    expect(entry.action).toBe("Daftar Pemilih diunduh");
    expect(entry.actor_type).toBe("admin");
    expect(entry.actor_member_id).toBe("admin-1");
    expect(entry.actor_name).toBe("Admin Satu");
    expect(entry.target).toBeNull();
    expect(entry.komsat_path).toBeNull();
    const detail = JSON.parse(entry.detail_json ?? "") as { filter: { q: string; komsat: string; status: string }; jumlah: number };
    expect(detail).toEqual({ filter: { q: "", komsat: `${SCOPE}/komsat-momotaro`, status: "voted" }, jumlah: payload.jumlah });
    // Tanpa nama atau nomor kartu anggota mana pun di seluruh entri.
    for (const voter of seedVoters()) {
      expect(entry.detail_json).not.toContain(voter.name);
      expect(entry.detail_json).not.toContain(voter.memberId);
    }
    expect(entry.detail_json).not.toContain("OKA-2026");
  });

  it("mode roll hidup: segarkan view portal lewat jalur halaman, portal gagal tetap 200", async () => {
    // live_voter_roll menyala dan pemilihan Dibuka: endpoint memanggil
    // refreshPortalViewForRead seperti halaman; tanpa SERVICE_API_URL tidak ada
    // percobaan, dan kegagalan portal tidak pernah menjadi 500.
    await env.DB.prepare("UPDATE elections SET live_voter_roll = 1").run();
    const response = await request("/api/admin/pemilih/export?status=not-voted", "admin-1");
    expect(response.status).toBe(200);
    const payload = await response.json() as { jumlah: number };
    expect(payload.jumlah).toBeGreaterThan(0);
  });
});

describe("Halaman Daftar Pemilih: tombol Unduh Excel terpasang dan tersambung", () => {
  it("memakai penyusun kueri bersama (tanpa SQL LIMIT/OFFSET inline)", () => {
    expect(pemilihPage).toContain("daftarPemilihStatement(db, { q, komsat, status: filter }, { limit: 50, offset: (page - 1) * 50 })");
    expect(pemilihPage).toContain("loadUnitNames(db)");
    expect(pemilihPage).not.toContain("LIMIT 50 OFFSET");
    expect(pemilihPage).not.toContain("ORDER BY v.name LIMIT");
  });

  it("tombol Unduh Excel ada di samping filter dan terhubung ke endpoint", () => {
    expect(pemilihPage).toContain('id="export"');
    expect(pemilihPage).toContain("Unduh Excel");
    expect(pemilihPage).toContain("/api/admin/pemilih/export?");
    expect(pemilihPage).toContain("write-excel-file/browser");
    expect(pemilihPage).toContain("window.withBusy(exportButton");
    // Lembar Pemilih dengan tujuh kolom dan lembar Filter.
    expect(pemilihPage).toContain('["Nama", "Nomor kartu", "Kategori", "Korda", "Komsat", "Status", "Waktu memilih"]');
    expect(pemilihPage).toContain('sheet: "Pemilih"');
    expect(pemilihPage).toContain('sheet: "Filter"');
    expect(pemilihPage).toContain('"Jumlah baris"');
    // Nama berkas dan waktu JST (keputusan owner Q245).
    expect(pemilihPage).toContain("`daftar-pemilih-${word}-${jstDate()}.xlsx`");
    expect(pemilihPage).toContain('timeZone: "Asia/Tokyo"');
    // Toast bersama: sukses "N pemilih diunduh.", galat teks galat server.
    expect(pemilihPage).toContain("`${rows.length} pemilih diunduh.`");
    expect(pemilihPage).toContain("window.toast(serverError ?? `Daftar Pemilih gagal diunduh (${response.status}). Coba lagi.`");
    // Hanya dirender untuk Admin Voting, seperti pola Undangan.
    expect(pemilihPage).toMatch(/\{authorized && <script>/);
  });
});
