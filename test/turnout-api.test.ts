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
import { app } from "../src/server/app";
import { getTurnout as getTurnoutDirect } from "../src/server/results/queries";
import { authorizeVoter } from "../src/server/voting/vote";
import { allPortalMembers, changedPortalMembers, createServiceApiStub, type FixtureMember } from "./lib/serviceapi-fixture";

declare module "*.sql?raw" { const sql: string; export default sql; }

const MASTER_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const SCOPE = "/ppij/okayama";
const bindings = { DB: env.DB, APP_MASTER_KEY: MASTER_KEY };
const now = Date.now();

async function applyMigrations() {
  for (const file of [initSql, unitsSql, lockSql, limitsSql, snapshotSql, previewModeSql, memberNumberSql, categorySql, canVoteSql, singleModeSql, ballotChoiceSql, ballotAbstainSql, abstainCountedSql, liveRollSql, closingHakPilihSql, directInvitationsSql]) {
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

describe("GET /api/turnout live mode: reads refresh the portal view", () => {
  function member(id: string, overrides: Partial<FixtureMember> = {}): FixtureMember {
    return { member_id: id, full_name: `Anggota ${id}`, nickname: id, komsat_path: `${SCOPE}/komsat-a`, status: "ACTIVE", member_number: id, member_category: "BIASA", can_vote: true, updated_at: new Date().toISOString(), ...overrides };
  }
  function portalOf(stub: ReturnType<typeof createServiceApiStub>) {
    return { issuer: stub.issuer, clientId: "c", clientSecret: "s", serviceApiUrl: stub.serviceUrl, fetchImpl: stub.fetchImpl };
  }
  it("anggota baru dari portal menaikkan Jumlah Pemilih tanpa ada yang memilih, lalu bisa memilih", async () => {
    await seedElection({ live: true });
    const base = createServiceApiStub();
    // Pembacaan pertama membangun view penuh dari portal: 10 berhak, tanpa suara.
    expect(await getTurnoutDirect(env.DB, new Date(), portalOf(base))).toMatchObject({ eligible_count: 10, votes_count: 0 });
    // Anggota baru mendaftar di portal; pembacaan berikutnya (watermark sudah lewat TTL)
    // menaikkan angka tanpa satu pun suara masuk.
    const grown = createServiceApiStub({ all: allPortalMembers([member("member-14")]), changed: changedPortalMembers([member("member-14")]) });
    expect(await getTurnoutDirect(env.DB, new Date(), portalOf(grown))).toMatchObject({ eligible_count: 11, votes_count: 0 });
    // Dan anggota baru itu dapat memilih: otorisasi menemukannya di view yang segar.
    const session = { member_id: "member-14", name: "Anggota member-14", affiliation: `${SCOPE}/komsat-a`, auth_time: Math.floor(Date.now() / 1000) - 60 };
    const { voter } = await authorizeVoter(env.DB, session, portalOf(grown));
    expect(voter.member_id).toBe("member-14");
    expect(voter.can_vote).toBe(1);
  });
  it("anggota yang hilang dari portal menurunkan Jumlah Pemilih", async () => {
    await seedElection({ live: true });
    const grown = createServiceApiStub({ all: allPortalMembers([member("member-14")]), changed: changedPortalMembers([member("member-14")]) });
    expect((await getTurnoutDirect(env.DB, new Date(), portalOf(grown))).eligible_count).toBe(11);
    // Portal menandai member-14 EXPIRED: bacaan berikutnya menurunkan angka.
    const shrunk = createServiceApiStub({ changed: [...changedPortalMembers(), member("member-14", { status: "EXPIRED", can_vote: false })] });
    expect(await getTurnoutDirect(env.DB, new Date(), portalOf(shrunk))).toMatchObject({ eligible_count: 10, votes_count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE member_id='member-14'").first<{n:number}>()).toEqual({ n: 0 });
  });
  it("portal menggantung: bacaan dilayani cepat dari view usang (batas tunggu pendek)", async () => {
    await seedElection({ live: true });
    // Watermark lama + view ada: pembacaan ingin menyegarkan, tapi portal menggantung.
    await env.DB.prepare("INSERT INTO system_config (key,value) VALUES ('pemilih_last_sync',?)").bind(new Date(Date.now() - 120_000).toISOString()).run();
    for (const id of ["anggota-1", "anggota-2"]) {
      await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at,can_vote) VALUES (?, ?, ?, 'ACTIVE', ?, 1)").bind(id, `Anggota ${id}`, `${SCOPE}/komsat-a`, new Date().toISOString()).run();
    }
    const base = createServiceApiStub();
    // Hanya permintaan pertama yang menggantung 2,5 detik; sisanya cepat supaya
    // segarkan latar (beberapa permintaan berurutan) tetap selesai dalam hitungan detik.
    let slowCalls = 0;
    const slow: typeof fetch = (input, init) => {
      if (slowCalls++ === 0) return new Promise((resolve) => setTimeout(() => resolve(base.fetchImpl(input, init)), 2500));
      return base.fetchImpl(input, init);
    };
    const started = Date.now();
    const data = await getTurnoutDirect(env.DB, new Date(), { issuer: base.issuer, clientId: "c", clientSecret: "s", serviceApiUrl: base.serviceUrl, fetchImpl: slow });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(data.eligible_count).toBe(2);
    // Segarkan latar tetap selesai: watermark naik ke as_of portal.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect((await env.DB.prepare("SELECT value FROM system_config WHERE key='pemilih_last_sync'").first<{ value: string }>())!.value).toBe(base.asOf);
  }, 12_000);
});
