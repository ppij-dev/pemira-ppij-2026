import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import lockSql from "../migrations/0003_election_lock.sql?raw";
import limitsSql from "../migrations/0004_vote_limits.sql?raw";
import snapshotSql from "../migrations/0005_closing_snapshot.sql?raw";
import previewModeSql from "../migrations/0006_preview_mode.sql?raw";
import memberNumberSql from "../migrations/0008_member_number.sql?raw";
import canVoteSql from "../migrations/0010_voter_can_vote.sql?raw";
import singleModeSql from "../migrations/0011_single_candidate_mode.sql?raw";
import ballotChoiceSql from "../migrations/0012_ballot_choice.sql?raw";
import ballotAbstainSql from "../migrations/0013_ballot_choice_abstain.sql?raw";
import abstainCountedSql from "../migrations/0014_abstain_counted.sql?raw";
import liveRollSql from "../migrations/0015_live_voter_roll.sql?raw";
import closingHakPilihSql from "../migrations/0016_closing_hak_pilih.sql?raw";
import directInvitationsSql from "../migrations/0017_direct_invitations.sql?raw";
import recapSql from "../migrations/0019_election_recap.sql?raw";
import { app } from "../src/server/app";
import { sealSession } from "../src/server/auth/session";
import { runRecap } from "../src/server/election/lifecycle";
import { getRecapPayload, RECAP_LINK_REMAINDER_LABEL, RECAP_UNMATCHED_KOMSAT_LABEL } from "../src/server/results/recap";
import { verifyChain, type AuditRow } from "../src/server/lib/audit";
import type { RecapPayload } from "../src/server/results/recap";

declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}

/**
 * Kalkulator rujukan yang independen dari kode aplikasi: SQL polos atas tabel
 * mentah plus penggulokan jalur di JS. Setiap angka pada setiap tab pembanding
 * payload rekap dihitung ulang di sini, tanpa memakai helper aplikasi.
 */
const UNKNOWN = "/tidak-diketahui";
function refRegionKey(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) return `/${parts[0]}/${parts[1]}`;
  if (parts.length === 1) return `/${parts[0]}`;
  return UNKNOWN;
}
const refPct = (used: number, total: number) => (total > 0 ? Math.round((used / total) * 1000) / 10 : null);
/** Label jalur komsat gaya aplikasi: nama unit portal per ruas, akar /ppij dibuang. */
function refPathLabel(path: string, unitNames: Map<string, string>): string {
  const parts = path.split("/").filter(Boolean);
  let acc = "/" + parts[0];
  return parts
    .slice(1)
    .map((part) => {
      acc = `${acc}/${part}`;
      return unitNames.get(acc) ?? part.replace(/[-_]+/g, " ").replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    })
    .join(" · ");
}

interface RefSummary {
  dpt_source: string;
  total_dpt: number;
  invites_created: number;
  invites_cancelled: number;
  invites_used: number;
  invites_unused: number;
  dpt_final: number;
  votes_used: number;
  ballot_count: number;
  setuju: number;
  tidak_setuju: number;
  /** Abstain tampilan: jawaban Abstain surat suara lama + angka tersimpan rekap. */
  abstain: number;
  /** Abstain tersimpan rekap: Hak pilih dikurangi partisipasi. */
  abstain_stored: number;
}
interface RefData {
  summary: RefSummary;
  korda: { name: string; hak_pilih: number; used: number; participation_pct: number | null }[];
  komsat: { korda: string; name: string; hak_pilih: number; used: number; participation_pct: number | null }[];
  ballots: { receipt_hash: string; choice: string }[];
  abstain: { name: string; member_number: string | null; korda: string; komsat: string }[];
}

