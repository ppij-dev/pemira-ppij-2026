import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import memberNumberSql from "../migrations/0008_member_number.sql?raw";
import categorySql from "../migrations/0009_voter_category.sql?raw";
import canVoteSql from "../migrations/0010_voter_can_vote.sql?raw";
import liveRollSql from "../migrations/0015_live_voter_roll.sql?raw";
import closingHakPilihSql from "../migrations/0016_closing_hak_pilih.sql?raw";
import { ServiceApiError } from "../src/server/serviceapi/client";
import { assertSyncAllowed, enrichRollNames, ensurePortalViewFresh, storedCanVote, syncPemilih } from "../src/server/serviceapi/sync";
import { createServiceApiStub } from "./lib/serviceapi-fixture";

beforeEach(async () => {
  await reset();
  const sql = [initSql, unitsSql].join(";").replaceAll("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ").replaceAll("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ").replaceAll("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ");
  await env.DB.batch(sql.split(";").filter((statement) => statement.trim()).map((statement) => env.DB.prepare(statement)));
  // ALTER tidak bersifat idempoten; abaikan bila kolom sudah ada dari batch sebelumnya.
  try {
    await env.DB.batch([memberNumberSql, categorySql, canVoteSql, liveRollSql, closingHakPilihSql].join(";").split(";").filter((statement) => statement.trim()).map((statement) => env.DB.prepare(statement)));
  } catch { /* kolom member_number/category/can_vote/live_voter_roll sudah ada */ }
});
const cfg = (stub: { issuer: string; serviceUrl: string; fetchImpl: typeof fetch }) => ({ issuer: stub.issuer, serviceApiUrl: stub.serviceUrl, clientId: "test-client", clientSecret: "test-secret", fetchImpl: stub.fetchImpl });
describe("Service API voter sync", () => {
  it("maps the portal can_vote to a stored 1/0/null voting right", () => {
    const member = (can_vote: unknown) => ({ member_id: "m", full_name: "M", nickname: null, komsat_path: "/ppij", status: "ACTIVE", member_number: null, updated_at: "2026-01-01T00:00:00Z", can_vote: can_vote as boolean | null });
    expect(storedCanVote(member(true))).toBe(1);
    expect(storedCanVote(member(1))).toBe(1);
    expect(storedCanVote(member(false))).toBe(0);
    expect(storedCanVote(member(0))).toBe(0);
    expect(storedCanVote(member(null))).toBeNull();
    expect(storedCanVote(member(undefined))).toBeNull();
  });
  it("imports active voters and units, then applies changed_since deltas", async () => {
    const fixture = createServiceApiStub();
    expect(await syncPemilih(env.DB, cfg(fixture), new Date("2026-01-01T00:00:00Z"))).toEqual({ added: 8, removed: 0, excluded: 0, total: 8 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM units").first<{n:number}>()).toEqual({ n: 8 });
    expect(await env.DB.prepare("SELECT member_number, category, can_vote FROM voters WHERE member_id = 'member-1'").first<{member_number:string|null;category:string|null;can_vote:number|null}>()).toEqual({ member_number: "1", category: "BIASA", can_vote: 1 });
    // Penanda waktu dari as_of portal, bukan klok klien.
    expect(await env.DB.prepare("SELECT value FROM system_config WHERE key='pemilih_last_sync'").first()).toEqual({ value: fixture.asOf });
    // member-1 keluar ACTIVE, sembilan-sebelas masuk; Luar Biasa dan kategori
    // belum ditentukan hanya dihitung sebagai tanpa hak pilih.
    expect(await syncPemilih(env.DB, cfg(fixture), new Date("2026-01-03T00:00:00Z"))).toEqual({ added: 3, removed: 1, excluded: 2, total: 10 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE member_id IN ('member-12','member-13')").first<{n:number}>()).toEqual({ n: 0 });
  });
  it("keeps only members the portal marks can_vote true when rebuilding the roll", async () => {
    const fixture = createServiceApiStub();
    await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at) VALUES ('member-999','Anggota lama','/ppij/kyushu/fukuoka','ACTIVE',?)").bind(new Date().toISOString()).run();
    const result = await syncPemilih(env.DB, cfg(fixture), new Date("2026-01-05T00:00:00Z"), undefined, { full: true });
    expect(result).toEqual({ added: 10, removed: 1, excluded: 2, total: 10 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters").first<{n:number}>()).toEqual({ n: 10 });
    // Luar Biasa (member-12), kategori belum ditentukan (member-13), anggota
    // yang sudah EXPIRED dan baris asing (member-999) tidak ikut.
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE member_id IN ('member-12','member-13','member-1','member-999')").first<{n:number}>()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE can_vote IS NOT 1").first<{n:number}>()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT value FROM system_config WHERE key='pemilih_last_sync'").first()).toEqual({ value: fixture.asOf });
  });
  it("leaves voters, sync time, and audit untouched when the batch fails", async () => {
    const fixture = createServiceApiStub();
    const testCfg = cfg(fixture);
    await syncPemilih(env.DB, testCfg, new Date("2026-01-01T00:00:00Z"));
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM voters").first<{ n: number }>();
    const failingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch") return () => { throw new Error("batch failed"); };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(syncPemilih(failingDb, testCfg, new Date("2026-01-03T00:00:00Z"))).rejects.toThrow("batch failed");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters").first<{ n: number }>()).toEqual(before);
    expect(await env.DB.prepare("SELECT value FROM system_config WHERE key='pemilih_last_sync'").first()).toEqual({ value: fixture.asOf });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>()).toEqual({ n: 1 });
  });
  it("surfaces no_grant without mutating voters", async () => {
    const fixture = createServiceApiStub({ mode: "no_grant" });
    await expect(syncPemilih(env.DB, cfg(fixture), new Date())).rejects.toMatchObject({ code: "no_grant" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters").first<{ n: number }>()).toEqual({ n: 0 });
  });
  it("surfaces failed pages", async () => {
    const fixture = createServiceApiStub({ mode: "fail_page_n" });
    await expect(syncPemilih(env.DB, cfg(fixture), new Date())).rejects.toBeInstanceOf(ServiceApiError);
  });
  it("maps aborted requests to a timeout error", async () => {
    const fixture = createServiceApiStub();
    const fetchImpl: typeof fetch = (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    await expect(syncPemilih(env.DB, { ...cfg(fixture), fetchImpl }, new Date())).rejects.toMatchObject({ code: "timeout" });
  }, 12_000);
  it("enriches existing roll rows with official names, card numbers, categories and voting rights", async () => {
    const fixture = createServiceApiStub();
    // Baris pratinjau: nama masih berupa ID anggota, nomor kartu, kategori dan hak pilih kosong.
    await env.DB.prepare("INSERT INTO voters (member_id,name,nickname,komsat_path,status,synced_at) VALUES ('member-2','member-2','M2','/ppij/kyushu/fukuoka','ACTIVE',?)").bind(new Date().toISOString()).run();
    // Baris beku yang usang: kategori/hak pilih lama, portal sudah mengubahnya.
    await env.DB.prepare("INSERT INTO voters (member_id,name,nickname,komsat_path,status,synced_at,category,can_vote) VALUES ('member-12','Member 12','M12','/ppij/kyushu/fukuoka','ACTIVE',?,'BIASA',1)").bind(new Date().toISOString()).run();
    // Kategori, nomor kartu dan hak pilih yang portalnya masih kosong tidak ikut ditulis.
    await env.DB.prepare("INSERT INTO voters (member_id,name,nickname,komsat_path,status,synced_at,member_number,category,can_vote) VALUES ('member-13','Member 13','M13','/ppij/kyushu/fukuoka','ACTIVE',?,'13',NULL,NULL)").bind(new Date().toISOString()).run();
    const result = await enrichRollNames(env.DB, cfg(fixture), new Date("2026-01-02T00:00:00Z"));
    expect(result.updated).toBe(2);
    const row = await env.DB.prepare("SELECT name, member_number, category, can_vote FROM voters WHERE member_id = 'member-2'").first<{ name: string; member_number: string | null; category: string | null; can_vote: number | null }>();
    expect(row).toEqual({ name: "Member 2", member_number: "2", category: "BIASA", can_vote: 1 });
    // Baris Luar Biasa tetap di roll beku, tetapi hak pilihnya jadi 0.
    const luarBiasa = await env.DB.prepare("SELECT category, can_vote FROM voters WHERE member_id = 'member-12'").first<{ category: string; can_vote: number }>();
    expect(luarBiasa).toEqual({ category: "LUAR_BIASA", can_vote: 0 });
    // Idempoten: pembaruan berikutnya tidak mengubah apa pun.
    expect((await enrichRollNames(env.DB, cfg(fixture), new Date("2026-01-02T00:05:00Z"))).updated).toBe(0);
  });

  it("blocks sync outside draft", async () => {
    await env.DB.prepare("INSERT INTO elections (id,status_lock) VALUES (1,'locked')").run();
    await expect(assertSyncAllowed(env.DB)).rejects.toMatchObject({ status: 409 });
  });
});

describe("live portal view refresh", () => {
  const OPEN_AT = "2025-12-31T00:00:00Z", CLOSE_AT = "2026-01-02T00:00:00Z";
  const T0 = new Date("2026-01-01T00:00:00Z"), AFTER_TTL = new Date("2026-01-01T00:01:00Z");
  async function insertLiveOpenElection(live = 1, status = "locked") {
    await env.DB.prepare("INSERT INTO elections (id,status_lock,opens_at,closes_at,live_voter_roll) VALUES (1,?,?,?,?)").bind(status, OPEN_AT, CLOSE_AT, live).run();
  }
  function countingStub(opts?: Parameters<typeof createServiceApiStub>[0]) {
    const stub = createServiceApiStub(opts);
    let calls = 0;
    const fetchImpl: typeof fetch = (input, init) => { calls++; return stub.fetchImpl(input, init); };
    return { ...stub, fetchImpl, count: () => calls };
  }
  it("refreshes silently inside the eligibility rule both ways and writes no audit entry", async () => {
    const fixture = createServiceApiStub();
    await insertLiveOpenElection();
    expect(await syncPemilih(env.DB, cfg(fixture), T0)).toEqual({ added: 8, removed: 0, excluded: 0, total: 8 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{n:number}>())!.n).toBe(1);
    // Watermark dari as_of portal; TTL 30 detik sudah lewat pada AFTER_TTL.
    const result = await ensurePortalViewFresh(env.DB, cfg(fixture), AFTER_TTL);
    expect(result).toEqual({ refreshed: true, failed: false, stale: false, skipped: false });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM voters").first<{n:number}>())!.n).toBe(10);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE member_id IN ('member-12','member-13')").first<{n:number}>()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT value FROM system_config WHERE key='pemilih_last_sync'").first()).toEqual({ value: fixture.asOf });
    // Segarkan otomatis tetap sunyi: audit tidak bertambah.
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{n:number}>())!.n).toBe(1);
  });
  it("skips the refresh while the view is inside the TTL and calls the portal zero times", async () => {
    const fixture = createServiceApiStub();
    await insertLiveOpenElection();
    await syncPemilih(env.DB, cfg(fixture), T0);
    // Hanya percobaan ensure yang dihitung, bukan sinkronisasi awal.
    let calls = 0;
    const counting: typeof fetch = (input, init) => { calls++; return fixture.fetchImpl(input, init); };
    const result = await ensurePortalViewFresh(env.DB, cfg(fixture), new Date("2026-01-01T00:00:20Z"), counting);
    expect(result).toEqual({ refreshed: false, failed: false, stale: false, skipped: false });
    expect(calls).toBe(0);
  });
  it("does not retry within the cooldown after a failed refresh and reports the stale view", async () => {
    const fixture = countingStub({ mode: "fail_page_n" });
    await insertLiveOpenElection();
    await syncPemilih(env.DB, cfg(createServiceApiStub()), T0);
    const first = await ensurePortalViewFresh(env.DB, cfg(fixture), AFTER_TTL);
    expect(first).toEqual({ refreshed: false, failed: true, stale: true, skipped: false });
    const callsAfterFirst = fixture.count();
    const second = await ensurePortalViewFresh(env.DB, cfg(fixture), new Date("2026-01-01T00:01:05Z"));
    expect(second).toEqual({ refreshed: false, failed: false, stale: true, skipped: false });
    expect(fixture.count()).toBe(callsAfterFirst);
    // Setelah cooldown lewat, percobaan berikutnya diizinkan lagi.
    const stubOk = createServiceApiStub();
    const third = await ensurePortalViewFresh(env.DB, cfg(stubOk), new Date("2026-01-01T00:01:31Z"));
    expect(third).toEqual({ refreshed: true, failed: false, stale: false, skipped: false });
  });
  it("rebuilds the view silently with a full sync when no watermark exists", async () => {
    const fixture = createServiceApiStub();
    await insertLiveOpenElection();
    await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at) VALUES ('member-999','Anggota lama','/ppij/x','ACTIVE','now')").run();
    const result = await ensurePortalViewFresh(env.DB, cfg(fixture), T0);
    expect(result).toEqual({ refreshed: true, failed: false, stale: false, skipped: false });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE member_id='member-999'").first<{n:number}>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM voters").first<{n:number}>())!.n).toBe(10);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{n:number}>())!.n).toBe(0);
  });
  it("only refreshes in live mode while the stage is open", async () => {
    const fixture = countingStub();
    await insertLiveOpenElection(0);
    const off = await ensurePortalViewFresh(env.DB, cfg(fixture), AFTER_TTL);
    expect(off).toEqual({ refreshed: false, failed: false, stale: false, skipped: true });
    expect(fixture.count()).toBe(0);
    await env.DB.prepare("UPDATE elections SET live_voter_roll=1, opens_at='2026-06-01T00:00:00Z'").run();
    const scheduled = await ensurePortalViewFresh(env.DB, cfg(fixture), AFTER_TTL);
    expect(scheduled).toEqual({ refreshed: false, failed: false, stale: false, skipped: true });
    expect(fixture.count()).toBe(0);
  });
});
