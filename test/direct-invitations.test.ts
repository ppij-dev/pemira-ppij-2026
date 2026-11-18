/**
 * Undangan Langsung: pembuatan, daftar (tautan dapat disalin lagi), pembatalan,
 * jendela tahap, klaim + reservasi, dan rate limit. Endpoint diuji lewat app
 * sungguhan (guard admin + same-origin publik), inti logika lewat fungsi.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import lockSql from "../migrations/0003_election_lock.sql?raw";
import limitsSql from "../migrations/0004_vote_limits.sql?raw";
import snapshotSql from "../migrations/0005_closing_snapshot.sql?raw";
import previewSql from "../migrations/0006_preview_mode.sql?raw";
import memberNumberSql from "../migrations/0008_member_number.sql?raw";
import voterCategorySql from "../migrations/0009_voter_category.sql?raw";
import voterCanVoteSql from "../migrations/0010_voter_can_vote.sql?raw";
import singleModeSql from "../migrations/0011_single_candidate_mode.sql?raw";
import ballotChoiceSql from "../migrations/0012_ballot_choice.sql?raw";
import ballotAbstainSql from "../migrations/0013_ballot_choice_abstain.sql?raw";
import abstainCountedSql from "../migrations/0014_abstain_counted.sql?raw";
import directInvitationsSql from "../migrations/0017_direct_invitations.sql?raw";
import { app } from "../src/server/app";
import { sealSession } from "../src/server/auth/session";
import { verifyChain, type AuditRow } from "../src/server/lib/audit";
import {
  DIRECT_INVITE_BATCH_MAX,
  DIRECT_INVITE_TOTAL_MAX,
  DirectInviteError,
  cancelDirectInvitation,
  generateDirectInvitations,
  listDirectInvitations,
} from "../src/server/direct/create";
import { generateLinkCode, generateReference, linkTokenHash, normalizeLinkCode, openLinkToken, sealLinkToken } from "../src/server/direct/code";
import { resolveDirectLink } from "../src/server/direct/open";
import { INVITE_SESSION_COOKIE, claimDirectInvitation, openInviteSession } from "../src/server/direct/claim";

declare module "*.sql?raw" { const sql: string; export default sql; }

const MASTER_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const SCOPE = "/ppij/okayama";
const BASE_URL = "https://election.test";
const ORIGIN = BASE_URL;
const OPENS_AT = new Date(Date.now() - 60_000).toISOString();
const CLOSES_AT = new Date(Date.now() + 2 * 3_600_000).toISOString();
const bindings = { DB: env.DB, APP_MASTER_KEY: MASTER_KEY };
const actor = { member_id: "admin-1", name: "Admin 1" };

const MIGRATIONS = [
  initSql,
  unitsSql,
  lockSql,
  limitsSql,
  snapshotSql,
  previewSql,
  memberNumberSql,
  voterCategorySql,
  voterCanVoteSql,
  singleModeSql,
  ballotChoiceSql,
  ballotAbstainSql,
  abstainCountedSql,
  directInvitationsSql,
];

async function applyMigrations() {
  const statements = MIGRATIONS.join(";")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

async function adminCookie() {
  const value = await sealSession({ member_id: "admin-1", name: "Admin 1", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) }, MASTER_KEY);
  return `ppij_session=${value}`;
}

async function election(patch: Record<string, string | number> = {}) {
  const columns: Record<string, string | number> = {
    title: "Pemilihan PPI Jepang",
    status_lock: "locked",
    opens_at: OPENS_AT,
    closes_at: CLOSES_AT,
    frozen_at: new Date().toISOString(),
    frozen_hak_pilih: 100,
    ...patch,
  };
  const names = Object.keys(columns);
  await env.DB.prepare(
    `INSERT INTO elections (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
  ).bind(...names.map((name) => columns[name]!)).run();
}

async function generate(count: number) {
  return generateDirectInvitations(env.DB, new Date(), count, actor, { masterKey: MASTER_KEY, baseUrl: BASE_URL });
}

function codeOf(link: string): string {
  return new URL(link).pathname.split("/").at(-1)!;
}

async function auditActions(): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT seq,at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash FROM audit_log ORDER BY seq").all<AuditRow>();
  expect(await verifyChain(results)).toBeNull();
  return results.map((row) => row.action);
}

beforeEach(async () => {
  await reset();
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO system_config (key,value) VALUES ('initialized','1'),('site_scope',?),('site_base_url',?),('site_name','Pemilihan PPI Jepang')").bind(SCOPE, BASE_URL),
    env.DB.prepare("INSERT INTO admin_voting (member_id,name,is_technical,created_at) VALUES ('admin-1','Admin 1',1,?)").bind(new Date().toISOString()),
    env.DB.prepare("INSERT INTO voters (member_id,name,member_number,category,can_vote,komsat_path,status,synced_at) VALUES ('admin-1','Admin 1','OKA-1','BIASA',1,?,'ACTIVE',?)").bind(SCOPE, new Date().toISOString()),
    env.DB.prepare("INSERT INTO units (path,name,parent_path,type) VALUES (?,?,?,'korda'),(?,?,?,'komsat'),('/ppij/tokyo','PPI Tokyo','/ppij','korda')")
      .bind(SCOPE, "PPI Okayama", "/ppij", `${SCOPE}/komsat-okayama`, "PPI Okayama Kota", SCOPE),
  ]);
  await election();
});

describe("kode tautan", () => {
  it("membuat 26 karakter Crockford, menormalkan varian, dan menyegel token", async () => {
    const code = generateLinkCode();
    expect(code).toHaveLength(26);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(normalizeLinkCode(code.toLowerCase())).toBe(code);
    expect(normalizeLinkCode(`${code.slice(0, 4)}-${code.slice(4)}`)).toBe(code);
    expect(normalizeLinkCode("PENDEK")).toBeNull();
    const sealed = await sealLinkToken(MASTER_KEY, code);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(await openLinkToken(MASTER_KEY, sealed)).toBe(code);
    expect(await openLinkToken(MASTER_KEY, "v1:rusak:rusak")).toBeNull();
    expect(await linkTokenHash(code)).toHaveLength(64);
  });

  it("membuat referensi 6 karakter yang belum terpakai", () => {
    const taken = new Set<string>();
    for (let index = 0; index < 40; index += 1) {
      const reference = generateReference(taken);
      expect(reference).toHaveLength(6);
      expect(taken.has(reference)).toBe(false);
      taken.add(reference);
    }
  });
});

describe("pembuatan, daftar dan pembatalan", () => {
  it("membuat batch, mencatat audit, dan mengembalikan tautan penuh", async () => {
    const result = await generate(3);
    expect(result.created).toBe(3);
    expect(result.links).toHaveLength(3);
    expect(new Set(result.links.map((row) => row.reference)).size).toBe(3);
    for (const row of result.links) {
      expect(row.link.startsWith(`${BASE_URL}/undangan/`)).toBe(true);
      expect(row.id).toBeGreaterThan(0);
    }
    const rows = await env.DB.prepare("SELECT reference, token_hash, token_enc FROM direct_invitations").all<{ reference: string; token_hash: string; token_enc: string }>();
    expect(rows.results).toHaveLength(3);
    // Tidak menyimpan kode mentah; yang tersimpan hash dan token tersegel.
    for (const row of rows.results) {
      const code = await openLinkToken(MASTER_KEY, row.token_enc);
      expect(code).not.toBeNull();
      expect(await linkTokenHash(code!)).toBe(row.token_hash);
      expect(row.token_hash).not.toBe(code);
    }
    expect(await auditActions()).toEqual(["Undangan langsung dibuat"]);
    const detail = await env.DB.prepare("SELECT detail_json FROM audit_log ORDER BY seq DESC LIMIT 1").first<{ detail_json: string }>();
    expect(detail!.detail_json).toContain('"count":3');
    expect(detail!.detail_json).not.toContain("undangan/");
  });

  it("mendaftar semua baris, mengembalikan tautan hanya untuk yang belum dipakai", async () => {
    const created = await generate(3);
    const [first, second, third] = created.links;
    await env.DB.prepare("UPDATE direct_invitations SET used_at=?, guest_name='Budi', guest_email='budi@example.test', komsat_path=?, claimed_at=? WHERE reference=?")
      .bind(new Date().toISOString(), `${SCOPE}/komsat-okayama`, new Date().toISOString(), second!.reference).run();
    await env.DB.prepare("UPDATE direct_invitations SET cancelled_at=?, cancelled_by='admin-1', cancelled_by_name='Admin 1' WHERE reference=?")
      .bind(new Date().toISOString(), third!.reference).run();
    const list = await listDirectInvitations(env.DB, new Date(), actor, { masterKey: MASTER_KEY, baseUrl: BASE_URL });
    expect(list.rows).toHaveLength(3);
    expect(list.active_count).toBe(1);
    expect(list.used_count).toBe(1);
    expect(list.cancelled_count).toBe(1);
    const byReference = new Map(list.rows.map((row) => [row.reference, row]));
    expect(byReference.get(first!.reference)!.link).toBe(first!.link);
    expect(byReference.get(second!.reference)!.link).toBeNull();
    expect(byReference.get(second!.reference)!.status).toBe("dipakai");
    expect(byReference.get(second!.reference)!.guest_name).toBe("Budi");
    expect(byReference.get(second!.reference)!.komsat_label).toBe("PPI Okayama · PPI Okayama Kota");
    expect(byReference.get(third!.reference)!.link).toBeNull();
    expect(byReference.get(third!.reference)!.status).toBe("dibatalkan");
    expect(list.rows.every((row) => !("token_hash" in row) && !("token_enc" in row))).toBe(true);
    const actions = await auditActions();
    expect(actions[actions.length - 1]).toBe("Daftar undangan dilihat");
    const detail = await env.DB.prepare("SELECT detail_json, target FROM audit_log ORDER BY seq DESC LIMIT 1").first<{ detail_json: string; target: string | null }>();
    expect(detail!.detail_json).toContain('"count":3');
    expect(detail!.detail_json).not.toContain("undangan/");
    expect(detail!.target).toBeNull();
  });

  it("menolak pembatalan tautan terpakai dan mengizinkan yang belum dipakai", async () => {
    const created = await generate(2);
    const [used, unused] = created.links;
    await env.DB.prepare("UPDATE direct_invitations SET used_at=? WHERE reference=?").bind(new Date().toISOString(), used!.reference).run();
    await expect(cancelDirectInvitation(env.DB, new Date(), used!.id, actor)).rejects.toMatchObject({ reason: "invite_used" });
    const result = await cancelDirectInvitation(env.DB, new Date(), unused!.id, actor);
    expect(result.reference).toBe(unused!.reference);
    const row = await env.DB.prepare("SELECT cancelled_at, cancelled_by_name FROM direct_invitations WHERE id=?").bind(unused!.id).first<{ cancelled_at: string | null; cancelled_by_name: string | null }>();
    expect(row!.cancelled_at).not.toBeNull();
    expect(row!.cancelled_by_name).toBe("Admin 1");
    await expect(cancelDirectInvitation(env.DB, new Date(), unused!.id, actor)).rejects.toMatchObject({ reason: "invite_cancelled" });
    expect(await auditActions()).toEqual(["Undangan langsung dibuat", "Undangan langsung dibatalkan"]);
  });

  it("menolak jumlah di luar batas dan langit-langit per pemilihan", async () => {
    await expect(generate(0)).rejects.toBeInstanceOf(DirectInviteError);
    await expect(generate(DIRECT_INVITE_BATCH_MAX + 1)).rejects.toMatchObject({ reason: "invalid_count" });
    await generate(DIRECT_INVITE_BATCH_MAX);
    for (let index = 0; index < (DIRECT_INVITE_TOTAL_MAX / DIRECT_INVITE_BATCH_MAX) - 1; index += 1) {
      await generate(DIRECT_INVITE_BATCH_MAX);
    }
    await expect(generate(1)).rejects.toMatchObject({ reason: "invite_total_limit" });
  });

  it("mengizinkan Draf dan Terjadwal, menolak setelah tutup dan setelah diumumkan", async () => {
    await env.DB.prepare("UPDATE elections SET status_lock='draft', opens_at=NULL, closes_at=NULL, frozen_at=NULL WHERE id=1").run();
    await expect(generate(1)).resolves.toMatchObject({ created: 1 });
    await env.DB.prepare("UPDATE elections SET status_lock='locked', opens_at=?, closes_at=?, frozen_at=? WHERE id=1")
      .bind(new Date(Date.now() + 3_600_000).toISOString(), new Date(Date.now() + 7_200_000).toISOString(), new Date().toISOString()).run();
    const scheduled = await listDirectInvitations(env.DB, new Date(), actor, { masterKey: MASTER_KEY, baseUrl: BASE_URL });
    expect(scheduled.stage).toBe("scheduled");
    await expect(generate(1)).resolves.toMatchObject({ created: 1 });
    await env.DB.prepare("UPDATE elections SET opens_at=?, closes_at=? WHERE id=1").bind(OPENS_AT, CLOSES_AT).run();
    await env.DB.prepare("UPDATE elections SET closed_early_at=? WHERE id=1").bind(new Date().toISOString()).run();
    await expect(generate(1)).rejects.toMatchObject({ reason: "invite_window_closed" });
    await env.DB.prepare("UPDATE elections SET status_lock='published' WHERE id=1").run();
    await expect(generate(1)).rejects.toMatchObject({ reason: "invite_window_closed" });
  });

  it("menolak generate dan batalkan setelah pemungutan suara ditutup", async () => {
    const created = await generate(1);
    await env.DB.prepare("UPDATE elections SET closes_at=? WHERE id=1").bind(new Date(Date.now() - 1_000).toISOString()).run();
    await expect(generate(1)).rejects.toMatchObject({ reason: "invite_window_closed" });
    await expect(cancelDirectInvitation(env.DB, new Date(), created.links[0]!.id, actor)).rejects.toMatchObject({ reason: "invite_window_closed" });
    const row = await env.DB.prepare("SELECT cancelled_at FROM direct_invitations WHERE id=?").bind(created.links[0]!.id).first<{ cancelled_at: string | null }>();
    expect(row!.cancelled_at).toBeNull();
  });
});

describe("membuka tautan", () => {
  it("memberi hasil per tahap dan per status tautan", async () => {
    const created = await generate(3);
    const [active, used, cancelled] = created.links;
    await env.DB.prepare("UPDATE direct_invitations SET used_at=? WHERE reference=?").bind(new Date().toISOString(), used!.reference).run();
    await env.DB.prepare("UPDATE direct_invitations SET cancelled_at=? WHERE reference=?").bind(new Date().toISOString(), cancelled!.reference).run();
    const openView = await resolveDirectLink(env.DB, new Date(), codeOf(active!.link));
    expect(openView.outcome).toBe("ok");
    expect(openView.stage).toBe("open");
    expect((await resolveDirectLink(env.DB, new Date(), codeOf(used!.link))).outcome).toBe("used");
    expect((await resolveDirectLink(env.DB, new Date(), codeOf(cancelled!.link))).outcome).toBe("cancelled");
    expect((await resolveDirectLink(env.DB, new Date(), generateLinkCode())).outcome).toBe("unknown");
    expect((await resolveDirectLink(env.DB, new Date(), "BUKAN-KODE")).outcome).toBe("unknown");
    await env.DB.prepare("UPDATE elections SET opens_at=?, closes_at=? WHERE id=1")
      .bind(new Date(Date.now() + 3_600_000).toISOString(), new Date(Date.now() + 7_200_000).toISOString()).run();
    expect((await resolveDirectLink(env.DB, new Date(), codeOf(active!.link))).stage).toBe("scheduled");
    await env.DB.prepare("UPDATE elections SET opens_at=?, closes_at=? WHERE id=1").bind(OPENS_AT, new Date(Date.now() - 1_000).toISOString()).run();
    expect((await resolveDirectLink(env.DB, new Date(), codeOf(active!.link))).stage).toBe("closed");
    await env.DB.prepare("UPDATE elections SET status_lock='published' WHERE id=1").run();
    expect((await resolveDirectLink(env.DB, new Date(), codeOf(active!.link))).stage).toBe("published");
  });
});

describe("klaim formulir tamu", () => {
  it("menyimpan Nama, Email dan Komsat pada baris undangan dan menyegel sesi", async () => {
    const created = await generate(1);
    const code = codeOf(created.links[0]!.link);
    const result = await claimDirectInvitation(
      env.DB,
      new Date(),
      { kode: code, nama: "  Budi   Santoso ", email: "budi@example.test", komsat_path: `${SCOPE}/komsat-okayama` },
      null,
      { masterKey: MASTER_KEY, scope: SCOPE },
    );
    expect(result.session.guest_name).toBe("Budi Santoso");
    const row = await env.DB.prepare("SELECT guest_name, guest_email, komsat_path, claimed_at, claim_id, used_at FROM direct_invitations WHERE id=?")
      .bind(result.session.invitation_id).first<{ guest_name: string; guest_email: string; komsat_path: string; claimed_at: string; claim_id: string; used_at: string | null }>();
    expect(row!.guest_name).toBe("Budi Santoso");
    expect(row!.guest_email).toBe("budi@example.test");
    expect(row!.komsat_path).toBe(`${SCOPE}/komsat-okayama`);
    expect(row!.claimed_at).not.toBeNull();
    expect(row!.used_at).toBeNull();
    const reopened = await openInviteSession(result.cookie, MASTER_KEY);
    expect(reopened!.claim_id).toBe(result.session.claim_id);
  });

  it("menolak klaim kedua selama reservasi dan mengizinkan pemegangnya melanjutkan", async () => {
    const created = await generate(1);
    const code = codeOf(created.links[0]!.link);
    const first = await claimDirectInvitation(env.DB, new Date(), { kode: code, nama: "Budi", email: "budi@example.test", komsat_path: `${SCOPE}/komsat-okayama` }, null, { masterKey: MASTER_KEY, scope: SCOPE });
    await expect(
      claimDirectInvitation(env.DB, new Date(), { kode: code, nama: "Siti", email: "siti@example.test", komsat_path: `${SCOPE}/komsat-okayama` }, null, { masterKey: MASTER_KEY, scope: SCOPE }),
    ).rejects.toMatchObject({ reason: "invite_reserved" });
    const resumed = await claimDirectInvitation(env.DB, new Date(), { kode: code, nama: "Budi Santoso", email: "budi@example.test", komsat_path: `${SCOPE}/komsat-okayama` }, first.session.claim_id, { masterKey: MASTER_KEY, scope: SCOPE });
    expect(resumed.session.claim_id).toBe(first.session.claim_id);
  });

  it("kedaluwarsa sendiri setelah 30 menit", async () => {
    const created = await generate(1);
    const code = codeOf(created.links[0]!.link);
    await claimDirectInvitation(env.DB, new Date(), { kode: code, nama: "Budi", email: "budi@example.test", komsat_path: `${SCOPE}/komsat-okayama` }, null, { masterKey: MASTER_KEY, scope: SCOPE });
    await env.DB.prepare("UPDATE direct_invitations SET claimed_at=? WHERE id=?").bind(new Date(Date.now() - 31 * 60_000).toISOString(), created.links[0]!.id).run();
    const second = await claimDirectInvitation(env.DB, new Date(), { kode: code, nama: "Siti", email: "siti@example.test", komsat_path: `${SCOPE}/komsat-okayama` }, null, { masterKey: MASTER_KEY, scope: SCOPE });
    expect(second.session.guest_name).toBe("Siti");
  });

  it("memvalidasi nama, email dan unit di dalam cakupan", async () => {
    const created = await generate(1);
    const code = codeOf(created.links[0]!.link);
    const base = { kode: code, nama: "Budi", email: "budi@example.test", komsat_path: `${SCOPE}/komsat-okayama` };
    await expect(claimDirectInvitation(env.DB, new Date(), { ...base, nama: "B" }, null, { masterKey: MASTER_KEY, scope: SCOPE })).rejects.toMatchObject({ reason: "invalid_name" });
    await expect(claimDirectInvitation(env.DB, new Date(), { ...base, email: "bukan-email" }, null, { masterKey: MASTER_KEY, scope: SCOPE })).rejects.toMatchObject({ reason: "invalid_email" });
    await expect(claimDirectInvitation(env.DB, new Date(), { ...base, komsat_path: "/ppij/tokyo" }, null, { masterKey: MASTER_KEY, scope: SCOPE })).rejects.toMatchObject({ reason: "invalid_unit" });
    await expect(claimDirectInvitation(env.DB, new Date(), { ...base, komsat_path: "bebas" }, null, { masterKey: MASTER_KEY, scope: SCOPE })).rejects.toMatchObject({ reason: "invalid_unit" });
  });

  it("menolak klaim sebelum dibuka dan setelah ditutup", async () => {
    const created = await generate(1);
    const code = codeOf(created.links[0]!.link);
    const base = { kode: code, nama: "Budi", email: "budi@example.test", komsat_path: `${SCOPE}/komsat-okayama` };
    await env.DB.prepare("UPDATE elections SET opens_at=?, closes_at=? WHERE id=1")
      .bind(new Date(Date.now() + 3_600_000).toISOString(), new Date(Date.now() + 7_200_000).toISOString()).run();
    await expect(claimDirectInvitation(env.DB, new Date(), base, null, { masterKey: MASTER_KEY, scope: SCOPE })).rejects.toMatchObject({ reason: "invite_not_open" });
    await env.DB.prepare("UPDATE elections SET opens_at=?, closes_at=? WHERE id=1").bind(OPENS_AT, new Date(Date.now() - 1_000).toISOString()).run();
    await expect(claimDirectInvitation(env.DB, new Date(), base, null, { masterKey: MASTER_KEY, scope: SCOPE })).rejects.toMatchObject({ reason: "invite_not_open" });
  });
});

describe("rute admin dan publik", () => {
  it("membuat, mendaftar dan membatalkan lewat HTTP dengan guard admin", async () => {
    const cookie = await adminCookie();
    const denied = await app.request("/api/admin/undangan", {}, bindings);
    expect(denied.status).toBe(403);
    const created = await app.request("/api/admin/undangan", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ count: 2 }),
    }, bindings);
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { created: number; links: { id: number; reference: string; link: string }[] };
    expect(createdBody.created).toBe(2);
    const listed = await app.request("/api/admin/undangan", { headers: { cookie } }, bindings);
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { rows: { reference: string; link: string | null }[]; active_count: number };
    expect(listBody.active_count).toBe(2);
    expect(listBody.rows.every((row) => typeof row.link === "string")).toBe(true);
    const removed = await app.request(`/api/admin/undangan/${createdBody.links[0]!.id}`, { method: "DELETE", headers: { cookie } }, bindings);
    expect(removed.status).toBe(200);
    const after = await app.request("/api/admin/undangan", { headers: { cookie } }, bindings);
    const afterBody = (await after.json()) as { rows: { reference: string; status: string }[] };
    expect(afterBody.rows.find((row) => row.reference === createdBody.links[0]!.reference)!.status).toBe("dibatalkan");
  });

  it("klaim dan vote tamu lewat rute publik dengan same-origin", async () => {
    const cookie = await adminCookie();
    const created = await app.request("/api/admin/undangan", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ count: 1 }),
    }, bindings);
    const body = (await created.json()) as { links: { link: string }[] };
    const code = codeOf(body.links[0]!.link);
    const crossSite = await app.request("/api/undangan/klaim", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.test" },
      body: JSON.stringify({ kode: code, nama: "Budi", email: "budi@example.test", komsat_path: `${SCOPE}/komsat-okayama` }),
    }, bindings);
    expect(crossSite.status).toBe(403);
    const claimed = await app.request("/api/undangan/klaim", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ kode: code, nama: "Budi", email: "budi@example.test", komsat_path: `${SCOPE}/komsat-okayama` }),
    }, bindings);
    expect(claimed.status).toBe(200);
    expect(claimed.headers.get("set-cookie")).toContain(`${INVITE_SESSION_COOKIE}=`);
  });

  it("membatasi percobaan klaim per kode", async () => {
    const created = await generate(1);
    const code = codeOf(created.links[0]!.link);
    const body = { kode: code, nama: "Budi", email: "budi@example.test", komsat_path: `${SCOPE}/komsat-okayama` };
    for (let index = 0; index < 10; index += 1) {
      await app.request("/api/undangan/klaim", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify(body),
      }, bindings);
    }
    const limited = await app.request("/api/undangan/klaim", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    }, bindings);
    expect(limited.status).toBe(429);
  });
});
