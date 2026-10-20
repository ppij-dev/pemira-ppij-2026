import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import lockSql from "../migrations/0003_election_lock.sql?raw";
import { app } from "../src/server/app";
import { sealSession } from "../src/server/auth/session";
import { verifyChain, type AuditRow } from "../src/server/lib/audit";
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
  for (const file of [initSql, unitsSql, lockSql]) {
    const stmts = file.split(";").map((s) => s.trim()).filter(Boolean);
    await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
  }
}

async function seedBase() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO system_config (key, value) VALUES ('initialized', '1'), ('site_scope', ?), ('site_base_url', 'https://election.test')").bind(SCOPE),
    env.DB.prepare("INSERT INTO admin_voting (member_id, name, is_technical, created_at) VALUES ('admin-1', 'Admin 1', 1, ?)").bind(new Date().toISOString()),
    env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at) VALUES ('admin-1', 'Admin 1', ?, 'ACTIVE', ?)").bind(`${SCOPE}/komsat-a`, new Date().toISOString()),
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
    env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at) VALUES ('cand-1', 'Kandidat Satu', ?, 'ACTIVE', ?), ('cand-2', 'Kandidat Dua', ?, 'ACTIVE', ?)").bind(SCOPE, new Date().toISOString(), SCOPE, new Date().toISOString()),
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
    "INSERT OR IGNORE INTO voters (member_id, name, komsat_path, status, synced_at) VALUES (?, ?, ?, 'ACTIVE', ?)",
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
      await env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at) VALUES (?, ?, ?, 'ACTIVE', ?)").bind(`v-${i}`, `V ${i}`, `${SCOPE}/komsat-a`, new Date().toISOString()).run();
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

  it("includes zero-vote candidates in overall candidate tally", async () => {
    await seedElection({ status: "locked", frozen: 100 });
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

describe("Results API - Korda Suppression and Fallback", () => {
  it("suppresses candidate counts when region ballots < 10 but displays turnout", async () => {
    await seedElection({ status: "locked", frozen: 100 });
    await seedCandidates();

    // Okayama region: 9 ballots (suppressed).
    for (let i = 1; i <= 9; i++) {
      await castBallot(1, `${SCOPE}/komsat-${i}`);
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
    expect(okayama?.suppressed).toBe(true);
    expect(okayama?.candidates).toBeNull();
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
    expect(fallback?.suppressed).toBe(true);
  });
});

describe("Results API - Audit Trail and Privacy", () => {
  it("audit-logs each admin tally load with the actual actor and valid SHA-256 chain", async () => {
    await seedElection({ status: "locked", frozen: 10 });
    await seedCandidates();

    const first = await requestDashboard("admin-1", "Rina Admin");
    expect(first.status).toBe(200);
    const second = await requestDashboard("admin-1", "Rina Admin");
    expect(second.status).toBe(200);

    const rows = (
      await env.DB.prepare("SELECT seq, at, actor_type, actor_member_id, actor_name, action, target, komsat_path, detail_json, prev_hash, hash FROM audit_log ORDER BY seq").all<AuditRow>()
    ).results;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === "admin_tally_viewed")).toBe(true);
    expect(rows[0]!.actor_type).toBe("admin");
    expect(rows[0]!.actor_member_id).toBe("admin-1");
    expect(rows[0]!.actor_name).toBe("Rina Admin");
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
});
