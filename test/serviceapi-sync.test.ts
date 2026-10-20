import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import { ServiceApiError } from "../src/server/serviceapi/client";
import { assertSyncAllowed, syncPemilih } from "../src/server/serviceapi/sync";
import { startServiceApiFixture } from "./lib/serviceapi-fixture";

beforeEach(async () => {
  await reset();
  await env.DB.batch([initSql, unitsSql].join(";").split(";").filter((sql) => sql.trim()).map((sql) => env.DB.prepare(sql)));
});
const cfg = (fixture: { issuer: string; serviceUrl: string }) => ({ issuer: fixture.issuer, serviceApiUrl: fixture.serviceUrl, clientId: "test-client", clientSecret: "test-secret" });
describe("Service API voter sync", () => {
  it("imports active voters and units, then applies changed_since deltas", async () => {
    const fixture = await startServiceApiFixture();
    try {
      expect(await syncPemilih(env.DB, cfg(fixture), new Date("2026-01-01T00:00:00Z"))).toEqual({ added: 8, removed: 0, total: 8 });
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM units").first<{n:number}>()).toEqual({ n: 8 });
      expect(await syncPemilih(env.DB, cfg(fixture), new Date("2026-01-03T00:00:00Z"))).toEqual({ added: 3, removed: 1, total: 10 });
    } finally { await fixture.close(); }
  });
  it("surfaces no_grant without mutating voters", async () => {
    const fixture = await startServiceApiFixture({ mode: "no_grant" });
    try { await expect(syncPemilih(env.DB, cfg(fixture), new Date())).rejects.toMatchObject({ code: "no_grant" }); }
    finally { await fixture.close(); }
  });
  it("surfaces failed pages", async () => {
    const fixture = await startServiceApiFixture({ mode: "fail_page_n" });
    try { await expect(syncPemilih(env.DB, cfg(fixture), new Date())).rejects.toBeInstanceOf(ServiceApiError); }
    finally { await fixture.close(); }
  });
  it("blocks sync outside draft", async () => {
    await env.DB.prepare("INSERT INTO elections (id,status_lock) VALUES (1,'locked')").run();
    await expect(assertSyncAllowed(env.DB)).rejects.toMatchObject({ status: 409 });
  });
});