async function reference(): Promise<RefData> {
  const db = env.DB;
  const e = (await db.prepare("SELECT * FROM elections WHERE id = 1").first<{
    allow_admin_voting: number;
    live_voter_roll: number;
    frozen_hak_pilih: number | null;
    closing_hak_pilih: number | null;
    recap_abstain_count: number | null;
  }>())!;
  const adminFilter = e.allow_admin_voting === 0 ? " AND member_id NOT IN (SELECT member_id FROM admin_voting)" : "";
  const roll = (await db.prepare(`SELECT COUNT(*) AS n FROM voters WHERE can_vote = 1${adminFilter}`).first<{ n: number }>())!.n;
  const invites = await db.prepare(
    "SELECT COUNT(*) AS created, SUM(CASE WHEN cancelled_at IS NOT NULL THEN 1 ELSE 0 END) AS cancelled, SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END) AS used, SUM(CASE WHEN used_at IS NULL AND cancelled_at IS NULL THEN 1 ELSE 0 END) AS unused FROM direct_invitations",
  ).first<{ created: number; cancelled: number | null; used: number | null; unused: number | null }>()!;
  const activeLinks = invites.created - (invites.cancelled ?? 0);
  let hakPilih: number;
  let source: string;
  if (e.live_voter_roll === 1 && e.closing_hak_pilih != null) {
    hakPilih = e.closing_hak_pilih;
    source = "closing";
  } else if (e.live_voter_roll === 1 || e.frozen_hak_pilih == null) {
    hakPilih = roll + activeLinks;
    source = e.live_voter_roll === 1 ? "live" : "live";
  } else {
    hakPilih = e.frozen_hak_pilih + activeLinks;
    source = "frozen";
  }
  const participation = (await db.prepare("SELECT COUNT(*) AS n FROM participation WHERE election_id = 1 AND is_test = 0").first<{ n: number }>())!.n;
  const ballots = await db.prepare("SELECT receipt_hash, choice FROM ballots WHERE election_id = 1 AND is_test = 0 ORDER BY receipt_hash").all<{ receipt_hash: string; choice: string | null }>();
  const choices = await db.prepare("SELECT choice, COUNT(*) AS n FROM ballots WHERE election_id = 1 AND is_test = 0 AND choice IS NOT NULL GROUP BY choice").all<{ choice: string; n: number }>();
  const setuju = choices.results.find((row) => row.choice === "setuju")?.n ?? 0;
  const tidakSetuju = choices.results.find((row) => row.choice === "tidak_setuju")?.n ?? 0;
  const abstainCast = choices.results.find((row) => row.choice === "abstain")?.n ?? 0;
  const abstainStored = hakPilih - participation;
  const abstainDisplayed = abstainStored + abstainCast;

  const votersByPath = (await db.prepare(`SELECT komsat_path AS path, COUNT(*) AS n FROM voters WHERE can_vote = 1${adminFilter} GROUP BY komsat_path`).all<{ path: string; n: number }>()).results;
  const participationByPath = (await db.prepare("SELECT v.komsat_path AS path, COUNT(*) AS n FROM participation p JOIN voters v ON v.member_id = p.member_id WHERE p.election_id = 1 AND p.is_test = 0 GROUP BY v.komsat_path").all<{ path: string; n: number }>()).results;
  const usedInviteByPath = (await db.prepare("SELECT komsat_path AS path, COUNT(*) AS n FROM direct_invitations WHERE cancelled_at IS NULL AND used_at IS NOT NULL GROUP BY komsat_path").all<{ path: string; n: number }>()).results;
  const units = (await db.prepare("SELECT path, name, parent_path, type FROM units").all<{ path: string; name: string; parent_path: string | null; type: string }>()).results;
  const unitNames = new Map(units.map((u) => [u.path, u.name]));

  const bucket = <T>(rows: { path: string; n: number }[], into: Map<string, T>, add: (bucket: T, n: number) => void, make: (key: string) => T) => {
    for (const row of rows) {
      const key = refRegionKey(row.path);
      if (!into.has(key)) into.set(key, make(key));
      add(into.get(key)!, row.n);
    }
  };
  // Korda: Hak pilih = roll + tautan terpakai per wilayah; digunakan = partisipasi + tautan terpakai.
  const kordaMap = new Map<string, { name: string; hak_pilih: number; used: number }>();
  for (const unit of units.filter((u) => u.type === "korda")) kordaMap.set(unit.path, { name: unit.name, hak_pilih: 0, used: 0 });
  bucket(votersByPath, kordaMap, (b, n) => (b.hak_pilih += n), (key) => ({ name: unitNames.get(key) ?? "Tidak diketahui", hak_pilih: 0, used: 0 }));
  bucket(usedInviteByPath, kordaMap, (b, n) => { b.hak_pilih += n; b.used += n; }, (key) => ({ name: unitNames.get(key) ?? "Tidak diketahui", hak_pilih: 0, used: 0 }));
  bucket(participationByPath, kordaMap, (b, n) => (b.used += n), (key) => ({ name: unitNames.get(key) ?? "Tidak diketahui", hak_pilih: 0, used: 0 }));
  const korda = [...kordaMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, b]) => ({ name: b.name, hak_pilih: b.hak_pilih, used: b.used, participation_pct: refPct(b.used, b.hak_pilih) }));
  if ((invites.unused ?? 0) > 0) korda.push({ name: RECAP_LINK_REMAINDER_LABEL, hak_pilih: invites.unused ?? 0, used: 0, participation_pct: null });

  // Komsat: kecocokan jalur eksak; jalur di luar daftar jadi satu baris sisa.
  const komsatMap = new Map<string, { korda: string; name: string; hak_pilih: number; used: number }>();
  for (const unit of units.filter((u) => u.type === "komsat")) {
    komsatMap.set(unit.path, {
      korda: unit.parent_path ? unitNames.get(unit.parent_path) ?? unit.parent_path : unit.path,
      name: unitNames.get(unit.path) ?? unit.path,
      hak_pilih: 0,
      used: 0,
    });
  }
  let unmatchedHak = 0;
  let unmatchedUsed = 0;
  const exact = (rows: { path: string; n: number }[], kind: "hak" | "used") => {
    for (const row of rows) {
      const target = komsatMap.get(row.path);
      if (target) { if (kind === "hak") target.hak_pilih += row.n; else target.used += row.n; }
      else if (kind === "hak") unmatchedHak += row.n;
      else unmatchedUsed += row.n;
    }
  };
  exact(votersByPath, "hak");
  exact(participationByPath, "used");
  // Tautan terpakai menambah Hak pilih sekaligus digunakan di komsat pilihannya.
  for (const row of usedInviteByPath) {
    const target = komsatMap.get(row.path);
    if (target) { target.hak_pilih += row.n; target.used += row.n; }
    else { unmatchedHak += row.n; unmatchedUsed += row.n; }
  }
  const komsat = [...komsatMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, b]) => ({ korda: b.korda, name: b.name, hak_pilih: b.hak_pilih, used: b.used, participation_pct: refPct(b.used, b.hak_pilih) }));
  if ((invites.unused ?? 0) > 0) komsat.push({ korda: "—", name: RECAP_LINK_REMAINDER_LABEL, hak_pilih: invites.unused ?? 0, used: 0, participation_pct: null });
  if (unmatchedHak > 0 || unmatchedUsed > 0) komsat.push({ korda: "—", name: RECAP_UNMATCHED_KOMSAT_LABEL, hak_pilih: unmatchedHak, used: unmatchedUsed, participation_pct: refPct(unmatchedUsed, unmatchedHak) });

  const nonVoters = (await db.prepare(
    `SELECT name, member_number, komsat_path FROM voters WHERE can_vote = 1${adminFilter} AND member_id NOT IN (SELECT member_id FROM participation WHERE election_id = 1 AND is_test = 0) ORDER BY name`,
  ).all<{ name: string; member_number: string | null; komsat_path: string }>()).results;
  const unusedLinks = (await db.prepare("SELECT reference FROM direct_invitations WHERE used_at IS NULL AND cancelled_at IS NULL ORDER BY reference").all<{ reference: string }>()).results;
  const abstain = [
    ...nonVoters.map((row) => ({
      name: row.name,
      member_number: row.member_number,
      korda: unitNames.get(refRegionKey(row.komsat_path)) ?? refRegionKey(row.komsat_path),
      komsat: refPathLabel(row.komsat_path, unitNames),
    })),
    ...unusedLinks.map((row) => ({ name: `Tautan undangan ${row.reference} (tidak dipakai)`, member_number: null, korda: "—", komsat: "—" })),
  ];

  return {
    summary: {
      dpt_source: source,
      total_dpt: source === "frozen" ? e.frozen_hak_pilih ?? roll : hakPilih - activeLinks,
      invites_created: invites.created,
      invites_cancelled: invites.cancelled ?? 0,
      invites_used: invites.used ?? 0,
      invites_unused: invites.unused ?? 0,
      dpt_final: hakPilih,
      votes_used: participation,
      ballot_count: ballots.results.length,
      setuju,
      tidak_setuju: tidakSetuju,
      abstain: abstainDisplayed,
      abstain_stored: abstainStored,
    },
    korda,
    komsat,
    ballots: ballots.results.map((row) => ({
      receipt_hash: row.receipt_hash,
      choice: row.choice === "setuju" ? "Setuju" : row.choice === "tidak_setuju" ? "Tidak Setuju" : row.choice === "abstain" ? "Abstain" : "",
    })),
    abstain,
  };
}

