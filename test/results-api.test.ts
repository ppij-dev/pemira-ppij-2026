import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import lockSql from "../migrations/0003_election_lock.sql?raw";
import snapshotSql from "../migrations/0005_closing_snapshot.sql?raw";
import previewModeSql from "../migrations/0006_preview_mode.sql?raw";
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
import recapSql from "../migrations/0019_election_recap.sql?raw";
import { app } from "../src/server/app";
import { sealSession } from "../src/server/auth/session";
import { getRecapState, runRecap } from "../src/server/election/lifecycle";
import { verifyChain, type AuditRow } from "../src/server/lib/audit";
import { getDashboard } from "../src/server/results/queries";
import { allPortalMembers, changedPortalMembers, createServiceApiStub } from "./lib/serviceapi-fixture";
import type { DashboardPayload, ResultsPayload } from "../src/server/results/queries";

declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}

const MASTER_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const SCOPE = "/ppij/okayama";
const bindings = { DB: env.DB, APP_MASTER_KEY: MASTER_KEY };


async function sessionCookie(memberId: string, name = memberId, affiliation: string | string[] | null = SCOPE) {
  const value = await sealSession(
    { member_id: memberId, name, affiliation, auth_time: Math.floor(Date.now() / 1000) },
    MASTER_KEY,
  );
  return `ppij_session=${value}`;
}

async function requestDashboard(memberId = "admin-1", name = "Admin 1") {
  const headers = new Headers();
  headers.set("cookie", await sessionCookie(memberId, name));
  return app.request("/api/dashboard", { headers }, bindings);
}

async function requestPublicResults() {
  return app.request("/api/results", {}, bindings);
}

async function applyMigrations() {
  for (const file of [initSql, unitsSql, lockSql, snapshotSql, previewModeSql, memberNumberSql, categorySql, canVoteSql, singleModeSql, ballotChoiceSql, ballotAbstainSql, abstainCountedSql, liveRollSql, closingHakPilihSql, directInvitationsSql, recapSql]) {
    const stmts = file.split(";").map((s) => s.trim()).filter(Boolean);
    await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
  }
}

async function seedBase() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('initialized', '1'), ('site_scope', ?), ('site_base_url', 'https://election.test')").bind(SCOPE),
    env.DB.prepare("INSERT INTO admin_voting (member_id, name, is_technical, created_at) VALUES ('admin-1', 'Admin 1', 1, ?)").bind(new Date().toISOString()),
    env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at, can_vote) VALUES ('admin-1', 'Admin 1', ?, 'ACTIVE', ?, 1)").bind(`${SCOPE}/komsat-a`, new Date().toISOString()),
    env.DB.prepare("INSERT INTO units (path, name, parent_path, type) VALUES ('/ppij/okayama', 'Korda Okayama', '/ppij', 'korda'), ('/ppij/tokyo', 'Korda Tokyo', '/ppij', 'korda')"),
  ]);
}

async function seedElection(opts: {
  status?: "draft" | "locked" | "published";
  frozen?: number | null;
  allowAdminVoting?: number;
  openOffsetHours?: number;
  closeOffsetHours?: number;
} = {}) {
  const now = Date.now();
  const opens = new Date(now + (opts.openOffsetHours ?? -1) * 3600e3).toISOString();
  const closes = new Date(now + (opts.closeOffsetHours ?? 24) * 3600e3).toISOString();
  await env.DB.prepare(
    "INSERT INTO elections (id, title, status_lock, opens_at, closes_at, allow_admin_voting, frozen_hak_pilih, frozen_at) VALUES (1, 'Pemilihan', ?, ?, ?, ?, ?, ?)",
  ).bind(
    opts.status ?? "locked",
    opens,
    closes,
    opts.allowAdminVoting ?? 1,
    opts.frozen ?? null,
    opts.frozen != null ? new Date().toISOString() : null,
  ).run();
}

async function seedCandidates() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at, can_vote) VALUES ('cand-1', 'Kandidat Satu', ?, 'ACTIVE', ?, 1), ('cand-2', 'Kandidat Dua', ?, 'ACTIVE', ?, 1)").bind(SCOPE, new Date().toISOString(), SCOPE, new Date().toISOString()),
    env.DB.prepare("INSERT INTO candidates (id, member_id, number, name, nickname, komsat_path, color) VALUES (1, 'cand-1', 1, 'Kandidat Satu', 'Satu', ?, '#ff0000'), (2, 'cand-2', 2, 'Kandidat Dua', 'Dua', ?, '#0000ff')").bind(SCOPE, SCOPE),
  ]);
}

async function castBallot(candidateId: number, path: string, isTest = 0) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test) VALUES (?, 1, ?, ?, ?, ?)",
  ).bind(id, candidateId, path, `hash-${id}`, isTest).run();
  return id;
}

async function recordParticipation(memberId: string, path: string, isTest = 0) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO voters (member_id, name, komsat_path, status, synced_at, can_vote) VALUES (?, ?, ?, 'ACTIVE', ?, 1)",
  ).bind(memberId, memberId, path, new Date().toISOString()).run();
  await env.DB.prepare(
    "INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (1, ?, ?, ?, ?)",
  ).bind(memberId, memberId, new Date().toISOString(), isTest).run();
}

beforeEach(async () => {
  await reset();
  await applyMigrations();
  await seedBase();
});

describe("Results API - Authorization and Guards", () => {
  it("uses the production dispatcher for the public and guarded endpoints", async () => {
    await seedElection({ status: "locked" });
    const dashboard = await app.request("/api/dashboard", {}, bindings);
    expect(dashboard.status).toBe(403);
    const publicResults = await app.request("/api/results", {}, bindings);
    expect(publicResults.status).toBe(409);
    expect(await publicResults.json()).toEqual({ error: "hasil_belum_diumumkan" });
  });
  it("rejects non-admin visitors on /api/dashboard with 403 and records no audit", async () => {
    await seedElection();
    // member-2 has a voter row within scope but is not in admin_voting.
    await env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at) VALUES ('member-2', 'Member 2', ?, 'ACTIVE', ?)").bind(SCOPE, new Date().toISOString()).run();
    const res = await requestDashboard("member-2");
    expect(res.status).toBe(403);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("returns 503 when no election has been created yet", async () => {
    const res = await requestDashboard();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("pemilihan_belum_dibuat");
  });

  it("refuses public /api/results with 409 while election is not published, leaking no counts", async () => {
    await seedElection({ status: "locked" });
    await seedCandidates();
    await castBallot(1, `${SCOPE}/komsat-a`);
    const res = await requestPublicResults();
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).not.toContain("candidates");
    expect(text).not.toContain("Satu");
    expect(text).not.toContain("korda");
    // Public reads never append an audit row.
    const auditCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    expect(auditCount?.n).toBe(0);
  });
});

