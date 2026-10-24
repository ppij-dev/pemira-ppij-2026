/**
 * Test API pemungutan suara (task 4.1): in-memory fetch lewat Hono,
 * D1 Miniflare asli (cloudflare:test). Tidak pernah menulis kode bukti
 * mentah atau pilihan kandidat ke log.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { Hono } from "hono";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import lockSql from "../migrations/0003_election_lock.sql?raw";
import limitsSql from "../migrations/0004_vote_limits.sql?raw";
import previewSql from "../migrations/0006_preview_mode.sql?raw";
import { voteRoutes } from "../src/server/voting/routes";
import { sealSession } from "../src/server/auth/session";
import { normalizeReceiptCode, hashReceipt } from "../src/server/voting/receipt";
import { castVote, type VoteSession } from "../src/server/voting/vote";
import { verifyChain, type AuditRow } from "../src/server/lib/audit";
import type { Bindings } from "../src/server/app";

declare module "*.sql?raw" { const sql: string; export default sql; }

const MASTER_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const SCOPE = "/ppij/okayama";
const ORIGIN = "https://election.test";
// Tahap Dibuka: opens_at di masa lalu, closes_at 2 jam dari sekarang
const OPENS_AT = new Date(Date.now() - 60_000).toISOString();
const CLOSES_AT = new Date(Date.now() + 2 * 3_600_000).toISOString();
const bindings = { DB: env.DB, APP_MASTER_KEY: MASTER_KEY } satisfies Bindings;

const testApp = new Hono<{ Bindings: Bindings }>().basePath("/api");
testApp.route("/", voteRoutes);

async function sessionCookie(
  memberId: string,
  affiliation: string | string[] | null = SCOPE,
  authTimeSec = Math.floor(Date.now() / 1000),
  name?: string,
) {
  const value = await sealSession({ member_id: memberId, name: name ?? memberId, affiliation, auth_time: authTimeSec }, MASTER_KEY);
  return `ppij_session=${value}`;
}

function voteRequest(cookie: string | null, body: unknown, origin: string | null = ORIGIN) {
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  return testApp.request("/api/votes", { method: "POST", headers, body: JSON.stringify(body) }, bindings);
}

function getRequest(path: string, cookie: string | null) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return testApp.request(path, { headers }, bindings);
}

async function seedVoter(memberId: string, opts: { status?: string; path?: string; name?: string } = {}) {
  await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at) VALUES (?,?,?,?,?)")
    .bind(memberId, opts.name ?? memberId, opts.path ?? `${SCOPE}/komsat-1`, opts.status ?? "ACTIVE", new Date().toISOString())
    .run();
}

async function seedOpenElection(allowAdminVoting = 1) {
  await env.DB.prepare(
    "INSERT INTO elections (id,title,status_lock,opens_at,closes_at,frozen_hak_pilih,frozen_at,allow_admin_voting) VALUES (1,'Pemilihan','locked',?,?,10,?,?)",
  ).bind(OPENS_AT, CLOSES_AT, new Date(Date.now() - 3_600_000).toISOString(), allowAdminVoting).run();
}

async function seedCandidates() {
  await seedVoter("cand-1", { name: "Budi Santoso" });
  await env.DB.prepare(
    "INSERT INTO candidates (id,member_id,number,name,nickname,komsat_path) VALUES (1,'cand-1',1,'Budi Santoso','Budi',?)",
  ).bind(`${SCOPE}/komsat-1`).run();
  await env.DB.prepare(
    "INSERT INTO candidates (id,member_id,number,name,nickname,komsat_path) VALUES (2,'cand-2',2,'Sari Wulandari','Sari',?)",
  ).bind(`${SCOPE}/komsat-1`).run();
}

async function rowCounts() {
  const p = await env.DB.prepare("SELECT COUNT(*) AS n FROM participation").first<{ n: number }>();
  const b = await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots").first<{ n: number }>();
  return { participation: p!.n, ballots: b!.n };
}

beforeEach(async () => {
  await reset();
  const statements = [...initSql.split(";"), ...unitsSql.split(";"), ...lockSql.split(";"), ...limitsSql.split(";"), ...previewSql.split(";")].map((s) => s.trim()).filter(Boolean);
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  await env.DB.prepare("INSERT INTO system_config (key,value) VALUES ('site_scope',?),('site_base_url',?)").bind(SCOPE, ORIGIN).run();
  await seedOpenElection();
  await seedCandidates();
  await seedVoter("voter-1", { name: "Andi Wijaya" });
});

describe("POST /api/votes", () => {
  it("happy path: 201 dengan kode 4x4 16 karakter, 1 participation + 1 ballot + audit tanpa pilihan", async () => {
    const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(201);
    const body = await res.json() as { receipt_code: string; voted_at: string };
    expect(body.receipt_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(typeof body.voted_at).toBe("string");
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
    // Ballot: tidak ada kolom identitas pemilih atau waktu
    const ballot = await env.DB.prepare("SELECT * FROM ballots").first<Record<string, unknown>>();
    expect(Object.keys(ballot!).sort()).toEqual(["candidate_id", "election_id", "id", "is_test", "komsat_path", "receipt_hash"]);
    expect(ballot!.komsat_path).toBe(`${SCOPE}/komsat-1`);
    // Hash yang disimpan cocok dengan hash kode ternormalisasi (round trip)
    expect(ballot!.receipt_hash).toBe(await hashReceipt(normalizeReceiptCode(body.receipt_code)));
    // Audit: tanpa kandidat dan tanpa kode
    const audit = await env.DB.prepare("SELECT actor_type,actor_member_id,action,target,detail_json FROM audit_log").first<Record<string, unknown>>();
    expect(audit).toMatchObject({ actor_type: "voter", actor_member_id: "voter-1", action: "voted", target: null, detail_json: null });
    expect(JSON.stringify(audit)).not.toContain("cand-1");
    expect(JSON.stringify(audit)).not.toContain(body.receipt_code);
  });

  it("normalisasi konfirmasi: trim dan case-insensitive diterima", async () => {
    const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "  bUdI " });
    expect(res.status).toBe(201);
  });

  it("afiliasi array dalam cakupan diterima", async () => {
    const res = await voteRequest(await sessionCookie("voter-1", ["/ppij/tokyo", `${SCOPE}/komsat-1`]), { candidate_id: 2, confirmation_text: "Sari" });
    expect(res.status).toBe(201);
  });

  it("401 tanpa cookie sesi", async () => {
    expect((await voteRequest(null, { candidate_id: 1, confirmation_text: "Budi" })).status).toBe(401);
  });

  it("auth_time lama tetap diterima selama sesi sah; masa depan ditolak", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // 600 detik: diterima
    const fresh = await voteRequest(await sessionCookie("voter-1", SCOPE, nowSec - 600), { candidate_id: 1, confirmation_text: "Budi" });
    expect(fresh.status).toBe(201);
    // 601 detik: tetap diterima (fork ini tidak memaksa masuk ulang)
    await seedVoter("voter-2", { name: "Budi Santoso" });
    const older = await voteRequest(await sessionCookie("voter-2", SCOPE, nowSec - 601), { candidate_id: 1, confirmation_text: "Budi" });
    expect(older.status).toBe(201);
    // auth_time di masa depan: ditolak
    const future = await voteRequest(await sessionCookie("voter-3", SCOPE, nowSec + 60), { candidate_id: 1, confirmation_text: "Budi" });
    expect(future.status).toBe(401);
    expect(await rowCounts()).toEqual({ participation: 2, ballots: 2 });
  });

  it("menerima suara saat jadwal tersimpan dengan offset zona waktu (+09:00)", async () => {
    // Formulir admin menyimpan waktu dinding JST dengan offset +09:00; guard
    // penulisan suara harus membandingkan instan (julianday), bukan string.
    const tokyoStamp = (instant: number) =>
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .format(new Date(instant))
        .replace(" ", "T") + ".000+09:00";
    await env.DB.prepare("UPDATE elections SET opens_at = ?, closes_at = ? WHERE id = 1").bind(
      tokyoStamp(Date.now() - 60_000),
      tokyoStamp(Date.now() + 2 * 3_600_000),
    ).run();
    const res = await voteRequest(await sessionCookie("voter-1", SCOPE, Math.floor(Date.now() / 1000)), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(201);
    expect((await res.json() as Record<string, unknown>).receipt_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
  });

  it("403 afiliasi null (suspend) tanpa menulis baris", async () => {
    const res = await voteRequest(await sessionCookie("voter-1", null), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(403);
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("403 afiliasi di luar cakupan", async () => {
    const res = await voteRequest(await sessionCookie("voter-1", "/ppij/kyodai"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(403);
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("403 anggota yang bergabung setelah kunci (tidak ada di roll beku)", async () => {
    const res = await voteRequest(await sessionCookie("joiner-late"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("not_in_roll");
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("403 pemilih berstatus non-ACTIVE di roll", async () => {
    await seedVoter("voter-suspended", { status: "SUSPENDED" });
    const res = await voteRequest(await sessionCookie("voter-suspended"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(403);
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("403 Admin Voting saat pengaturan allow_admin_voting mati", async () => {
    await env.DB.prepare("UPDATE elections SET allow_admin_voting = 0").run();
    await env.DB.prepare("INSERT INTO admin_voting (member_id,name,created_at) VALUES ('admin-v','Admin V','now')").run();
    await seedVoter("admin-v", { name: "Admin V" });
    const res = await voteRequest(await sessionCookie("admin-v"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("admin_voting_not_allowed");
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("Admin Voting boleh memilih saat pengaturan menyala", async () => {
    await env.DB.prepare("INSERT INTO admin_voting (member_id,name,created_at) VALUES ('admin-v','Admin V','now')").run();
    await seedVoter("admin-v", { name: "Admin V" });
    const res = await voteRequest(await sessionCookie("admin-v"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(201);
  });

  it("400 konfirmasi tidak cocok tanpa menulis baris", async () => {
    const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Sari" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("confirmation_mismatch");
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("404 kandidat tidak dikenal tanpa menulis baris", async () => {
    const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 999, confirmation_text: "Budi" });
    expect(res.status).toBe(404);
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("409 pemilihan ditutup tanpa menulis baris", async () => {
    await env.DB.prepare("UPDATE elections SET closed_early_at = ?").bind(new Date().toISOString()).run();
    const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(409);
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("409 pengiriman ganda berurutan: hanya 1 participation + 1 ballot", async () => {
    const cookie = await sessionCookie("voter-1");
    expect((await voteRequest(cookie, { candidate_id: 1, confirmation_text: "Budi" })).status).toBe(201);
    const again = await voteRequest(cookie, { candidate_id: 2, confirmation_text: "Sari" });
    expect(again.status).toBe(409);
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
  });

  it("409 dua submit konkuren: tepat 1 participation + 1 ballot", async () => {
    const cookie = await sessionCookie("voter-1");
    const [first, second] = await Promise.all([
      voteRequest(cookie, { candidate_id: 1, confirmation_text: "Budi" }),
      voteRequest(cookie, { candidate_id: 1, confirmation_text: "Budi" }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
  });

  it("409 jika pemilihan ditutup antara authorize dan batch; audit tidak berubah", async () => {
    const session: VoteSession = {
      member_id: "voter-1", name: "Andi Wijaya", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000),
    };
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    await expect(castVote(
      env.DB,
      session,
      { candidate_id: 1, confirmation_text: "Budi" },
      { beforeBatch: async () => {
        await env.DB.prepare("UPDATE elections SET closed_early_at = ?").bind(new Date().toISOString()).run();
      } },
    )).rejects.toMatchObject({ status: 409, reason: "not_open" });
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("scheduled-close-between-statements admits no partial vote", async () => {
    const session: VoteSession = {
      member_id: "voter-1", name: "Andi Wijaya", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000),
    };
    await env.DB.prepare("UPDATE elections SET closes_at = ?")
      .bind(new Date(Date.now() + 300).toISOString()).run();
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    // Real delay is required: Miniflare's SQLite clock is independent of JS fake timers.
    await expect(castVote(
      env.DB,
      session,
      { candidate_id: 1, confirmation_text: "Budi" },
      { beforeBatch: async () => new Promise((resolve) => setTimeout(resolve, 350)) },
    )).rejects.toMatchObject({ status: 409, reason: "not_open" });
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("scheduled close already passed leaves participation, ballot, and audit unchanged", async () => {
    await env.DB.prepare("UPDATE elections SET closes_at = ?").bind(new Date(Date.now() - 5).toISOString()).run();
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(409);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("dua pemilih konkuren mencatat audit berantai valid", async () => {
    await seedVoter("voter-2", { name: "Sari Anggota" });
    const cookie1 = await sessionCookie("voter-1");
    const cookie2 = await sessionCookie("voter-2");
    const [first, second] = await Promise.all([
      voteRequest(cookie1, { candidate_id: 1, confirmation_text: "Budi" }),
      voteRequest(cookie2, { candidate_id: 2, confirmation_text: "Sari" }),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    const { results } = await env.DB.prepare(
      "SELECT seq,at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash FROM audit_log ORDER BY seq",
    ).all<AuditRow>();
    expect(results).toHaveLength(2);
    expect(await verifyChain(results)).toBeNull();
    expect(await rowCounts()).toEqual({ participation: 2, ballots: 2 });
  });

  it("429 percobaan keenam dalam 60 detik", async () => {
    const cookie = await sessionCookie("voter-1");
    for (let i = 0; i < 5; i++) {
      // Konfirmasi salah agar tidak menulis vote tapi tetap dihitung sebagai percobaan
      const res = await voteRequest(cookie, { candidate_id: 1, confirmation_text: "salah" });
      expect(res.status).toBe(400);
    }
    const sixth = await voteRequest(cookie, { candidate_id: 1, confirmation_text: "Budi" });
    expect(sixth.status).toBe(429);
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("403 origin cross-site ditolak", async () => {
    const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi" }, "https://evil.example");
    expect(res.status).toBe(403);
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });
});

describe("GET /api/votes/me", () => {
  it("401 tanpa sesi", async () => {
    expect((await getRequest("/api/votes/me", null)).status).toBe(401);
  });

  it("voted_at null sebelum memilih, terisi sesudahnya; tidak ada kandidat/hash/kode", async () => {
    const cookie = await sessionCookie("voter-1");
    const before = await getRequest("/api/votes/me", cookie);
    expect(await before.json()).toEqual({ voted_at: null });
    const voted = await voteRequest(cookie, { candidate_id: 1, confirmation_text: "Budi" });
    const { receipt_code } = await voted.json() as { receipt_code: string };
    const after = await getRequest("/api/votes/me", cookie);
    const body = await after.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["voted_at"]);
    expect(typeof body.voted_at).toBe("string");
    expect(JSON.stringify(body)).not.toContain(receipt_code);
  });
});

describe("GET /api/votes/eligibility", () => {
  it("allowed untuk pemilih segar dalam cakupan, menyertakan stage tanpa kandidat", async () => {
    const res = await getRequest("/api/votes/eligibility", await sessionCookie("voter-1"));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.allowed).toBe(true);
    expect(body.reason).toBeNull();
    expect(body.fresh_login_needed).toBe(false);
    expect(body.freshLoginNeeded).toBe(false);
    expect(body.stage).toBe("open");
    expect(JSON.stringify(body)).not.toContain("Budi");
  });

  it("sesi lama tetap lolos kelayakan; not_logged_in tanpa sesi", async () => {
    const stale = await getRequest("/api/votes/eligibility", await sessionCookie("voter-1", SCOPE, Math.floor(Date.now() / 1000) - 601));
    const staleBody = await stale.json() as Record<string, unknown>;
    expect(staleBody.allowed).toBe(true);
    expect(staleBody.fresh_login_needed).toBe(false);
    const anon = await getRequest("/api/votes/eligibility", null);
    expect((await anon.json() as Record<string, unknown>).reason).toBe("not_logged_in");
  });

  it("reason out_of_scope dan not_in_roll dibedakan", async () => {
    const outScope = await getRequest("/api/votes/eligibility", await sessionCookie("voter-1", "/ppij/kyodai"));
    expect((await outScope.json() as Record<string, unknown>).reason).toBe("out_of_scope");
    const notRoll = await getRequest("/api/votes/eligibility", await sessionCookie("joiner-late"));
    expect((await notRoll.json() as Record<string, unknown>).reason).toBe("not_in_roll");
  });
});