const MASTER_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const SCOPE = "/ppij/okayama";
const bindings = { DB: env.DB, APP_MASTER_KEY: MASTER_KEY };

async function sessionCookie(memberId = "admin-1", name = "Admin 1") {
  const value = await sealSession(
    { member_id: memberId, name, affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) },
    MASTER_KEY,
  );
  return `ppij_session=${value}`;
}

async function adminGet(path = "/api/admin/recap", memberId = "admin-1") {
  const headers = new Headers();
  headers.set("cookie", await sessionCookie(memberId));
  return app.request(path, { headers }, bindings);
}
async function adminPost(path: string, memberId = "admin-1") {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("cookie", await sessionCookie(memberId));
  return app.request(path, { method: "POST", headers, body: "{}" }, bindings);
}
async function adminDashboard(memberId = "admin-1") {
  const headers = new Headers();
  headers.set("cookie", await sessionCookie(memberId));
  return app.request("/api/dashboard", { headers }, bindings);
}

async function applyMigrations() {
  const files = [initSql, unitsSql, lockSql, limitsSql, snapshotSql, previewModeSql, memberNumberSql, canVoteSql, singleModeSql, ballotChoiceSql, ballotAbstainSql, abstainCountedSql, liveRollSql, closingHakPilihSql, directInvitationsSql, recapSql];
  for (const file of files) {
    const stmts = file.split(";").map((s) => s.trim()).filter(Boolean);
    await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
  }
}

async function seedBase() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('initialized', '1'), ('site_scope', ?), ('site_base_url', 'https://election.test')").bind(SCOPE),
    env.DB.prepare("INSERT INTO admin_voting (member_id, name, is_technical, created_at) VALUES ('admin-1', 'Admin 1', 1, ?)").bind(new Date().toISOString()),
    env.DB.prepare("INSERT INTO elections (id, title, description, status_lock, opens_at, closes_at, allow_admin_voting, single_candidate_mode) VALUES (1, 'Pemira PPIJ 2026', '', 'locked', ?, ?, 1, 1)")
      .bind(new Date(Date.now() - 7200e3).toISOString(), new Date(Date.now() - 3600e3).toISOString()),
  ]);
}

let voterSeq = 0;
async function seedVoter(name: string, path: string, opts: { canVote?: number; memberNumber?: string } = {}) {
  voterSeq += 1;
  const memberId = opts.memberNumber ?? `member-${String(voterSeq).padStart(3, "0")}`;
  await env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at, can_vote, member_number) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)")
    .bind(memberId, name, path, new Date().toISOString(), opts.canVote ?? 1, opts.memberNumber ?? `KARTU-${String(voterSeq).padStart(4, "0")}`)
    .run();
  return memberId;
}

let ballotSeq = 0;
/** Satu suara anggota roll: baris roll, partisipasi, dan surat suara. */
async function seedVote(choice: "setuju" | "tidak_setuju" | "abstain" | null, path: string) {
  ballotSeq += 1;
  const memberId = await seedVoter(`Pemilih ${ballotSeq}`, path);
  await env.DB.prepare("INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (1, ?, ?, ?, 0)")
    .bind(memberId, `Pemilih ${ballotSeq}`, new Date().toISOString()).run();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test, choice) VALUES (?, 1, 1, ?, ?, 0, ?)")
    .bind(id, path, `hash-${String(ballotSeq).padStart(4, "0")}-${id.slice(0, 8)}`, choice).run();
  return memberId;
}

/** Tautan terpakai = tamu memilih: partisipasi undangan:<ref> + surat suara (pola aplikasi nyata). */
async function castUsedInvite(reference: string, path: string, index: number) {
  const choice = index % 2 === 0 ? "setuju" : "tidak_setuju";
  ballotSeq += 1;
  await env.DB.prepare("INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (1, ?, ?, ?, 0)")
    .bind(`undangan:${reference}`, `Tamu ${reference}`, new Date().toISOString()).run();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test, choice) VALUES (?, 1, 1, ?, ?, 0, ?)")
    .bind(id, path, `hash-${reference}-${id.slice(0, 8)}`, choice).run();
}