describe("Results API - Dashboard Metrics and Freezing", () => {
  it("keeps Hak pilih fixed at frozen_hak_pilih despite post-freeze voter additions", async () => {
    await seedElection({ status: "locked", frozen: 1230 });
    await seedCandidates();
    // Simulate extra voters arriving after freeze (e.g. out-of-band edit).
    for (let i = 1; i <= 5; i++) {
      await env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at) VALUES (?, ?, ?, 'ACTIVE', ?)").bind(`late-${i}`, `Late ${i}`, `${SCOPE}/komsat-a`, new Date().toISOString()).run();
    }
    const res = await requestDashboard();
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardPayload;
    expect(data.eligible_count).toBe(1230);
    expect(data.stage).toBe("open");
    expect(typeof data.updated_at).toBe("string");
  });

  it("falls back to current roll during Draf and respects allow_admin_voting", async () => {
    // 1 admin voter already in seedBase; add 4 regular voters.
    for (let i = 1; i <= 4; i++) {
      await env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at, can_vote) VALUES (?, ?, ?, 'ACTIVE', ?, 1)").bind(`v-${i}`, `V ${i}`, `${SCOPE}/komsat-a`, new Date().toISOString()).run();
    }
    // allow_admin_voting = 0: 5 total voters minus 1 admin = 4 eligible.
    await seedElection({ status: "draft", allowAdminVoting: 0 });
    await seedCandidates();
    // 1 admin voter in seedBase + 4 regular voters + 2 candidate voters = 7 total voters.
    // allow_admin_voting = 0: 7 total voters minus 1 admin = 6 eligible.
    const res = await requestDashboard();
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardPayload;
    expect(data.eligible_count).toBe(6);
    expect(data.stage).toBe("draft");
  });

  it("counts only can_vote = 1 roll rows as Hak pilih and turnout denominator during Draf", async () => {
    // Replace the seeded roll with a mixed one: only can_vote = 1 may vote, so
    // can_vote 0 and NULL rows must not become eligible or a denominator.
    await env.DB.prepare("DELETE FROM voters").run();
    const seedVoter = (memberId: string, path: string, canVote: number | null) =>
      env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at, can_vote) VALUES (?, ?, ?, 'ACTIVE', ?, ?)")
        .bind(memberId, memberId, path, new Date().toISOString(), canVote).run();
    // Okayama: 3 eligible, 2 without voting right, 1 the portal has not decided.
    await seedVoter("ok-eligible-1", `${SCOPE}/komsat-a`, 1);
    await seedVoter("ok-eligible-2", `${SCOPE}/komsat-b`, 1);
    await seedVoter("ok-eligible-3", `${SCOPE}/komsat-a`, 1);
    await seedVoter("ok-blocked-1", `${SCOPE}/komsat-a`, 0);
    await seedVoter("ok-blocked-2", `${SCOPE}/komsat-a`, 0);
    await seedVoter("ok-undecided", `${SCOPE}/komsat-a`, null);
    // Tokyo: 2 eligible, 1 undecided.
    await seedVoter("tk-eligible-1", "/ppij/tokyo/komsat-a", 1);
    await seedVoter("tk-eligible-2", "/ppij/tokyo/komsat-b", 1);
    await seedVoter("tk-undecided", "/ppij/tokyo/komsat-a", null);
    await seedElection({ status: "draft", allowAdminVoting: 1 });
    // One eligible Okayama voter has already voted (scoreboard denominator).
    await env.DB.prepare(
      "INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (1, 'ok-eligible-1', 'ok-eligible-1', ?, 0)",
    ).bind(new Date().toISOString()).run();

    const res = await requestDashboard();
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardPayload;
    expect(data.eligible_count).toBe(5);
    expect(data.used_count).toBe(1);
    expect(data.unused_count).toBe(4);
    expect(data.turnout_percentage).toBe(20);

    const okayama = data.korda.find((k) => k.key === "/ppij/okayama");
    expect(okayama?.eligible_count).toBe(3);
    expect(okayama?.used_count).toBe(1);
    expect(okayama?.turnout_percentage).toBe(33.3);

    const tokyo = data.korda.find((k) => k.key === "/ppij/tokyo");
    expect(tokyo?.eligible_count).toBe(2);
    expect(tokyo?.used_count).toBe(0);
    expect(tokyo?.turnout_percentage).toBe(0);
  });

  it("includes zero-vote candidates in overall candidate tally", async () => {
    // Angka pilihan baru terbuka setelah Diumumkan (segel 2026-11-21).
    await seedElection({ status: "published", frozen: 100 });
    await seedCandidates();
    await castBallot(1, `${SCOPE}/komsat-a`);
    await castBallot(1, `${SCOPE}/komsat-a`);
    await recordParticipation("voter-1", `${SCOPE}/komsat-a`);
    await recordParticipation("voter-2", `${SCOPE}/komsat-a`);

    const res = await requestDashboard();
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardPayload;
    expect(data.candidates).toHaveLength(2);
    expect(data.candidates.find((c) => c.number === 1)?.votes).toBe(2);
    const zero = data.candidates.find((c) => c.number === 2);
    expect(zero?.votes).toBe(0);
    expect(zero?.nickname).toBe("Dua");
    expect(data.used_count).toBe(2);
    expect(data.unused_count).toBe(98);
    expect(data.turnout_percentage).toBe(2);
  });

  it("detects ballot and participation count mismatch", async () => {
    await seedElection({ status: "locked", frozen: 10 });
    await seedCandidates();
    // One participation, but two ballots (tampered / direct D1 insert).
    await recordParticipation("voter-1", `${SCOPE}/komsat-a`);
    await castBallot(1, `${SCOPE}/komsat-a`);
    await castBallot(1, `${SCOPE}/komsat-a`);

    const res = await requestDashboard();
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardPayload;
    expect(data.participation_count).toBe(1);
    expect(data.ballot_count).toBe(2);
    expect(data.count_matches).toBe(false);
  });
  it("keeps participation and ballot totals snapshot-consistent during concurrent votes", async () => {
    await seedElection({ status: "locked", frozen: 100 });
    await seedCandidates();
    for (let i = 0; i < 10; i++) {
      const memberId = `concurrent-${i}`;
      const path = `${SCOPE}/komsat-a`;
      await env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at) VALUES (?, ?, ?, 'ACTIVE', ?)")
        .bind(memberId, memberId, path, new Date().toISOString()).run();
      const id = crypto.randomUUID();
      const [response] = await Promise.all([
        requestDashboard(),
        env.DB.batch([
          env.DB.prepare("INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (1, ?, ?, ?, 0)")
            .bind(memberId, memberId, new Date().toISOString()),
          env.DB.prepare("INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test) VALUES (?, 1, 1, ?, ?, 0)")
            .bind(id, path, `hash-${id}`),
        ]),
      ]);
      expect(response.status).toBe(200);
      const data = (await response.json()) as DashboardPayload;
      expect(data.count_matches).toBe(true);
      expect(data.participation_count).toBe(data.ballot_count);
    }
  });

  it("warns when committee has fewer than two Admin Voting", async () => {
    await seedElection({ status: "locked", frozen: 50 });
    const singleRes = await requestDashboard();
    const singleData = (await singleRes.json()) as DashboardPayload;
    expect(singleData.committee_warning).toBe(true);

    // Add a second Admin Voting member.
    await env.DB.prepare("INSERT INTO admin_voting (member_id, name, is_technical, created_at) VALUES ('admin-2', 'Admin 2', 0, ?)").bind(new Date().toISOString()).run();
    const dualRes = await requestDashboard();
    const dualData = (await dualRes.json()) as DashboardPayload;
    expect(dualData.committee_warning).toBe(false);
  });
});

