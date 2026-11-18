/**
 * Test endpoint publik /api/turnout (statistik Jumlah Pemilih dan Suara Masuk):
 * dua angka agregat saja, dari Terjadwal sampai Diumumkan, ditolak saat Draf,
 * dengan rate limit per IP. Tidak pernah mengandung kandidat/pilihan/korda.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import lockSql from "../migrations/0003_election_lock.sql?raw";
import limitsSql from "../migrations/0004_vote_limits.sql?raw";
import snapshotSql from "../migrations/0005_closing_snapshot.sql?raw";
import memberNumberSql from "../migrations/0008_member_number.sql?raw";
import categorySql from "../migrations/0009_voter_category.sql?raw";
import canVoteSql from "../migrations/0010_voter_can_vote.sql?raw";
import singleModeSql from "../migrations/0011_single_candidate_mode.sql?raw";
import ballotChoiceSql from "../migrations/0012_ballot_choice.sql?raw";
import ballotAbstainSql from "../migrations/0013_ballot_choice_abstain.sql?raw";
import abstainCountedSql from "../migrations/0014_abstain_counted.sql?raw";
import liveRollSql from "../migrations/0015_live_voter_roll.sql?raw";
import closingHakPilihSql from "../migrations/0016_closing_hak_pilih.sql?raw";
import { app } from "../src/server/app";

declare module "*.sql?raw" { const sql: string; export default sql; }

const MASTER_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const SCOPE = "/ppij/okayama";
const bindings = { DB: env.DB, APP_MASTER_KEY: MASTER_KEY };
const now = Date.now();

async function applyMigrations() {
  for (const file of [initSql, unitsSql, lockSql, limitsSql, snapshotSql, memberNumberSql, categorySql, canVoteSql, singleModeSql, ballotChoiceSql, ballotAbstainSql, abstainCountedSql, liveRollSql, closingHakPilihSql]) {
    const stmts = file.split(";").map((s) => s.trim()).filter(Boolean);
    await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
  }
}

async function seedView(count: number) {
  for (let i = 1; i <= count; i++) {
    await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at,can_vote) VALUES (?, ?, ?, 'ACTIVE', ?, 1)").bind(`anggota-${i}`, `Anggota ${i}`, `${SCOPE}/komsat-a`, new Date().toISOString()).run();
  }
}

async function seedElection(opts: { status?: "draft" | "locked" | "published"; live?: boolean; openIn?: number; closeIn?: number } = {}) {
  await env.DB.prepare(
    "INSERT INTO elections (id,title,status_lock,opens_at,closes_at,allow_admin_voting,live_voter_roll) VALUES (1,'Pemilihan',?,?,?,1,?)",
  ).bind(
    opts.status ?? "locked",
    new Date(now + (opts.openIn ?? -1) * 3600e3).toISOString(),
    new Date(now + (opts.closeIn ?? 24) * 3600e3).toISOString(),
    opts.live ? 1 : 0,
  ).run();
}

async function seedParticipation(count: number) {
  for (let i = 1; i <= count; i++) {
    await env.DB.prepare("INSERT OR IGNORE INTO voters (member_id,name,komsat_path,status,synced_at,can_vote) VALUES (?, ?, ?, 'ACTIVE', ?, 1)").bind(`pemilih-${i}`, `Pemilih ${i}`, `${SCOPE}/komsat-a`, new Date().toISOString()).run();
    await env.DB.prepare("INSERT INTO participation (election_id,member_id,member_name,voted_at,is_test) VALUES (1,?,?,?,0)").bind(`pemilih-${i}`, `Pemilih ${i}`, new Date().toISOString()).run();
  }
}

function getTurnout(headers: Record<string, string> = {}) {
  return app.request("/api/turnout", { headers: new Headers(headers) }, bindings);
}

beforeEach(async () => {
  await reset();
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO system_config (key,value) VALUES ('initialized','1'),('site_scope',?)").bind(SCOPE),
    env.DB.prepare("INSERT INTO units (path,name,parent_path,type) VALUES ('/ppij/okayama','Korda Okayama','/ppij','korda')"),
  ]);
});

describe("GET /api/turnout", () => {
  it("shows counts only in every switch state while Dibuka, from frozen or live", async () => {
    await seedElection({ live: false });
    await env.DB.prepare("UPDATE elections SET frozen_hak_pilih=120, frozen_at=?").bind(new Date().toISOString()).run();
    await seedParticipation(45);
    const frozen = await getTurnout();
    expect(frozen.status).toBe(200);
    const frozenBody = await frozen.json() as Record<string, unknown>;
    expect(Object.keys(frozenBody).sort()).toEqual(["eligible_count", "stage", "updated_at", "votes_count"]);
    expect(frozenBody).toMatchObject({ stage: "open", eligible_count: 120, votes_count: 45 });
    expect(JSON.stringify(frozenBody)).not.toContain("candidate");

    await reset();
    await applyMigrations();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO system_config (key,value) VALUES ('initialized','1'),('site_scope',?)").bind(SCOPE),
    ]);
    await seedElection({ live: true });
    // Delapan anggota view + empat pemilih partisipasi = 12 Hak pilih live.
    await seedView(8);
    await seedParticipation(4);
    const live = await getTurnout();
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ stage: "open", eligible_count: 12, votes_count: 4 });
  });

  it("shows the synced view already in Terjadwal with zero votes", async () => {
    await seedElection({ openIn: 1, closeIn: 5 });
    await seedView(30);
    const res = await getTurnout();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stage: "scheduled", eligible_count: 30, votes_count: 0 });
  });

  it("after close the saved snapshot governs, also after Diumumkan", async () => {
    await seedElection({ live: true, closeIn: -1 });
    // Empat anggota view + enam pemilih partisipasi = 10 Hak pilih live.
    await seedView(4);
    await seedParticipation(6);
    const res = await getTurnout();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stage: "closed", eligible_count: 10, votes_count: 6 });
    const saved = await env.DB.prepare("SELECT closing_hak_pilih FROM elections").first<{ closing_hak_pilih: number | null }>();
    expect(saved!.closing_hak_pilih).toBe(10);
    // View bergeser setelah penutupan tidak menggerakkan angka.
    await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at,can_vote) VALUES ('anggota-99','Anggota 99',?, 'ACTIVE', ?, 1)").bind(`${SCOPE}/komsat-a`, new Date().toISOString()).run();
    await env.DB.prepare("UPDATE elections SET status_lock='published'").run();
    const published = await getTurnout();
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ stage: "published", eligible_count: 10, votes_count: 6 });
  });

  it("refuses in Draf", async () => {
    await seedElection({ status: "draft" });
    await seedView(5);
    const res = await getTurnout();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "statistik_belum_tersedia" });
  });

  it("rate limits per IP", async () => {
    await seedElection({ live: false });
    await env.DB.prepare("UPDATE elections SET frozen_hak_pilih=5, frozen_at=?").bind(new Date().toISOString()).run();
    let last: Response | null = null;
    for (let i = 0; i < 35; i++) {
      last = await getTurnout({ "cf-connecting-ip": "203.0.113.9" });
    }
    expect(last!.status).toBe(429);
  });
});