/** Tautan: dipakai membuat tamu memilih, belum dipakai tetap menambah Hak pilih, dibatalkan tidak. */
async function seedInvite(reference: string, opts: { used?: boolean; cancelled?: boolean; komsat?: string | null } = {}, index = 0) {
  await env.DB.prepare(
    "INSERT INTO direct_invitations (reference, token_hash, token_enc, created_at, created_by, created_by_name, komsat_path, used_at, cancelled_at) VALUES (?, ?, 'v1:sealed', ?, 'admin-1', 'Admin 1', ?, ?, ?)",
  ).bind(reference, `hash-${reference}`, new Date().toISOString(), opts.used ? opts.komsat ?? null : null, opts.used ? new Date().toISOString() : null, opts.cancelled ? new Date().toISOString() : null).run();
  if (opts.used) await castUsedInvite(reference, opts.komsat!, index);
}

async function seedSingleCandidate() {
  await env.DB.prepare("INSERT INTO candidates (id, member_id, number, name, nickname, komsat_path, color) VALUES (1, 'cand-1', 1, 'Kandidat Tunggal', 'Tunggal', ?, '#c8102e')").bind(`${SCOPE}/komsat-a`).run();
}

async function seedUnits() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO units (path, name, parent_path, type) VALUES ('/ppij', 'PPI Jepang', '', 'national')"),
    env.DB.prepare("INSERT INTO units (path, name, parent_path, type) VALUES ('/ppij/okayama', 'Korda Okayama', '/ppij', 'korda'), ('/ppij/tokyo', 'Korda Tokyo', '/ppij', 'korda'), ('/ppij/kobe', 'Korda Kobe', '/ppij', 'korda'), ('/ppij/osaka', 'Korda Osaka', '/ppij', 'korda')"),
    env.DB.prepare("INSERT INTO units (path, name, parent_path, type) VALUES ('/ppij/okayama/komsat-a', 'Komsat A Okayama', '/ppij/okayama', 'komsat'), ('/ppij/okayama/komsat-b', 'Komsat B Okayama', '/ppij/okayama', 'komsat'), ('/ppij/tokyo/komsat-a', 'Komsat A Tokyo', '/ppij/tokyo', 'komsat'), ('/ppij/kobe/komsat-a', 'Komsat A Kobe', '/ppij/kobe', 'komsat')"),
  ]);
}

interface Scenario {
  /** Bekukan roll saat Kunci dengan angka roll yang sesungguhnya. */
  frozen?: boolean;
  /** Roll live tanpa dibekukan; snapshot penutupan menetapkan angkanya. */
  live?: boolean;
  /** Bekukan di tengah pemungutan setelah suara masuk. */
  freezeMidVote?: boolean;
  votes?: { choice: "setuju" | "tidak_setuju" | "abstain" | null; path: string }[];
  invites?: { reference: string; used?: boolean; cancelled?: boolean; komsat?: string | null }[];
  /** Anggota roll tambahan yang tidak memilih. */
  idleVoters?: { name: string; path: string }[];
}