describe("Results API - Korda counts and Fallback", () => {
  it("shows candidate counts for every korda, including one with fewer than 10 ballots", async () => {
    await seedElection({ status: "published", frozen: 100 });
    await seedCandidates();

    // Okayama region: 9 ballots (no threshold since revise-public-results-view).
    for (let i = 1; i <= 9; i++) {
      await castBallot(i <= 7 ? 1 : 2, `${SCOPE}/komsat-${i}`);
      await recordParticipation(`ok-${i}`, `${SCOPE}/komsat-${i}`);
    }
    // Tokyo region: 10 ballots (visible).
    for (let i = 1; i <= 10; i++) {
      const cand = i <= 6 ? 1 : 2;
      await castBallot(cand, `/ppij/tokyo/komsat-${i}`);
      await recordParticipation(`tk-${i}`, `/ppij/tokyo/komsat-${i}`);
    }

    const res = await requestDashboard();
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardPayload;
    const okayama = data.korda.find((k) => k.key === "/ppij/okayama");
    expect(okayama).toBeDefined();
    expect(okayama?.name).toBe("Korda Okayama");
    expect(okayama?.ballot_count).toBe(9);
    expect(okayama?.used_count).toBe(9);
    expect(okayama?.suppressed).toBe(false);
    expect(okayama?.candidates).toEqual([
      expect.objectContaining({ number: 1, votes: 7 }),
      expect.objectContaining({ number: 2, votes: 2 }),
    ]);
    expect(typeof okayama?.turnout_percentage).toBe("number");

    const tokyo = data.korda.find((k) => k.key === "/ppij/tokyo");
    expect(tokyo).toBeDefined();
    expect(tokyo?.name).toBe("Korda Tokyo");
    expect(tokyo?.ballot_count).toBe(10);
    expect(tokyo?.suppressed).toBe(false);
    expect(tokyo?.candidates).toEqual([
      expect.objectContaining({ number: 1, votes: 6 }),
      expect.objectContaining({ number: 2, votes: 4 }),
    ]);
  });

  it("safely groups malformed or non-standard komsat paths into a fallback region without crashing", async () => {
    await seedElection({ status: "locked", frozen: 20 });
    await seedCandidates();
    // Path without standard segments.
    await castBallot(1, "custom-path-without-slashes");
    await recordParticipation("alien-1", "custom-path-without-slashes");

    const res = await requestDashboard();
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardPayload;
    const fallback = data.korda.find((k) => k.key === "/custom-path-without-slashes");
    expect(fallback).toBeDefined();
    expect(fallback?.ballot_count).toBe(1);
    expect(fallback?.suppressed).toBe(false);
  });
});

type SingleChoice = "setuju" | "tidak_setuju" | "abstain";

/** Pemilihan mode kandidat tunggal dengan satu kandidat (id 1, nomor internal 1). */
async function seedSingleElection(opts: { status?: "draft" | "locked" | "published"; frozen?: number | null; closed?: boolean } = {}) {
  const status = opts.status ?? "locked";
  const opens = new Date(Date.now() - 3600e3).toISOString();
  const closes = new Date(Date.now() + (opts.closed ? -60e3 : 24 * 3600e3)).toISOString();
  const frozen = opts.frozen === undefined ? 100 : opts.frozen;
  await env.DB.prepare(
    "INSERT INTO elections (id, title, status_lock, opens_at, closes_at, allow_admin_voting, frozen_hak_pilih, frozen_at, single_candidate_mode) VALUES (1, 'Pemilihan', ?, ?, ?, 1, ?, ?, 1)",
  ).bind(status, opens, closes, frozen, status === "draft" ? null : new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO candidates (id, member_id, number, name, nickname, komsat_path, color) VALUES (1, 'cand-1', 1, 'Kandidat Satu', 'Satu', ?, '#ff0000')").bind(SCOPE).run();
}

/**
 * `count` surat suara nyata plus baris partisipasinya, ditulis satu batch supaya
 * tes tetap jauh di bawah batas waktu saat suite berjalan paralel.
 * tidak memilih = Hak pilih - partisipasi, jadi tiap surat suara butuh satu baris.
 */
async function castChoice(choice: SingleChoice, path: string, count = 1, opts: { isTest?: number } = {}) {
  const isTest = opts.isTest ?? 0;
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    statements.push(
      env.DB.prepare(
        "INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test, choice) VALUES (?, 1, 1, ?, ?, ?, ?)",
      ).bind(id, path, `hash-${id}`, isTest, choice),
    );
    if (!isTest) {
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO voters (member_id, name, komsat_path, status, synced_at, can_vote) VALUES (?, ?, ?, 'ACTIVE', ?, 1)",
        ).bind(`voter-${id}`, `voter-${id}`, path, new Date().toISOString()),
        env.DB.prepare(
          "INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (1, ?, ?, ?, 0)",
        ).bind(`voter-${id}`, `voter-${id}`, new Date().toISOString()),
      );
    }
  }
  await env.DB.batch(statements);
}

/** Anggota berhak yang tidak memilih; hanya menambah Hak pilih per korda. */
async function seedEligible(memberId: string, path: string) {
  await env.DB.prepare(
    "INSERT INTO voters (member_id, name, komsat_path, status, synced_at, can_vote) VALUES (?, ?, ?, 'ACTIVE', ?, 1)",
  ).bind(memberId, memberId, path, new Date().toISOString()).run();
}

/** Admin Voting menjalankan Rekapitulasi Suara: simpan Hak pilih dikurangi partisipasi nyata. */
async function countNow() {
  await env.DB.prepare(
    "UPDATE elections SET recap_at = ?, recap_abstain_count = MAX(0, frozen_hak_pilih - (SELECT COUNT(*) FROM participation WHERE election_id = 1 AND is_test = 0))",
  ).bind(new Date().toISOString()).run();
}

async function dashboardData(): Promise<DashboardPayload> {
  const res = await requestDashboard();
  expect(res.status).toBe(200);
  return (await res.json()) as DashboardPayload;
}

