import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import { ServiceApiError } from "../src/server/serviceapi/client";
import { assertSyncAllowed, syncPemilih } from "../src/server/serviceapi/sync";
import { createServiceApiStub } from "./lib/serviceapi-fixture";

beforeEach(async () => {
  await reset();
  const sql = [initSql, unitsSql].join(";").replaceAll("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ").replaceAll("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ").replaceAll("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ");
  await env.DB.batch(sql.split(";").filter((statement) => statement.trim()).map((statement) => env.DB.prepare(statement)));
});
const cfg = (stub: { issuer: string; serviceUrl: string; fetchImpl: typeof fetch }) => ({ issuer: stub.issuer, serviceApiUrl: stub.serviceUrl, clientId: "test-client", clientSecret: "test-secret", fetchImpl: stub.fetchImpl });
describe("Service API voter sync", () => {
  it("imports active voters and units, then applies changed_since deltas", async () => {
    const fixture = createServiceApiStub();
    expect(await syncPemilih(env.DB, cfg(fixture), new Date("2026-01-01T00:00:00Z"))).toEqual({ added: 8, removed: 0, total: 8 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM units").first<{n:number}>()).toEqual({ n: 8 });
    expect(await syncPemilih(env.DB, cfg(fixture), new Date("2026-01-03T00:00:00Z"))).toEqual({ added: 3, removed: 1, total: 10 });
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
    expect(await env.DB.prepare("SELECT value FROM system_config WHERE key='pemilih_last_sync'").first()).toEqual({ value: "2026-01-01T00:00:00.000Z" });
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
  it("blocks sync outside draft", async () => {
    await env.DB.prepare("INSERT INTO elections (id,status_lock) VALUES (1,'locked')").run();
    await expect(assertSyncAllowed(env.DB)).rejects.toMatchObject({ status: 409 });
  });
});