/** Skenario lengkap: unit, roll, suara, tautan, lalu tutup dan rekap. */
async function seedScenario(s: Scenario) {
  await applyMigrations();
  await seedBase();
  await seedUnits();
  await seedSingleCandidate();
  if (s.live) {
    await env.DB.prepare("UPDATE elections SET live_voter_roll=1, frozen_hak_pilih=NULL, frozen_at=NULL WHERE id=1").run();
  }
  // Suara anggota roll (roll + partisipasi + surat suara), anggota roll yang
  // tidak memilih, lalu tautan (terpakai = tamu memilih lewat pola aplikasi:
  // partisipasi undangan:<ref> + surat sura). Semua roll ada sebelum pembekuan,
  // sehingga angka beku dihitung dari roll yang sesungguhnya, seperti Kunci.
  for (const vote of s.votes ?? []) await seedVote(vote.choice, vote.path);
  for (const idle of s.idleVoters ?? []) await seedVoter(idle.name, idle.path);
  for (const [index, invite] of (s.invites ?? []).entries()) await seedInvite(invite.reference, invite, index);
  if (s.frozen || s.freezeMidVote) {
    const roll = (await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE can_vote = 1").first<{ n: number }>())!.n;
    await env.DB.prepare("UPDATE elections SET live_voter_roll=0, frozen_hak_pilih=?, frozen_at=? WHERE id=1").bind(roll, new Date().toISOString()).run();
  }
}

/** Jalankan rekap lewat endpoint Admin Voting yang sesungguhnya. */
async function recapViaApi() {
  const res = await adminPost("/api/election/recap");
  expect(res.status).toBe(200);
  return (await res.json()) as { ok: true; recap_at: string; abstain_count: number };
}

function expectClose(actual: unknown, expected: unknown, label: string) {
  expect(actual, label).toEqual(expected);
}

beforeEach(async () => {
  await reset();
  voterSeq = 0;
  ballotSeq = 0;
});

const KORDA_A = `${SCOPE}/komsat-a`;
const KORDA_B = `${SCOPE}/komsat-b`;
const TOKYO_A = "/ppij/tokyo/komsat-a";
const KOBE_A = "/ppij/kobe/komsat-a";

const scenarios: Record<string, Scenario> = {
    // Roll beku di Kunci: campuran suara, tautan dipakai/belum/batal, satu korda kosong.
    frozen: {
      frozen: true,
      votes: [
        { choice: "setuju", path: KORDA_A }, { choice: "setuju", path: KORDA_A }, { choice: "tidak_setuju", path: KORDA_A },
        { choice: "setuju", path: KORDA_B }, { choice: "tidak_setuju", path: KORDA_B },
        { choice: "setuju", path: TOKYO_A }, { choice: "setuju", path: TOKYO_A }, { choice: "tidak_setuju", path: TOKYO_A },
        { choice: "setuju", path: KOBE_A },
      ],
      invites: [
        { reference: "AAA001", used: true, komsat: KORDA_A },
        { reference: "AAA002", used: true, komsat: TOKYO_A },
        { reference: "AAA003", used: true, komsat: KORDA_B },
        { reference: "AAA004", used: true, komsat: TOKYO_A },
        { reference: "AAA005", used: true, komsat: KOBE_A },
        { reference: "AAA006", used: true, komsat: KORDA_A },
        { reference: "BBB001" },
        { reference: "BBB002" },
        { reference: "CCC001", cancelled: true },
        { reference: "CCC002", cancelled: true },
      ],
      idleVoters: [
        { name: "Tidak Memilih Satu", path: KORDA_B },
        { name: "Tidak Memilih Dua", path: TOKYO_A },
      ],
    },
    // Roll live yang dibekukan di tengah pemungutan (keputusan owner 2026-11-22).
    liveFrozenMidVote: {
      live: true,
      freezeMidVote: true,
      votes: [
        { choice: "setuju", path: KORDA_A }, { choice: "tidak_setuju", path: KORDA_A },
        { choice: "setuju", path: TOKYO_A },
      ],
      invites: [
        { reference: "MID001", used: true, komsat: KORDA_A },
        { reference: "MID002", used: true, komsat: TOKYO_A },
        { reference: "MID003" },
        { reference: "MID004", cancelled: true },
      ],
      idleVoters: [{ name: "Tidak Memilih Tiga", path: KORDA_A }],
    },
    // Roll live yang tidak pernah dibekukan: snapshot penutupan menetapkan Hak pilih.
    liveNeverFrozen: {
      live: true,
      votes: [
        { choice: "setuju", path: KORDA_A }, { choice: "setuju", path: KORDA_A }, { choice: "setuju", path: KORDA_A },
        { choice: "tidak_setuju", path: TOKYO_A }, { choice: "tidak_setuju", path: TOKYO_A },
      ],
      invites: [
        { reference: "LIV001", used: true, komsat: KORDA_A },
        { reference: "LIV002", used: true, komsat: TOKYO_A },
        { reference: "LIV003" },
        { reference: "LIV004", cancelled: true },
      ],
      idleVoters: [{ name: "Tidak Memilih Empat", path: KORDA_B }],
    },
    // Korda kosong sama sekali dan komsat di bawah 10 surat suara.
    emptyKordaAndSmallKomsat: {
      frozen: true,
      votes: [
        { choice: "setuju", path: KORDA_A }, { choice: "tidak_setuju", path: KORDA_A }, { choice: "setuju", path: KORDA_B },
        { choice: "setuju", path: TOKYO_A }, { choice: "abstain", path: TOKYO_A },
      ],
      invites: [
        { reference: "EMP001", used: true, komsat: KORDA_A },
        { reference: "EMP002", cancelled: true },
      ],
      idleVoters: [{ name: "Tidak Memilih Lima", path: KORDA_A }],
    },
    // Nol suara: semuanya Abstain.
    zeroVotes: {
      frozen: true,
      votes: [],
      invites: [
        { reference: "ZRO001", cancelled: true },
        { reference: "ZRO002" },
      ],
      idleVoters: [
        { name: "Tidak Memilih Enam", path: KORDA_A },
        { name: "Tidak Memilih Tujuh", path: TOKYO_A },
      ],
    },
    // Semua anggota memilih dan semua tautan terpakai: Abstain nol.
    everyoneVoted: {
      frozen: true,
      votes: [
        { choice: "setuju", path: KORDA_A }, { choice: "setuju", path: KORDA_A }, { choice: "setuju", path: KORDA_A },
        { choice: "tidak_setuju", path: KORDA_B }, { choice: "setuju", path: KORDA_B },
        { choice: "setuju", path: TOKYO_A }, { choice: "tidak_setuju", path: TOKYO_A },
      ],
      invites: [
        { reference: "ALL001", used: true, komsat: KOBE_A },
        { reference: "ALL002", used: true, komsat: TOKYO_A },
      ],
    },
  };

describe("Rekapitulasi: kalkulasi benar di setiap tab", () => {
  for (const [name, scenario] of Object.entries(scenarios)) {
  it(`menambah semua angka dengan kalkulator rujukan pada skenario ${name}`, async () => {
      await seedScenario(scenario);
      const stored = (await env.DB.prepare("SELECT recap_abstain_count, recap_at FROM elections WHERE id=1").first<{ recap_abstain_count: number | null; recap_at: string | null }>())!;
      expect(stored.recap_at, "rekap belum dijalankan").toBeNull();

      const result = await recapViaApi();
      // Kalkulator rujukan berjalan setelah rekap, saat snapshot penutupan roll
      // live sudah tercatat oleh pembacaan pertama setelah Ditutup.
      const expected = await reference();
      expect(result.abstain_count).toBe(expected.summary.abstain_stored);

      const res = await adminGet();
      expect(res.status).toBe(200);
      const payload = (await res.json()) as RecapPayload;
      expect(payload.recap_done).toBe(true);

      // Ringkasan: setiap angka dari kalkulator rujukan.
      const s = payload.summary!;
      expectClose(s.dpt_final, expected.summary.dpt_final, "DPT final");
      expectClose(s.dpt_source, expected.summary.dpt_source, "sumber DPT");
      expectClose(s.total_dpt, expected.summary.total_dpt, "Total DPT (roll)");
      expectClose(s.invites_created, expected.summary.invites_created, "tautan dibuat");
      expectClose(s.invites_cancelled, expected.summary.invites_cancelled, "tautan dibatalkan");
      expectClose(s.invites_used, expected.summary.invites_used, "tautan dipakai");
      expectClose(s.invites_unused, expected.summary.invites_unused, "tautan belum dipakai");
      expectClose(s.votes_used, expected.summary.votes_used, "Total suara digunakan");
      expectClose(s.ballot_count, expected.summary.ballot_count, "surat suara");
      expectClose(s.setuju, expected.summary.setuju, "Setuju");
      expectClose(s.tidak_setuju, expected.summary.tidak_setuju, "Tidak Setuju");
      expectClose(s.abstain, expected.summary.abstain, "Abstain");
      const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
      expectClose(s.setuju_pct, pct(expected.summary.setuju, expected.summary.dpt_final), "persentase Setuju");
      expectClose(s.tidak_setuju_pct, pct(expected.summary.tidak_setuju, expected.summary.dpt_final), "persentase Tidak Setuju");
      expectClose(s.abstain_pct, pct(expected.summary.abstain, expected.summary.dpt_final), "persentase Abstain");
      expect(s.title).toBe("Pemira PPIJ 2026");
      expect(s.opens_at).not.toBeNull();
      expect(s.closes_at).not.toBeNull();
      expect(s.recap_at).not.toBeNull();
      expect(s.exported_at).not.toBeNull();

      // Invariant: Setuju + Tidak Setuju + Abstain = DPT final.
      expect(s.setuju + s.tidak_setuju + s.abstain).toBe(s.dpt_final);

      // Korda: semua anggota unit tampil (termasuk nol), angka sama dengan rujukan.
      const kordaNames = payload.korda!.filter((row) => !row.remainder).map((row) => row.name);
      for (const kordaName of ["Korda Okayama", "Korda Tokyo", "Korda Kobe", "Korda Osaka"]) {
        expect(kordaNames, `korda ${kordaName} ada`).toContain(kordaName);
      }
      expectClose(payload.korda!.map(({ key: _key, remainder: _remainder, ...rest }) => rest), expected.korda, "baris korda");
      // Invariant: jumlah korda = angka nasional.
      expect(payload.korda!.reduce((sum, row) => sum + row.hak_pilih, 0)).toBe(s.dpt_final);
      expect(payload.korda!.reduce((sum, row) => sum + row.used, 0)).toBe(s.votes_used);
      // Partisipasi saja: tidak ada kolom pilihan per korda.
      for (const row of payload.korda!) {
        expect(Object.keys(row).sort()).toEqual(["hak_pilih", "key", "name", "participation_pct", "remainder", "used"]);
      }

      // Komsat: sama dengan rujukan, jumlah kolom tetap nasional.
      expectClose(payload.komsat!.map(({ path: _path, remainder: _remainder, ...rest }) => rest), expected.komsat, "baris komsat");
      expect(payload.komsat!.reduce((sum, row) => sum + row.hak_pilih, 0)).toBe(s.dpt_final);
      expect(payload.komsat!.reduce((sum, row) => sum + row.used, 0)).toBe(s.votes_used);

      // Kotak suara: satu baris per surat suara, hanya hash dan pilihan, urut hash (acak).
      expectClose(payload.ballots!.map((row) => ({ receipt_hash: row.receipt_hash, choice: row.choice })), expected.ballots, "baris kotak suara");
      expect(payload.ballots!.every((row) => Object.keys(row).sort().join(",") === "choice,receipt_hash")).toBe(true);
      expect(payload.ballots!.every((row) => !row.receipt_hash.includes("undangan") && row.choice !== "")).toBe(true);
      const sortedHashes = payload.ballots!.map((row) => row.receipt_hash);
      expect(sortedHashes).toEqual([...sortedHashes].sort());

      // Abstain: baris = angka tersimpan (anggota + tautan), isi sama dengan rujukan.
      expectClose(payload.abstain!.map(({ is_link: _isLink, ...rest }) => rest), expected.abstain, "baris abstain");
      expect(payload.abstain!.length).toBe(expected.summary.abstain_stored);
      // Tanpa surat suara Abstain lama, angka tampilan = angka tersimpan.
      expect(s.abstain).toBe(expected.summary.abstain);
      const unusedReferences = (scenario.invites ?? []).filter((invite) => !invite.used && !invite.cancelled).map((invite) => invite.reference);
      for (const ref of unusedReferences) {
        expect(payload.abstain!.some((row) => row.name === `Tautan undangan ${ref} (tidak dipakai)`), `tautan ${ref} di daftar Abstain`).toBe(true);
      }
      for (const row of payload.abstain!.filter((row) => !row.is_link)) {
        expect(row.member_number).not.toBeNull();
        expect(row.korda).not.toBe("");
        expect(row.komsat).not.toBe("");
      }
    });
  }

  it("memakai snapshot penutupan sebagai sumber DPT pada roll live tanpa pembekuan", async () => {
    await seedScenario(scenarios.liveNeverFrozen);
    await recapViaApi();
    const res = await adminGet();
    const payload = (await res.json()) as RecapPayload;
    expect(payload.summary!.dpt_source).toBe("closing");
    expect(payload.summary!.dpt_source_label).toBe("Snapshot penutupan");
    const closing = (await env.DB.prepare("SELECT closing_hak_pilih FROM elections WHERE id=1").first<{ closing_hak_pilih: number | null }>())!.closing_hak_pilih!;
    const activeLinks = (await env.DB.prepare("SELECT COUNT(*) AS n FROM direct_invitations WHERE cancelled_at IS NULL").first<{ n: number }>())!.n;
    expect(payload.summary!.dpt_final).toBe(closing);
    expect(payload.summary!.total_dpt).toBe(closing - activeLinks);
  });

  it("menyebut sumber Dibekukan untuk roll beku", async () => {
    await seedScenario(scenarios.frozen);
    await recapViaApi();
    const res = await adminGet();
    const payload = (await res.json()) as RecapPayload;
    expect(payload.summary!.dpt_source).toBe("frozen");
    expect(payload.summary!.dpt_source_label).toBe("Dibekukan");
  });

  it("tidak mengungkap angka pilihan per korda di payload rekap", async () => {
    await seedScenario(scenarios.frozen);
    await recapViaApi();
    const res = await adminGet();
    const text = await res.text();
    expect(text).not.toContain("setuju_count");
    expect(text).not.toContain("tidak_setuju_count");
    expect(text).not.toContain("candidates");
  });
});

describe("Rekapitulasi: gerbang dan segel", () => {
  it("menolak rekap sebelum ditutup dan sebelum rekap tidak ada data tab", async () => {
    await seedScenario({});
    await env.DB.prepare("UPDATE elections SET closes_at=? WHERE id=1").bind(new Date(Date.now() + 3600e3).toISOString()).run();
    const refused = await adminPost("/api/election/recap");
    expect(refused.status).toBe(409);
    const state = (await (await adminGet()).json()) as RecapPayload;
    expect(state.recap_done).toBe(false);
    expect(state.can_run).toBe(false);
    expect(state.summary).toBeUndefined();
    expect(state.korda).toBeUndefined();
    expect(state.komsat).toBeUndefined();
    expect(state.ballots).toBeUndefined();
    expect(state.abstain).toBeUndefined();
  });

  it("Dasbor tersegel sebelum rekap dan membuka setelahnya, tapi publik tetap ditutup sampai Diumumkan", async () => {
    await seedScenario(scenarios.frozen);
    // Sebelum rekap: segel menyala untuk panitia, 409 untuk publik.
    const sealedDashboard = (await (await adminDashboard()).json()) as { tally_sealed: boolean; recap_done: boolean | null };
    expect(sealedDashboard.tally_sealed).toBe(true);
    expect(sealedDashboard.recap_done).toBe(false);
    expect((await app.request("/api/results", {}, bindings)).status).toBe(409);

    await recapViaApi();
    // Setelah rekap: panitia melihat angka, publik masih 409.
    const openDashboard = (await (await adminDashboard()).json()) as { tally_sealed: boolean; setuju_count: number | null; recap_done: boolean | null; recap_at: string | null };
    expect(openDashboard.tally_sealed).toBe(false);
    expect(openDashboard.recap_done).toBe(true);
    expect(openDashboard.recap_at).not.toBeNull();
    expect(openDashboard.setuju_count).not.toBeNull();
    expect((await app.request("/api/results", {}, bindings)).status).toBe(409);

    // Umumkan diterima setelah rekap, lalu publik terbuka.
    expect((await adminPost("/api/election/publish")).status).toBe(200);
    const published = await app.request("/api/results", {}, bindings);
    expect(published.status).toBe(200);
    expect(((await published.json()) as { setuju_count: number | null }).setuju_count).not.toBeNull();
  });

  it("menolak rekap di luar mode kandidat tunggal dan tidak menggerbangi Umumkan", async () => {
    await applyMigrations();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('initialized', '1'), ('site_scope', ?)").bind(SCOPE),
      env.DB.prepare("INSERT INTO admin_voting (member_id, name, is_technical, created_at) VALUES ('admin-1', 'Admin 1', 1, ?)").bind(new Date().toISOString()),
      env.DB.prepare("INSERT INTO elections (id, title, status_lock, opens_at, closes_at, allow_admin_voting, single_candidate_mode) VALUES (1, 'Multi', 'locked', ?, ?, 1, 0)")
        .bind(new Date(Date.now() - 7200e3).toISOString(), new Date(Date.now() - 3600e3).toISOString()),
    ]);
    await seedUnits();
    await env.DB.prepare("INSERT INTO candidates (id, member_id, number, name, nickname, komsat_path, color) VALUES (2, 'cand-2', 1, 'A', 'A', ?, '#c8102e'), (3, 'cand-3', 2, 'B', 'B', ?, '#1d4ed8')").bind(`${SCOPE}/komsat-a`, `${SCOPE}/komsat-a`).run();
    const refused = await adminPost("/api/election/recap");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain("mode kandidat tunggal");
    const state = (await (await adminGet()).json()) as RecapPayload;
    expect(state.recap_done).toBe(false);
    // Umumkan tanpa rekap tetap diterima di luar mode kandidat tunggal.
    expect((await adminPost("/api/election/publish")).status).toBe(200);
    const dashboard = (await (await adminDashboard()).json()) as { tally_sealed: boolean };
    expect(dashboard.tally_sealed).toBe(false);
  });

  it("Kembali ke Draf mengosongkan kolom rekap", async () => {
    await seedScenario(scenarios.frozen);
    await recapViaApi();
    const headers = new Headers({ "content-type": "application/json" });
    headers.set("cookie", await sessionCookie());
    // Kembali ke Draf hanya sebelum dibuka: mundurkan jadwal seperti pemilihan belum dibuka.
    await env.DB.prepare("UPDATE elections SET opens_at=? WHERE id=1").bind(new Date(Date.now() + 3600e3).toISOString()).run();
    const res = await app.request("/api/election/return-to-draft", { method: "POST", headers, body: JSON.stringify({ phrase: "KEMBALI KE DRAF" }) }, bindings);
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT recap_at, recap_abstain_count, abstain_counted_at, abstain_counted_count FROM elections WHERE id=1").first<{ recap_at: string | null; recap_abstain_count: number | null; abstain_counted_at: string | null; abstain_counted_count: number | null }>();
    expect(row).toMatchObject({ recap_at: null, recap_abstain_count: null, abstain_counted_at: null, abstain_counted_count: null });
    // Rekap dapat dijalankan lagi setelah penutupan berikutnya.
    await env.DB.prepare("UPDATE elections SET status_lock='locked', opens_at=?, closes_at=? WHERE id=1").bind(new Date(Date.now() - 7200e3).toISOString(), new Date(Date.now() - 3600e3).toISOString()).run();
    expect((await adminPost("/api/election/recap")).status).toBe(200);
  });
});