describe("Results API - Single candidate mode tallies (Setuju / Tidak Setuju / Abstain, no outcome)", () => {
  it("shows Setuju, Tidak Setuju and Abstain (cast plus non-voters) with their shares of Hak pilih", async () => {
    // Hak pilih 100: 50 Setuju, 30 Tidak Setuju, 5 Abstain diberikan, 15 tidak memilih.
    // Angka pilihan dibaca setelah Diumumkan (segel 2026-11-21).
    await seedSingleElection({ status: "published", closed: true });
    await castChoice("setuju", `${SCOPE}/komsat-a`, 50);
    await castChoice("tidak_setuju", `${SCOPE}/komsat-a`, 30);
    await castChoice("abstain", `${SCOPE}/komsat-a`, 5);
    await countNow();
    const data = await dashboardData();
    expect(data).toMatchObject({
      stage: "published",
      single_candidate_mode: true,
      eligible_count: 100,
      setuju_count: 50,
      tidak_setuju_count: 30,
      abstain_cast_count: 5,
      tidak_memilih_count: 15,
      abstain_count: 20,
      setuju_percentage: 50,
      tidak_setuju_percentage: 30,
      abstain_percentage: 20,
      ballot_count: 85,
    });
    // Tiga bagian menjumlah ke Hak pilih; tidak ada data per orang di payload.
    expect(data.setuju_count! + data.tidak_setuju_count! + data.abstain_count!).toBe(data.eligible_count);
    expect(data.setuju_percentage! + data.tidak_setuju_percentage! + data.abstain_percentage!).toBe(100);
    expect(JSON.stringify(data)).not.toContain("voter-");
    // Larik kandidat tetap ada supaya pemeriksaan jumlah surat suara tetap utuh.
    expect(data.candidates).toHaveLength(1);
    expect(data.candidates[0]).toMatchObject({ id: 1, votes: 85 });
  });

  it("counts non-voters as Abstain, never as Tidak Setuju", async () => {
    // Hak pilih 100, hanya 40 Setuju dan 35 Tidak Setuju, 25 tidak memilih.
    await seedSingleElection({ status: "published", closed: true });
    await castChoice("setuju", `${SCOPE}/komsat-a`, 40);
    await castChoice("tidak_setuju", `${SCOPE}/komsat-a`, 35);
    await countNow();
    const data = await dashboardData();
    expect(data).toMatchObject({
      tidak_setuju_count: 35,
      tidak_setuju_percentage: 35,
      abstain_cast_count: 0,
      tidak_memilih_count: 25,
      abstain_count: 25,
      abstain_percentage: 25,
    });
  });

  it("never states an outcome, in any stage, on Dasbor or public results", async () => {
    // Setuju melebihi separuh, sama kuat, dan kalah: tidak ada yang menghasilkan baris keputusan.
    for (const [setuju, tidak] of [[60, 10], [50, 20], [10, 60]] as const) {
      await reset();
      await applyMigrations();
      await seedBase();
      await seedSingleElection({ closed: true });
      await castChoice("setuju", `${SCOPE}/komsat-a`, setuju);
      await castChoice("tidak_setuju", `${SCOPE}/komsat-a`, tidak);
      const closed = await dashboardData();
      expect(closed).not.toHaveProperty("outcome");
      expect(JSON.stringify(closed)).not.toMatch(/terpilih|seri|menunggu/i);
    }
    await reset();
    await applyMigrations();
    await seedBase();
    await seedSingleElection();
    await castChoice("setuju", `${SCOPE}/komsat-a`, 5);
    const open = await dashboardData();
    // Sebelum Diumumkan angka pilihan disegel; angka partisipasi tetap terbuka.
    expect(open).toMatchObject({ stage: "open", tally_sealed: true, setuju_count: null, tidak_memilih_count: 95 });
    expect(open).not.toHaveProperty("outcome");
    await env.DB.prepare("UPDATE elections SET status_lock = 'draft', frozen_hak_pilih = NULL, frozen_at = NULL").run();
    expect(await dashboardData()).not.toHaveProperty("outcome");
    await env.DB.prepare("UPDATE elections SET status_lock = 'published', frozen_hak_pilih = 100, closes_at = ?").bind(new Date(Date.now() - 60e3).toISOString()).run();
    const published = (await (await requestPublicResults()).json()) as ResultsPayload;
    expect(published).not.toHaveProperty("outcome");
  });

  it("counts every eligible member as Abstain (tidak memilih) when no ballots were cast", async () => {
    await seedSingleElection({ status: "published", closed: true });
    await countNow();
    const res = await requestPublicResults();
    expect(res.status).toBe(200);
    // Publik hanya persentase (owner 2026-11-26); angka Abstain tetap di Dasbor.
    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toEqual({ stage: "published", updated_at: expect.any(String), single_candidate_mode: true, has_votes: false, setuju_percentage: 0, tidak_setuju_percentage: 0, korda: expect.any(Array) });
    expect(await dashboardData()).toMatchObject({ tidak_memilih_count: 100, abstain_count: 100, ballot_count: 0 });
  });

  it("carries the counts for every korda, including one with only 4 ballots", async () => {
    // Korda Okayama: 10 pemilih (termasuk admin-1 dari seedBase) + 9 yang tidak
    // memilih = 20 Hak pilih, dengan 10 surat suara (5 Setuju, 3 Tidak Setuju, 2 Abstain).
    await seedSingleElection({ frozen: 24 });
    for (let i = 0; i < 9; i++) await seedEligible(`ok-extra-${i}`, `${SCOPE}/komsat-z`);
    await castChoice("setuju", `${SCOPE}/komsat-a`, 5);
    await castChoice("tidak_setuju", `${SCOPE}/komsat-a`, 3);
    await castChoice("abstain", `${SCOPE}/komsat-a`, 2);
    // Korda Tokyo: 4 surat suara; tanpa ambang, angkanya tetap tampil.
    await castChoice("setuju", "/ppij/tokyo/komsat-a", 4);
    // Sebelum Diumumkan setiap angka pilihan per korda disegel; partisipasinya tetap.
    const sealedRow = (await dashboardData()).korda.find((row) => row.key === SCOPE);
    expect(sealedRow).toMatchObject({ eligible_count: 20, used_count: 10, ballot_count: 10, suppressed: false, tidak_memilih_count: null });
    for (const field of SEALED_KORDA_CHOICE_FIELDS) expect(sealedRow).not.toHaveProperty(field);
    // Alur nyata: rekap lalu Diumumkan; angka per korda muncul sesudahnya.
    await countNow();
    await env.DB.prepare("UPDATE elections SET status_lock = 'published'").run();
    const data = await dashboardData();
    const okayama = data.korda.find((row) => row.key === SCOPE);
    expect(okayama).toMatchObject({
      eligible_count: 20,
      used_count: 10,
      ballot_count: 10,
      suppressed: false,
      setuju_count: 5,
      tidak_setuju_count: 3,
      abstain_cast_count: 2,
      tidak_memilih_count: 10,
      abstain_count: 12,
      setuju_percentage: 25,
      tidak_setuju_percentage: 15,
      abstain_percentage: 60,
    });
    for (const field of SEALED_KORDA_CHOICE_FIELDS) expect(okayama).toHaveProperty(field);
    const tokyo = data.korda.find((row) => row.key === "/ppij/tokyo");
    expect(tokyo).toMatchObject({ ballot_count: 4, suppressed: false, setuju_count: 4, tidak_setuju_count: 0 });
    expect(tokyo?.candidates).not.toBeNull();
  });

  it("keeps Draf test ballots sealed while their participation counts stay visible", async () => {
    await seedSingleElection({ status: "draft" });
    await castChoice("setuju", `${SCOPE}/komsat-a`, 1, { isTest: 1 });
    await castChoice("tidak_setuju", `${SCOPE}/komsat-a`, 1, { isTest: 1 });
    await castChoice("abstain", `${SCOPE}/komsat-a`, 1, { isTest: 1 });
    const data = await dashboardData();
    expect(data).toMatchObject({
      stage: "draft",
      tally_sealed: true,
      setuju_count: null,
      tidak_setuju_count: null,
      abstain_cast_count: null,
      tidak_memilih_count: 100,
      abstain_counted: false,
      abstain_count: null,
      ballot_count: 3,
      test: { participation_count: 0, ballot_count: 3 },
    });
    expect(data).not.toHaveProperty("outcome");
  });

  it("keeps the tally sealed and the non-voter count visible before the recap", async () => {
    await seedSingleElection({ closed: true });
    await castChoice("setuju", `${SCOPE}/komsat-a`, 50);
    await castChoice("tidak_setuju", `${SCOPE}/komsat-a`, 30);
    await castChoice("abstain", `${SCOPE}/komsat-a`, 5);
    const data = await dashboardData();
    // Tidak memilih adalah angka partisipasi, jadi tetap terbuka; angka pilihan disegel.
    expect(data).toMatchObject({
      stage: "closed",
      abstain_counted: false,
      abstain_counted_at: null,
      tally_sealed: true,
      abstain_cast_count: null,
      tidak_memilih_count: 15,
      abstain_count: null,
      abstain_percentage: null,
      ballot_count: 85,
    });
  });

  it("after the recap the Abstain total is cast plus the stored count, and the stored count stays fixed", async () => {
    await seedSingleElection({ closed: true });
    await castChoice("setuju", `${SCOPE}/komsat-a`, 50);
    await castChoice("abstain", `${SCOPE}/komsat-a`, 5);
    await countNow();
    await env.DB.prepare("UPDATE elections SET status_lock = 'published'").run();
    // Anggota baru yang disinkronkan sesudahnya tidak mengubah angka tersimpan.
    await seedEligible("late-member", `${SCOPE}/komsat-z`);
    const data = await dashboardData();
    expect(data).toMatchObject({
      abstain_counted: true,
      abstain_cast_count: 5,
      tidak_memilih_count: 45,
      abstain_count: 50,
      abstain_percentage: 50,
    });
    expect(data.abstain_counted_at).not.toBeNull();
  });

  it("keeps today's payload shape with the mode off", async () => {
    await seedElection({ status: "published", frozen: 100 });
    await seedCandidates();
    for (let i = 0; i < 12; i++) await castBallot(1, `${SCOPE}/komsat-a`);
    const data = await dashboardData();
    expect(data).toMatchObject({
      single_candidate_mode: false,
      setuju_count: null,
      tidak_setuju_count: null,
      abstain_cast_count: null,
      tidak_memilih_count: null,
      abstain_count: null,
      setuju_percentage: null,
      abstain_percentage: null,
      ballot_count: 12,
    });
    expect(data).not.toHaveProperty("outcome");
    // Daftar kandidat dan rincian per korda tetap seperti hari ini.
    expect(data.candidates.map((candidate) => candidate.number)).toEqual([1, 2]);
    expect(data.korda[0]?.candidates?.map((candidate) => candidate.votes)).toEqual([12, 0]);
  });
});

