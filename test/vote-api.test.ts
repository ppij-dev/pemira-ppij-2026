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
import snapshotSql from "../migrations/0005_closing_snapshot.sql?raw";
import previewSql from "../migrations/0006_preview_mode.sql?raw";
import memberNumberSql from "../migrations/0008_member_number.sql?raw";
import categorySql from "../migrations/0009_voter_category.sql?raw";
import canVoteSql from "../migrations/0010_voter_can_vote.sql?raw";
import singleModeSql from "../migrations/0011_single_candidate_mode.sql?raw";
import ballotChoiceSql from "../migrations/0012_ballot_choice.sql?raw";
import ballotAbstainSql from "../migrations/0013_ballot_choice_abstain.sql?raw";
import abstainCountedSql from "../migrations/0014_abstain_counted.sql?raw";
import liveRollSql from "../migrations/0015_live_voter_roll.sql?raw";
import closingHakPilihSql from "../migrations/0016_closing_hak_pilih.sql?raw";
import directInvitationsSql from "../migrations/0017_direct_invitations.sql?raw";
import { voteRoutes } from "../src/server/voting/routes";
import { sealSession } from "../src/server/auth/session";
import { normalizeReceiptCode, hashReceipt } from "../src/server/voting/receipt";
import { castVote, type VoteSession } from "../src/server/voting/vote";
import { lockElection, returnToDraft } from "../src/server/election/lifecycle";
import { checkReceipt, getPublicBoard } from "../src/server/voting/board";
import { getDashboard } from "../src/server/results/queries";
import { verifyChain, type AuditRow } from "../src/server/lib/audit";
import { createServiceApiStub } from "./lib/serviceapi-fixture";
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

async function seedVoter(memberId: string, opts: { status?: string; path?: string; name?: string; category?: string | null; canVote?: number | null } = {}) {
  await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at,category,can_vote) VALUES (?,?,?,?,?,?,?)")
    .bind(memberId, opts.name ?? memberId, opts.path ?? `${SCOPE}/komsat-1`, opts.status ?? "ACTIVE", new Date().toISOString(), opts.category === undefined ? "BIASA" : opts.category, opts.canVote === undefined ? 1 : opts.canVote)
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
  const statements = [...initSql.split(";"), ...unitsSql.split(";"), ...lockSql.split(";"), ...snapshotSql.split(";"), ...limitsSql.split(";"), ...previewSql.split(";"), ...memberNumberSql.split(";"), ...categorySql.split(";"), ...canVoteSql.split(";"), ...singleModeSql.split(";"), ...ballotChoiceSql.split(";"), ...ballotAbstainSql.split(";"), ...abstainCountedSql.split(";"), ...liveRollSql.split(";"), ...closingHakPilihSql.split(";"), ...directInvitationsSql.split(";")].map((s) => s.trim()).filter(Boolean);
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  await env.DB.prepare("INSERT INTO system_config (key,value) VALUES ('site_scope',?),('site_base_url',?)").bind(SCOPE, ORIGIN).run();
  await seedOpenElection();
  await seedCandidates();
  await seedVoter("voter-1", { name: "Andi Wijaya" });
});