describe("Rekapitulasi: audit", () => {
  it("mencatat Rekapitulasi dilihat dan Rekapitulasi diunduh tanpa data di detail", async () => {
    await seedScenario(scenarios.frozen);
    // Sebelum rekap: pembacaan keadaan saja tidak mencatat apa pun.
    await adminGet();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>())!.n).toBe(0);

    await recapViaApi();
    const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>())!.n;
    await adminGet();
    const viewed = await env.DB.prepare("SELECT actor_type, actor_member_id, actor_name, action, target, detail_json FROM audit_log WHERE action='Rekapitulasi dilihat'").all<Record<string, unknown>>();
    expect(viewed.results).toHaveLength(1);
    expect(viewed.results[0]).toMatchObject({ actor_type: "admin", actor_member_id: "admin-1", actor_name: "Admin 1", target: null, detail_json: null });
    await adminGet();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='Rekapitulasi dilihat'").first<{ n: number }>())!.n).toBe(2);

    const download = await adminPost("/api/admin/recap/download");
    expect(download.status).toBe(200);
    expect(await download.json()).toEqual({ ok: true });
    const downloaded = await env.DB.prepare("SELECT actor_member_id, action, detail_json FROM audit_log WHERE action='Rekapitulasi diunduh'").all<Record<string, unknown>>();
    expect(downloaded.results).toHaveLength(1);
    expect(downloaded.results[0]).toMatchObject({ actor_member_id: "admin-1", detail_json: null });
    // Total bertambah tepat satu per aksi; rantai tetap sah.
    const all = (await env.DB.prepare("SELECT * FROM audit_log ORDER BY seq").all<AuditRow>()).results;
    expect(all.length).toBe(before + 3);
    expect(await verifyChain(all)).toBeNull();
  });

  it("menolak sesi non-Admin Voting tanpa entri rekap", async () => {
    await seedScenario(scenarios.frozen);
    await recapViaApi();
    const forbidden = await adminGet("/api/admin/recap", "bukan-admin");
    expect(forbidden.status).toBe(403);
    const forbiddenDownload = await adminPost("/api/admin/recap/download", "bukan-admin");
    expect(forbiddenDownload.status).toBe(403);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('Rekapitulasi dilihat','Rekapitulasi diunduh')").first<{ n: number }>())!.n).toBe(0);
  });
});