/** Tindakan Admin Voting lewat dispatcher produksi; sesi admin-1 dari seedBase. */
async function adminAction(path: string, method: "POST" | "GET" = "POST", body: unknown = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("cookie", await sessionCookie("admin-1", "Admin 1"));
  return app.request(path, { method, headers, body: method === "POST" ? JSON.stringify(body) : undefined }, bindings);
}

/** Medan pilihan per korda yang tidak boleh ada sama sekali sebelum Diumumkan. */
const SEALED_KORDA_CHOICE_FIELDS = [
  "candidates",
  "setuju_count",
  "tidak_setuju_count",
  "abstain_cast_count",
  "abstain_count",
  "setuju_percentage",
  "tidak_setuju_percentage",
  "abstain_percentage",
] as const;

/** Angka pilihan yang harus null selama hasil disegel sebelum Diumumkan. */
const SEALED_CHOICE_FIELDS = [
  "setuju_count",
  "tidak_setuju_count",
  "abstain_cast_count",
  "abstain_count",
  "setuju_percentage",
  "tidak_setuju_percentage",
  "abstain_percentage",
] as const;

describe("Results API - Tally sealed until Diumumkan (keputusan owner 2026-11-21)", () => {
  it("menyegel setiap angka pilihan mode kandidat tunggal sebelum Diumumkan dan tetap menyajikan partisipasi", async () => {
    await seedSingleElection({ frozen: 100 });
    await castChoice("setuju", `${SCOPE}/komsat-a`, 5);
    await castChoice("tidak_setuju", `${SCOPE}/komsat-a`, 2);
    const res = await requestDashboard();
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardPayload;
    expect(data).toMatchObject({
      stage: "open",
      tally_sealed: true,
      single_candidate_mode: true,
      eligible_count: 100,
      used_count: 7,
      unused_count: 93,
      turnout_percentage: 7,
      participation_count: 7,
      ballot_count: 7,
      count_matches: true,
      // Tidak memilih adalah angka partisipasi, bukan angka pilihan.
      tidak_memilih_count: 93,
      abstain_counted: false,
    });
    for (const field of SEALED_CHOICE_FIELDS) expect(data[field]).toBeNull();
    // Tidak ada satu angka pilihan pun yang lolos di badan respons.
    expect(JSON.stringify(data)).not.toMatch(/"(setuju_count|tidak_setuju_count|abstain_cast_count|abstain_count)":\s*\d/);
    // Larik kandidat tetap ada (nomor, nickname, warna) tanpa perolehan suara.
    expect(data.candidates.map((candidate) => candidate.votes)).toEqual([null]);
    const row = data.korda.find((entry) => entry.key === SCOPE);
    expect(row).toMatchObject({ eligible_count: 8, used_count: 7, ballot_count: 7 });
    expect(typeof row?.turnout_percentage).toBe("number");
    // Medan pilihan per korda tidak dikirim sama sekali, bukan sekadar null.
    for (const field of SEALED_KORDA_CHOICE_FIELDS) expect(row).not.toHaveProperty(field);
  });

  it("menyegel perolehan kandidat dan rincian korda mode biasa sebelum Diumumkan", async () => {
    await seedElection({ status: "locked", frozen: 100 });
    await seedCandidates();
    for (let i = 0; i < 12; i++) await castBallot(1, `${SCOPE}/komsat-a`);
    const data = (await (await requestDashboard()).json()) as DashboardPayload;
    expect(data).toMatchObject({ tally_sealed: true, ballot_count: 12, participation_count: 0, count_matches: false });
    expect(data.candidates.map((candidate) => candidate.votes)).toEqual([null, null]);
    expect(data.candidates.map((candidate) => candidate.nickname)).toEqual(["Satu", "Dua"]);
    const row = data.korda.find((entry) => entry.key === SCOPE);
    expect(row).toMatchObject({ ballot_count: 12, suppressed: false });
    for (const field of SEALED_KORDA_CHOICE_FIELDS) expect(row).not.toHaveProperty(field);
    expect(JSON.stringify(data)).not.toContain('"votes":12');
  });

  it("membuka seluruh angka setelah Diumumkan pada kedua mode", async () => {
    await seedSingleElection({ status: "published", closed: true });
    await castChoice("setuju", `${SCOPE}/komsat-a`, 50);
    await castChoice("tidak_setuju", `${SCOPE}/komsat-a`, 30);
    await castChoice("abstain", `${SCOPE}/komsat-a`, 5);
    await countNow();
    const single = (await (await requestDashboard()).json()) as DashboardPayload;
    expect(single).toMatchObject({ stage: "published", tally_sealed: false, setuju_count: 50, tidak_setuju_count: 30, abstain_cast_count: 5, abstain_count: 20, tidak_memilih_count: 15 });
    const publicSingle = (await (await requestPublicResults()).json()) as ResultsPayload;
    // Publik: hanya persentase dari suara masuk (50 Setuju, 30 Tidak Setuju; baris Abstain lama tidak ikut).
    expect(publicSingle).toMatchObject({ has_votes: true, setuju_percentage: 62.5, tidak_setuju_percentage: 37.5 });
    for (const field of ["setuju_count", "tidak_setuju_count", "abstain_count", "eligible_count", "used_count", "turnout_percentage", "ballot_count", "participation_count"]) expect(publicSingle).not.toHaveProperty(field);
    for (const row of (publicSingle as unknown as { korda: Record<string, unknown>[] }).korda) {
      expect(Object.keys(row).sort()).toEqual(["has_votes", "key", "name", "setuju_percentage", "tidak_setuju_percentage"]);
    }

    await reset();
    await applyMigrations();
    await seedBase();
    await seedElection({ status: "published", frozen: 100 });
    await seedCandidates();
    for (let i = 0; i < 12; i++) await castBallot(1, `${SCOPE}/komsat-a`);
    const multi = (await (await requestDashboard()).json()) as DashboardPayload;
    expect(multi.tally_sealed).toBe(false);
    expect(multi.candidates.map((candidate) => candidate.votes)).toEqual([12, 0]);
    const multiRow = multi.korda.find((entry) => entry.key === SCOPE);
    expect(multiRow?.candidates?.map((candidate) => candidate.votes)).toEqual([12, 0]);
    for (const field of SEALED_KORDA_CHOICE_FIELDS) expect(multiRow).toHaveProperty(field);
    const publicMulti = (await (await requestPublicResults()).json()) as ResultsPayload;
    expect(publicMulti.candidates[0]?.votes).toBe(12);
  });

  it("menjalankan Tutup, Rekapitulasi Suara dan Umumkan Hasil dengan segel yang membuka bagi panitia saja", async () => {
    await seedSingleElection({ frozen: 100 });
    await castChoice("setuju", `${SCOPE}/komsat-a`, 5);
    await castChoice("tidak_setuju", `${SCOPE}/komsat-a`, 3);
    // Tutup lebih awal; angka pilihan tetap disegel bagi semua orang.
    expect((await adminAction("/api/election/close", "POST", { reason: "Batas waktu" })).status).toBe(200);
    const closed = (await (await requestDashboard()).json()) as DashboardPayload;
    expect(closed).toMatchObject({ stage: "closed", tally_sealed: true, ballot_count: 8, tidak_memilih_count: 92, recap_done: false, recap_at: null });
    // Umumkan ditolak karena rekap belum dijalankan, dengan pesan yang jelas.
    const refused = await adminAction("/api/election/publish");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain("Rekapitulasi Suara");
    // Rekap hanya butuh angka partisipasi: angka tidak memilih akan disimpan.
    const state = await adminAction("/api/election/recap", "GET");
    expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({ single_candidate_mode: true, stage: "closed", done: false, pending_count: 92, can_run: true });
    expect((await adminAction("/api/election/recap")).status).toBe(200);
    // Segel membuka bagi Admin Voting setelah rekap, meski belum Diumumkan.
    const afterRecap = (await (await requestDashboard()).json()) as DashboardPayload;
    expect(afterRecap).toMatchObject({ tally_sealed: false, recap_done: true, abstain_counted: true, setuju_count: 5, tidak_setuju_count: 3, abstain_count: 92, tidak_memilih_count: 92 });
    // Jalur publik tetap disegel sampai Diumumkan.
    const publicBefore = await requestPublicResults();
    expect(publicBefore.status).toBe(409);
    // Umumkan diterima setelah rekap.
    expect((await adminAction("/api/election/publish")).status).toBe(200);
    const published = (await (await requestDashboard()).json()) as DashboardPayload;
    expect(published).toMatchObject({ stage: "published", tally_sealed: false, setuju_count: 5, abstain_count: 92 });
    const publicResults = await requestPublicResults();
    expect(publicResults.status).toBe(200);
    const publicBody = (await publicResults.json()) as Record<string, unknown>;
    expect(publicBody).not.toHaveProperty("setuju_count");
    expect(publicBody).toMatchObject({ has_votes: true });
  });

  it("mencatat satu entri tally view per muat Dasbor selama angka disegel", async () => {
    await seedSingleElection({ frozen: 100 });
    await castChoice("setuju", `${SCOPE}/komsat-a`, 3);
    expect((await requestDashboard()).status).toBe(200);
    const rows = (await env.DB.prepare("SELECT action, detail_json FROM audit_log ORDER BY seq").all<{ action: string; detail_json: string | null }>()).results;
    expect(rows.filter((row) => row.action === "admin_tally_viewed")).toEqual([{ action: "admin_tally_viewed", detail_json: JSON.stringify({ stage: "open" }) }]);
    const chain = await env.DB.prepare("SELECT seq, at, actor_type, actor_member_id, actor_name, action, target, komsat_path, detail_json, prev_hash, hash FROM audit_log ORDER BY seq").all<AuditRow>();
    expect(await verifyChain(chain.results)).toBeNull();
    // Detail entri tidak pernah memuat angka pilihan.
    for (const row of rows) expect(row.detail_json ?? "").not.toMatch(/setuju|abstain|candidate/i);
  });
});