describe("POST /api/votes", () => {
  it("happy path: 201 dengan kode 16 karakter, 1 participation + 1 ballot + audit tanpa pilihan", async () => {
    const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(201);
    const body = await res.json() as { receipt_code: string; voted_at: string };
    expect(body.receipt_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(typeof body.voted_at).toBe("string");
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
    // Ballot: tidak ada kolom identitas pemilih atau waktu
    const ballot = await env.DB.prepare("SELECT * FROM ballots").first<Record<string, unknown>>();
    expect(Object.keys(ballot!).sort()).toEqual(["candidate_id", "choice", "election_id", "id", "is_test", "komsat_path", "receipt_hash"]);
    expect(ballot!.choice).toBeNull();
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

  it("403 Anggota Luar Biasa di roll: hanya Anggota Biasa yang berhak memilih", async () => {
    await seedVoter("voter-luar", { name: "Luar Biasa", category: "LUAR_BIASA", canVote: 0 });
    const res = await voteRequest(await sessionCookie("voter-luar"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("not_regular_member");
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("403 kategori belum ditentukan portal: panitia harus melengkapi data", async () => {
    await seedVoter("voter-unknown", { name: "Belum Ditentukan", category: null, canVote: null });
    const res = await voteRequest(await sessionCookie("voter-unknown"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("category_unknown");
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("can_vote dari portal adalah sumber kebenaran, kategori hanya tampilan", async () => {
    // Portal menyatakan tidak boleh walau label kategorinya Biasa.
    await seedVoter("voter-flag-no", { name: "Flag No", category: "BIASA", canVote: 0 });
    const denied = await voteRequest(await sessionCookie("voter-flag-no"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(denied.status).toBe(403);
    expect((await denied.json() as { error: string }).error).toBe("not_regular_member");
    // Portal menyatakan boleh: Pemira tidak menurunkan ulang ACTIVE+BIASA.
    await seedVoter("voter-flag-yes", { name: "Flag Yes", category: "LUAR_BIASA", canVote: 1 });
    const allowed = await voteRequest(await sessionCookie("voter-flag-yes"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(allowed.status).toBe(201);
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
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
    )).rejects.toMatchObject({ status: 409, reason: "not_open", message: "Batas waktu pemungutan suara telah lewat." });
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
    )).rejects.toMatchObject({ status: 409, reason: "not_open", message: "Batas waktu pemungutan suara telah lewat." });
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

describe("POST /api/votes mode kandidat tunggal", () => {
  async function enableSingleMode() {
    await env.DB.prepare("UPDATE elections SET single_candidate_mode = 1").run();
    // Mode kandidat tunggal: hanya kandidat nomor 1 yang terdaftar.
    await env.DB.prepare("DELETE FROM candidates WHERE id = 2").run();
  }
  // Dua jawaban (keputusan owner 2026-11-22): Abstain tidak dapat dipilih lagi.
  const choices = ["setuju", "tidak_setuju"] as const;

  it.each(choices)("menerima pilihan %s dan menyimpannya bersama satu candidate_id", async (choice) => {
    await enableSingleMode();
    const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi", choice });
    expect(res.status).toBe(201);
    const body = await res.json() as { receipt_code: string };
    expect(body.receipt_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
    const ballot = await env.DB.prepare("SELECT * FROM ballots").first<Record<string, unknown>>();
    // Tanpa rujukan anggota dan tanpa waktu: pilihan hanya isi surat suara.
    expect(Object.keys(ballot!).sort()).toEqual(["candidate_id", "choice", "election_id", "id", "is_test", "komsat_path", "receipt_hash"]);
    expect(ballot).toMatchObject({ candidate_id: 1, choice, is_test: 0 });
    // Audit suara tetap tanpa pilihan dan tanpa kode bukti.
    const audit = await env.DB.prepare("SELECT action,target,detail_json FROM audit_log").first<Record<string, unknown>>();
    expect(audit).toEqual({ action: "voted", target: null, detail_json: null });
  });

  it("menolak permintaan tanpa pilihan atau pilihan di luar dua jawaban tanpa menulis baris", async () => {
    await enableSingleMode();
    const cookie = await sessionCookie("voter-1");
    // Lima percobaan: batas rate limit 5/60 detik per sesi dihitung terpisah.
    for (const choice of [undefined, null, "abstain-banget", "setuju-banget", "ABSTAIN"]) {
      const res = await voteRequest(cookie, choice === undefined ? { candidate_id: 1, confirmation_text: "Budi" } : { candidate_id: 1, confirmation_text: "Budi", choice });
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBe("invalid_choice");
    }
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("menolak jawaban abstain dari surat suara dengan 400 invalid_choice", async () => {
    await enableSingleMode();
    // Keputusan owner 2026-11-22: Abstain bukan pilihan Pemilih. CHECK kolom
    // ballots.choice tetap menerima nilai lama, jadi penolakannya di server.
    const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi", choice: "abstain" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("invalid_choice");
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("menolak candidate_id yang bukan kandidat tunggal dengan 400", async () => {
    await env.DB.prepare("UPDATE elections SET single_candidate_mode = 1").run();
    // Dua baris kandidat tetap ada (mis. sisa daftar lama): hanya nomor 1 yang sah.
    const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 2, confirmation_text: "Sari", choice: "setuju" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("candidate_mismatch");
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
    // Konfirmasi nama panggilan tetap berlaku di atas pemeriksaan pilihan.
    const wrongName = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Sari", choice: "setuju" });
    expect(wrongName.status).toBe(400);
    expect((await wrongName.json() as { error: string }).error).toBe("confirmation_mismatch");
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("menolak Abstain dan pilihan lain pada pemilihan multi-kandidat", async () => {
    // Multi-kandidat tidak punya Abstain: semua pilihan non-NULL ditolak dan tidak menulis baris.
    for (const choice of ["abstain", "setuju", "tidak_setuju"]) {
      const res = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi", choice });
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBe("invalid_choice");
    }
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });

  it("menolak pilihan saat mode mati dan menyimpan NULL untuk suara biasa", async () => {
    const withChoice = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi", choice: "setuju" });
    expect(withChoice.status).toBe(400);
    expect((await withChoice.json() as { error: string }).error).toBe("invalid_choice");
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
    const normal = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(normal.status).toBe(201);
    expect(await env.DB.prepare("SELECT choice FROM ballots").first()).toEqual({ choice: null });
  });

  it("menulis partisipasi dan surat suara dalam satu batch tanpa data waktu di surat suara", async () => {
    await enableSingleMode();
    expect((await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi", choice: "tidak_setuju" })).status).toBe(201);
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
    const columns = (await env.DB.prepare("PRAGMA table_info(ballots)").all<{ name: string }>()).results.map((row) => row.name);
    expect(columns).toEqual(["id", "election_id", "candidate_id", "komsat_path", "receipt_hash", "is_test", "choice"]);
    expect(columns).not.toContain("voted_at");
    expect(columns).not.toContain("member_id");
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

  it("reason kategori Anggota Luar Biasa dan kategori belum ditentukan dibedakan", async () => {
    await seedVoter("voter-luar", { name: "Luar Biasa", category: "LUAR_BIASA", canVote: 0 });
    await seedVoter("voter-unknown", { name: "Belum Ditentukan", category: null, canVote: null });
    const luar = await getRequest("/api/votes/eligibility", await sessionCookie("voter-luar"));
    expect((await luar.json() as Record<string, unknown>).reason).toBe("not_regular_member");
    const unknown = await getRequest("/api/votes/eligibility", await sessionCookie("voter-unknown"));
    expect((await unknown.json() as Record<string, unknown>).reason).toBe("category_unknown");
  });
});

// Kembali ke Draf mempertahankan suara: aturan satu suara per anggota tetap
// berlaku setelah Kunci ulang, dan surat suara lama tetap dihitung.
const NO_SYNC = (() => { throw new Error("Mode Pratinjau tidak boleh menyinkronkan"); }) as unknown as typeof fetch;
describe("suara tersimpan melewati Kembali ke Draf", () => {
  it("menolak suara kedua anggota yang sudah memilih setelah kembali dan Kunci ulang", async () => {
    await env.DB.prepare("UPDATE elections SET preview_mode=1").run();
    const first = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(first.status).toBe(201);
    const receipt = (await first.json() as { receipt_code: string }).receipt_code;
    const ballotBefore = await env.DB.prepare("SELECT * FROM ballots").first<Record<string, unknown>>();
    const participationBefore = await env.DB.prepare("SELECT * FROM participation").first<Record<string, unknown>>();
    expect(await returnToDraft(env.DB, new Date(), "KEMBALI KE DRAF")).toMatchObject({ kept_ballots: 1, kept_participation: 1 });
    // Surat suara dan partisipasi tidak berubah sedikit pun oleh pengembalian ke Draf.
    expect(await env.DB.prepare("SELECT * FROM ballots").first()).toEqual(ballotBefore);
    expect(await env.DB.prepare("SELECT * FROM participation").first()).toEqual(participationBefore);
    await seedVoter("voter-2", { name: "Anggota Baru" });
    await lockElection(env.DB, { issuer: "", clientId: "", clientSecret: "", serviceApiUrl: "" }, new Date(), NO_SYNC);
    const entriesBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    const second = await voteRequest(await sessionCookie("voter-1"), { candidate_id: 2, confirmation_text: "Sari" });
    expect(second.status).toBe(409);
    // Pesan penolakan yang sama seperti hari ini: kode alasan stabil dari guard satu suara.
    expect(await second.json()).toEqual({ error: "already_voted" });
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>()).toEqual(entriesBefore);
    // Anggota baru pada roll hasil Kunci ulang memilih normal dan menerima kode bukti sekali pakai.
    const fresh = await voteRequest(await sessionCookie("voter-2"), { candidate_id: 1, confirmation_text: "Budi" });
    expect(fresh.status).toBe(201);
    expect(((await fresh.json()) as { receipt_code: string }).receipt_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(await rowCounts()).toEqual({ participation: 2, ballots: 2 });
    // Anggota yang tidak ada di roll baru tetap dihitung suaranya.
    await env.DB.prepare("DELETE FROM voters WHERE member_id='voter-1'").run();
    const dashboard = await getDashboard(env.DB, new Date());
    expect(dashboard).toMatchObject({ participation_count: 2, ballot_count: 2 });
    // Sebelum Diumumkan perolehan suara disegel (keputusan owner 2026-11-21); suara
    // yang tersimpan tetap terhitung, terbukti dari jumlah surat suara di kotak.
    expect(dashboard).toMatchObject({ tally_sealed: true });
    expect(dashboard.candidates.find(candidate => candidate.id === 1)).toMatchObject({ votes: null });
    // Bukti suara pembukaan sebelumnya tetap terverifikasi setelah pemilihan ditutup lagi.
    await env.DB.prepare("UPDATE elections SET closes_at=?").bind(new Date(Date.now() - 1_000).toISOString()).run();
    const receiptHash = await hashReceipt(normalizeReceiptCode(receipt));
    expect(await checkReceipt(env.DB, receiptHash)).toEqual({ found: true });
    const board = await getPublicBoard(env.DB, new Date());
    expect(board!.receipt_hashes).toContain(receiptHash);
    expect(board!.ballot_count).toBe(2);
  });
});

describe("Tidak Membekukan DPT (eligibility live)", () => {
  const stub = createServiceApiStub();
  const portal = { issuer: stub.issuer, clientId: "c", clientSecret: "s", serviceApiUrl: stub.serviceUrl, fetchImpl: stub.fetchImpl };
  async function seedLiveElection(opts: { preview?: boolean; allowAdmin?: number } = {}) {
    await env.DB.prepare("DELETE FROM elections").run();
    await env.DB.prepare(
      "INSERT INTO elections (id,title,status_lock,opens_at,closes_at,allow_admin_voting,preview_mode,live_voter_roll) VALUES (1,'Pemilihan','locked',?,?,?, ?,1)",
    ).bind(OPENS_AT, CLOSES_AT, opts.allowAdmin ?? 1, opts.preview ? 1 : 0).run();
  }
  it("anggota pada view dapat memilih meski roll tidak dibekukan", async () => {
    await seedLiveElection();
    // Watermark segar: tidak ada segarkan, view hasil seed dipakai apa adanya.
    await env.DB.prepare("INSERT OR REPLACE INTO system_config (key,value) VALUES ('pemilih_last_sync',?)").bind(new Date(Date.now() - 10_000).toISOString()).run();
    const session: VoteSession = { member_id: "voter-1", name: "Andi Wijaya", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) };
    const result = await castVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" }, undefined, portal);
    expect(result.receipt_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
    expect(await env.DB.prepare("SELECT frozen_at,frozen_hak_pilih FROM elections").first()).toEqual({ frozen_at: null, frozen_hak_pilih: null });
  });
  it("anggota baru dari segarkan portal dapat memilih dan segarkan tetap sunyi", async () => {
    await seedLiveElection();
    // Watermark lama: percobaan memilih memicu segarkan changed_since.
    await env.DB.prepare("INSERT OR REPLACE INTO system_config (key,value) VALUES ('pemilih_last_sync','2025-12-31T00:00:00Z')").run();
    const session: VoteSession = { member_id: "member-9", name: "Member 9", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) };
    const result = await castVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" }, undefined, portal);
    expect(result.receipt_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE member_id='member-9'").first<{n:number}>()).toEqual({ n: 1 });
    // Segarkan otomatis sunyi: hanya entri audit vote.
    const actions = await env.DB.prepare("SELECT action FROM audit_log").all<{ action: string }>();
    expect(actions.results.map((row) => row.action)).toEqual(["voted"]);
  });
  it("anggota yang tidak ada di view ditolak tanpa mencatat apa pun", async () => {
    await seedLiveElection();
    const session: VoteSession = { member_id: "voter-hantu", name: "Hantu", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) };
    await expect(castVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" }, undefined, portal)).rejects.toMatchObject({ status: 403, reason: "not_in_roll" });
    expect(await rowCounts()).toEqual({ participation: 0, ballots: 0 });
  });
  it("aturan hak pilih dan keanggotaan tetap sama saat saklar menyala", async () => {
    await seedLiveElection();
    await env.DB.prepare("INSERT OR REPLACE INTO system_config (key,value) VALUES ('pemilih_last_sync',?)").bind(new Date(Date.now() - 10_000).toISOString()).run();
    await seedVoter("voter-luar-live", { name: "Luar Biasa", category: "LUAR_BIASA", canVote: 0 });
    await seedVoter("voter-suspended-live", { status: "SUSPENDED" });
    const luarsei: VoteSession = { member_id: "voter-luar-live", name: "Luar Biasa", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) };
    await expect(castVote(env.DB, luarsei, { candidate_id: 1, confirmation_text: "Budi" }, undefined, portal)).rejects.toMatchObject({ reason: "not_regular_member" });
    const suspended: VoteSession = { member_id: "voter-suspended-live", name: "Suspended", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) };
    await expect(castVote(env.DB, suspended, { candidate_id: 1, confirmation_text: "Budi" }, undefined, portal)).rejects.toMatchObject({ reason: "not_active" });
    await seedLiveElection({ allowAdmin: 0 });
    const admin: VoteSession = { member_id: "admin-1", name: "Admin", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) };
    await env.DB.prepare("INSERT INTO admin_voting (member_id,name,created_at) VALUES ('admin-1','Admin','now')").run();
    await expect(castVote(env.DB, admin, { candidate_id: 1, confirmation_text: "Budi" }, undefined, portal)).rejects.toMatchObject({ reason: "admin_voting_not_allowed" });
  });
  it("suara yang sudah masuk tetap ada saat anggota kehilangan hak pilih di view", async () => {
    await seedLiveElection();
    await env.DB.prepare("INSERT OR REPLACE INTO system_config (key,value) VALUES ('pemilih_last_sync',?)").bind(new Date(Date.now() - 10_000).toISOString()).run();
    const session: VoteSession = { member_id: "voter-1", name: "Andi Wijaya", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) };
    await castVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" }, undefined, portal);
    await env.DB.prepare("UPDATE voters SET can_vote=0 WHERE member_id='voter-1'").run();
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
    await expect(castVote(env.DB, session, { candidate_id: 2, confirmation_text: "Sari" }, undefined, portal)).rejects.toMatchObject({ reason: "not_regular_member" });
    expect(await rowCounts()).toEqual({ participation: 1, ballots: 1 });
  });
  it("saklar mati: perilaku hari ini, tanpa segarkan portal", async () => {
    await env.DB.prepare("UPDATE elections SET live_voter_roll=0, frozen_at=NULL, frozen_hak_pilih=NULL").run();
    await env.DB.prepare("INSERT OR REPLACE INTO system_config (key,value) VALUES ('pemilih_last_sync','2025-12-31T00:00:00Z')").run();
    const session: VoteSession = { member_id: "voter-1", name: "Andi Wijaya", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) };
    await expect(castVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" }, undefined, portal)).rejects.toMatchObject({ reason: "not_locked" });
    await env.DB.prepare("UPDATE elections SET frozen_at=?, frozen_hak_pilih=10").bind(new Date(Date.now() - 3_600_000).toISOString()).run();
    const ghost: VoteSession = { member_id: "member-9", name: "Member 9", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) };
    await expect(castVote(env.DB, ghost, { candidate_id: 1, confirmation_text: "Budi" }, undefined, portal)).rejects.toMatchObject({ reason: "not_in_roll" });
    // Saklar mati tidak pernah menambah anggota dari portal.
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE member_id='member-9'").first<{n:number}>()).toEqual({ n: 0 });
  });
  it("Mode Pratinjau tetap mengatur alur cobainya meski saklar menyala", async () => {
    await seedLiveElection({ preview: true });
    const session: VoteSession = { member_id: "voter-baru", name: "Anggota Baru", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) };
    const result = await castVote(env.DB, session, { candidate_id: 1, confirmation_text: "Budi" }, undefined, portal);
    expect(result.receipt_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE member_id='voter-baru'").first<{n:number}>()).toEqual({ n: 1 });
  });
});