describe("Rekapitulasi: halaman dan navigasi", () => {
  it("halaman rekap memakai pustaka yang dibundel, endpoint yang benar, tanpa CDN", async () => {
    const page = (await import("../src/pages/admin/rekap.astro?raw")).default as string;
    expect(page).toContain('from "write-excel-file/browser"');
    expect(page).toContain('"/api/admin/recap"');
    expect(page).toContain('"/api/admin/recap/download"');
    expect(page).toContain('"/api/election/recap"');
    expect(page).toContain('id="recap-dialog"');
    expect(page).toContain("tidak dapat dijalankan sekali dan tidak dapat dibatalkan".replace("tidak ", ""));
    // Dialog menyebut angka tidak memilih yang akan menjadi Abstain.
    expect(page).toContain("akan dihitung sebagai Abstain");
    expect(page).toContain('"Ringkasan"');
    expect(page).toContain('"Korda"');
    expect(page).toContain('"Komsat"');
    expect(page).toContain('"Kotak suara"');
    expect(page).toContain('"Abstain"');
    expect(page).toContain("rekapitulasi-suara.xlsx");
    expect(page).toContain('href="/admin/pemilihan"');
    expect(page).not.toContain("<script src=");
    expect(page).not.toMatch(/https?:\/\/[^"']*\.(js|mjs)/);
  });

  it("navigasi Admin Voting memuat halaman Rekapitulasi di Lainnya", async () => {
    const layout = (await import("../src/layouts/AdminLayout.astro?raw")).default as string;
    expect(layout).toContain('href: "/admin/rekap"');
    expect(layout).toContain('label: "Rekapitulasi"');
    // Di ponsel halaman ini masuk menu Lainnya, bukan navigasi utama.
    expect(layout).not.toContain('"/admin/rekap".includes');
    const primary = layout.match(/const primaryNav = nav\.filter\(\(item\) => \[([^\]]+)\]/)![1];
    expect(primary).not.toContain("/admin/rekap");
  });

  it("Dasbor dan Pengaturan tidak lagi menawarkan Hitung Abstain", async () => {
    const dasbor = (await import("../src/pages/admin/dasbor.astro?raw")).default as string;
    const pengaturan = (await import("../src/pages/admin/pemilihan.astro?raw")).default as string;
    expect(dasbor).toContain("Rekapitulasi belum dijalankan");
    expect(dasbor).toContain('href="/admin/rekap"');
    expect(dasbor).not.toContain("Hitung Abstain");
    expect(pengaturan).not.toContain("abstain-count");
    expect(pengaturan).toContain("jalankan Rekapitulasi Suara di halaman Rekapitulasi terlebih dahulu");
  });

  it("jalur publik tidak pernah menampilkan payload rekap", async () => {
    const hasil = (await import("../src/pages/hasil.astro?raw")).default as string;
    const landing = (await import("../src/pages/index.astro?raw")).default as string;
    for (const page of [hasil, landing]) {
      expect(page).not.toContain("/api/admin/recap");
      expect(page).not.toContain("receipt_hash");
      expect(page).not.toContain("komsat_label");
    }
  });
});