describe("Results API - Audit Trail and Privacy", () => {
  it("audit-logs each admin tally load with the actual actor and valid SHA-256 chain", async () => {
    await seedElection({ status: "locked", frozen: 10 });
    await seedCandidates();

    // Klaim nama sesi berisi UUID anggota; nama roll portal yang dipakai.
    const first = await requestDashboard("admin-1", "2b6b8200-6b6b-4e04-960d-1023682c5d56");
    expect(first.status).toBe(200);
    const second = await requestDashboard("admin-1", "2b6b8200-6b6b-4e04-960d-1023682c5d56");
    expect(second.status).toBe(200);

    const rows = (
      await env.DB.prepare("SELECT seq, at, actor_type, actor_member_id, actor_name, action, target, komsat_path, detail_json, prev_hash, hash FROM audit_log ORDER BY seq").all<AuditRow>()
    ).results;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === "admin_tally_viewed")).toBe(true);
    expect(rows[0]!.actor_type).toBe("admin");
    expect(rows[0]!.actor_member_id).toBe("admin-1");
    expect(rows[0]!.actor_name).toBe("Admin 1");
    // Verify no ballot IDs, candidate choices or member IDs leaked into detail_json.
    expect(rows[0]!.detail_json).toBe(JSON.stringify({ stage: "open" }));
    // SHA-256 chain is valid.
    expect(await verifyChain(rows)).toBeNull();
  });

  it("serves aggregate results after publication without leaking voter identities or timestamps", async () => {
    await seedElection({ status: "published", frozen: 50 });
    await seedCandidates();
    // 10 ballots in Tokyo so candidate breakdown is visible.
    for (let i = 1; i <= 10; i++) {
      await castBallot(1, `/ppij/tokyo/komsat-${i}`);
      await recordParticipation(`secret-voter-${i}`, `/ppij/tokyo/komsat-${i}`);
    }

    const res = await requestPublicResults();
    expect(res.status).toBe(200);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("secret-voter");
    expect(bodyText).not.toContain("voted_at");
    expect(bodyText).not.toContain("receipt_hash");
    expect(bodyText).not.toContain("committee_warning");

    const data = JSON.parse(bodyText) as ResultsPayload;
    expect(data.stage).toBe("published");
    expect(data.participation_count).toBe(10);
    expect(data.ballot_count).toBe(10);
    expect(data.count_matches).toBe(true);
    expect(data.candidates.find((c) => c.number === 1)?.votes).toBe(10);
    // Public reads append zero audit rows.
    const auditCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    expect(auditCount?.n).toBe(0);
  });

  it("labels test votes in Draf, but excludes them from later stages", async () => {
    await seedElection({ status: "draft", allowAdminVoting: 1 });
    await seedCandidates();
    // 1 real ballot, 2 test ballots.
    await castBallot(1, `${SCOPE}/komsat-a`, 0);
    await castBallot(1, `${SCOPE}/komsat-a`, 1);
    await castBallot(2, `${SCOPE}/komsat-a`, 1);
    await recordParticipation("admin-1", `${SCOPE}/komsat-a`, 0);
    await recordParticipation("test-p-1", `${SCOPE}/komsat-a`, 1);

    const draftRes = await requestDashboard();
    expect(draftRes.status).toBe(200);
    const draftData = (await draftRes.json()) as DashboardPayload;
    // Draf includes test rows in overall counts and labels them in .test.
    expect(draftData.ballot_count).toBe(3);
    expect(draftData.test).toEqual({ participation_count: 1, ballot_count: 2 });

    // Transition to locked: test rows must be ignored by queries.
    await env.DB.prepare("UPDATE elections SET status_lock = 'locked', frozen_hak_pilih = 10 WHERE id = 1").run();
    const lockedRes = await requestDashboard();
    expect(lockedRes.status).toBe(200);
    const lockedData = (await lockedRes.json()) as DashboardPayload;
    expect(lockedData.ballot_count).toBe(1);
    expect(lockedData.test).toBeNull();
  });

  it("counts active invite links in Hak pilih, keeping used ones and dropping cancelled ones", async () => {
    await seedElection({ status: "locked", frozen: 100 });
    await inviteRow("INV001");
    await inviteRow("INV002");
    await inviteRow("INV003", { used: true, komsat: `${SCOPE}/komsat-a` });
    await inviteRow("INV004", { cancelled: true });
    const res = await requestDashboard();
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardPayload;
    // 100 roll + 3 tautan hidup (INV001, INV002, INV003); yang dibatalkan tidak dihitung.
    expect(data.active_invite_count).toBe(3);
    expect(data.eligible_count).toBe(103);
    expect(data.unused_count).toBe(103);
    expect(data.count_matches).toBe(true);
  });

  it("adds the invite term to the Draf roll fallback", async () => {
    await seedElection({ status: "draft", frozen: null });
    await env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at, can_vote) VALUES ('m-1', 'M 1', ?, 'ACTIVE', ?, 1), ('m-2', 'M 2', ?, 'ACTIVE', ?, 1)")
      .bind(`${SCOPE}/komsat-a`, new Date().toISOString(), `${SCOPE}/komsat-a`, new Date().toISOString()).run();
    await inviteRow("INV001");
    const res = await requestDashboard();
    const data = (await res.json()) as DashboardPayload;
    // admin-1 + m-1 + m-2 = 3 baris roll, ditambah 1 tautan.
    expect(data.active_invite_count).toBe(1);
    expect(data.eligible_count).toBe(4);
  });

  it("counts a used invite in its chosen korda and keeps unused links out of every korda", async () => {
    await seedElection({ status: "locked", frozen: 40 });
    await seedCandidates();
    await inviteRow("INV001");
    await inviteRow("INV002", { used: true, komsat: `${SCOPE}/komsat-a` });
    await env.DB.prepare("INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test) VALUES (1, 'undangan:INV002', 'Tamu INV002', ?, 0)")
      .bind(new Date().toISOString()).run();
    await castBallot(1, `${SCOPE}/komsat-a`, 0);
    const res = await requestDashboard();
    const data = (await res.json()) as DashboardPayload;
    expect(data.eligible_count).toBe(42);
    const okayama = data.korda.find((row) => row.key === SCOPE)!;
    // Korda Okayama: baris roll (admin-1, dua kandidat) ditambah satu tautan terpakai.
    expect(okayama.eligible_count).toBe(4);
    expect(okayama.used_count).toBe(1);
    expect(okayama.ballot_count).toBe(1);
    expect(okayama.suppressed).toBe(false);
    const total = data.korda.reduce((sum, row) => sum + row.eligible_count, 0);
    // Tautan belum dipakai dihitung nasional saja, jadi jumlah korda lebih kecil.
    expect(total).toBe(4);
    expect(data.eligible_count - total).toBe(38);
  });

  it("treats unused links as non-voters, not as a count mismatch", async () => {
    await seedElection({ status: "locked", frozen: 10 });
    await seedCandidates();
    await inviteRow("INV001");
    await inviteRow("INV002");
    await recordParticipation("admin-1", `${SCOPE}/komsat-a`);
    await castBallot(1, `${SCOPE}/komsat-a`);
    const res = await requestDashboard();
    const data = (await res.json()) as DashboardPayload;
    expect(data.eligible_count).toBe(12);
    expect(data.participation_count).toBe(1);
    expect(data.ballot_count).toBe(1);
    expect(data.count_matches).toBe(true);
    expect(data.unused_count).toBe(11);
  });

  it("excludes unused links from the recap pending count; the recap will cancel them", async () => {
    // Keputusan pemilik 2026-11-22: tautan tidak dihitung Abstain. Angka yang
    // disimpan rekap hanya anggota roll yang tidak memilih; tautan yang belum
    // dipakai akan dibatalkan oleh rekap dan tidak lagi menambah Hak pilih.
    await seedElection({ status: "locked", frozen: 10 });
    await env.DB.prepare("UPDATE elections SET single_candidate_mode = 1 WHERE id = 1").run();
    await inviteRow("INV001");
    await inviteRow("INV002");
    const count = await getRecapState(env.DB, new Date());
    expect(count.pending_count).toBe(10); // Hak pilih 12 (10 + 2 aktif) - 2 tautan yang akan dibatalkan - 0 partisipasi
    expect(count.unused_links).toBe(2);
  });
});

describe("Results API - Tidak Membekukan DPT (Hak pilih)", () => {
  async function seedLive(opts: { status?: "locked" | "published"; single?: boolean } = {}) {
    await seedElection({ status: opts.status ?? "locked" });
    await env.DB.prepare("UPDATE elections SET live_voter_roll=1, frozen_hak_pilih=NULL, frozen_at=NULL").run();
    if (opts.single) await env.DB.prepare("UPDATE elections SET single_candidate_mode=1").run();
    // Tiga anggota berhak (satu Admin Voting; pengaturan default mengizinkan).
    for (const member of ["anggota-1", "anggota-2", "anggota-3"]) {
      await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at,can_vote) VALUES (?, ?, ?, 'ACTIVE', ?, 1)").bind(member, member, `${SCOPE}/komsat-a`, new Date().toISOString()).run();
    }
  }
  it("Hak pilih live saat Dibuka: eligible dari view portal", async () => {
    await seedLive();
    await recordParticipation("anggota-1", `${SCOPE}/komsat-a`);
    // View: admin-1 (dari seedBase, diizinkan ikut) + tiga anggota.
    const res = await requestDashboard("admin-1");
    expect(res.status).toBe(200);
    const data = await res.json() as DashboardPayload;
    expect(data.live_voter_roll).toBe(true);
    expect(data.eligible_count).toBe(4);
    expect(data.participation_count).toBe(1);
    // View bertambah: angka Hak pilih ikut naik saat refresh berikutnya.
    await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at,can_vote) VALUES ('anggota-4','anggota-4',?, 'ACTIVE', ?, 1)").bind(`${SCOPE}/komsat-a`, new Date().toISOString()).run();
    const again = await requestDashboard("admin-1");
    expect(((await again.json()) as DashboardPayload).eligible_count).toBe(5);
  });
  it("pembacaan Dasbor memicu segarkan portal: anggota baru naik tanpa ada yang memilih", async () => {
    await seedLive();
    // Watermark lama supaya pembacaan berikutnya menyegarkan dari delta stub.
    await env.DB.prepare("INSERT INTO system_config (key,value) VALUES ('pemilih_last_sync',?)").bind(new Date(Date.now() - 120_000).toISOString()).run();
    const grown = createServiceApiStub({ all: allPortalMembers(), changed: changedPortalMembers() });
    const portal = { issuer: grown.issuer, clientId: "c", clientSecret: "s", serviceApiUrl: grown.serviceUrl, fetchImpl: grown.fetchImpl };
    // Delta stub menambah member-9..11 (member-1 tidak ada di view seed): 4 + 3.
    const data = await getDashboard(env.DB, new Date(), portal);
    expect(data.live_voter_roll).toBe(true);
    expect(data.eligible_count).toBe(7);
    expect(data.participation_count).toBe(0);
  });
  it("setelah Ditutup: eligible dari snapshot tersimpan, tidak berubah walau view bergeser", async () => {
    await seedLive();
    await recordParticipation("anggota-1", `${SCOPE}/komsat-a`);
    await env.DB.prepare("UPDATE elections SET closes_at=?").bind(new Date(Date.now() - 3_600e3).toISOString()).run();
    const res = await requestDashboard("admin-1");
    const data = await res.json() as DashboardPayload;
    expect(data.stage).toBe("closed");
    expect(data.eligible_count).toBe(4);
    const saved = await env.DB.prepare("SELECT closing_hak_pilih,closing_hak_pilih_at FROM elections").first<{ closing_hak_pilih: number; closing_hak_pilih_at: string }>();
    expect(saved!.closing_hak_pilih).toBe(4);
    expect(saved!.closing_hak_pilih_at).not.toBeNull();
    // View bergeser setelah penutupan tidak menggerakkan angka.
    await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at,can_vote) VALUES ('anggota-4','anggota-4',?, 'ACTIVE', ?, 1)").bind(`${SCOPE}/komsat-a`, new Date().toISOString()).run();
    const again = await requestDashboard("admin-1");
    expect(((await again.json()) as DashboardPayload).eligible_count).toBe(4);
  });
  it("saklar mati: eligible tetap dari Hak pilih beku", async () => {
    await seedElection({ frozen: 7 });
    const res = await requestDashboard("admin-1");
    const data = await res.json() as DashboardPayload;
    expect(data.live_voter_roll).toBe(false);
    expect(data.eligible_count).toBe(7);
    expect(await env.DB.prepare("SELECT closing_hak_pilih FROM elections").first()).toEqual({ closing_hak_pilih: null });
  });
  it("Rekapitulasi dan hasil memakai angka tersimpan pada live single mode", async () => {
    await seedLive({ single: true });
    // Satu kandidat (mode kandidat tunggal) plus roll dari seedBase dan seedLive.
    await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at,can_vote) VALUES ('cand-1','Kandidat Satu',?, 'ACTIVE', ?, 1)").bind(`${SCOPE}/komsat-a`, new Date().toISOString()).run();
    await env.DB.prepare("INSERT INTO candidates (id,member_id,number,name,nickname,komsat_path,color) VALUES (1,'cand-1',1,'Kandidat Satu','Satu',?, '#ff0000')").bind(`${SCOPE}/komsat-a`).run();
    await recordParticipation("anggota-1", `${SCOPE}/komsat-a`);
    await env.DB.prepare("INSERT INTO ballots (id,election_id,candidate_id,komsat_path,receipt_hash,is_test,choice) VALUES ('b1',1,1,?, 'h-b1',0,'setuju')").bind(`${SCOPE}/komsat-a`).run();
    await env.DB.prepare("UPDATE elections SET closes_at=?").bind(new Date(Date.now() - 3_600e3).toISOString()).run();
    const { runRecap } = await import("../src/server/election/lifecycle");
    const result = await runRecap(env.DB, new Date(), { member_id: "admin-1", name: "Admin 1" });
    expect(result.abstain_count).toBe(4); // 5 tersimpan (admin+3 anggota+kandidat) - 1 partisipasi
    // Alur nyata: angka pilihan baru dibaca setelah Diumumkan.
    await env.DB.prepare("UPDATE elections SET status_lock = 'published'").run();
    const res = await requestDashboard("admin-1");
    const data = await res.json() as DashboardPayload;
    expect(data.eligible_count).toBe(5);
    expect(data.setuju_count).toBe(1);
    expect(data.tidak_memilih_count).toBe(4);
    expect(data.abstain_count).toBe(4);
    expect(data.setuju_percentage).toBeCloseTo(20, 1);
    expect(data.abstain_percentage).toBeCloseTo(80, 1);
  });
});

/** Baris undangan langsung untuk uji agregasi; tidak lewat HTTP. */
async function inviteRow(
  reference: string,
  opts: { used?: boolean; cancelled?: boolean; komsat?: string | null } = {},
) {
  await env.DB.prepare(
    "INSERT INTO direct_invitations (reference, token_hash, token_enc, created_at, created_by, created_by_name, used_at, cancelled_at, komsat_path, guest_name, guest_email) VALUES (?, ?, ?, ?, 'admin-1', 'Admin 1', ?, ?, ?, ?, ?)",
  )
    .bind(
      reference,
      `hash-${reference}`,
      "v1:sealed:sealed",
      new Date().toISOString(),
      opts.used ? new Date().toISOString() : null,
      opts.cancelled ? new Date().toISOString() : null,
      opts.komsat ?? null,
      opts.used ? `Tamu ${reference}` : null,
      opts.used ? "tamu@example.test" : null,
    )
    .run();
}
