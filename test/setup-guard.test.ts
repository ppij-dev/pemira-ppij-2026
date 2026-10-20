import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { Hono } from "hono";
import type { Bindings } from "../src/server/app";
import migrationSql from "../migrations/0001_init.sql?raw";
import { bootstrapSite, loadRuntimeConfig } from "../src/server/setup/bootstrap";
import { setupGuard } from "../src/server/setup/guard";

const validConfig = {
  ONELOGIN_ISSUER: "https://login.example/realm", ONELOGIN_CLIENT_ID: "client", ONELOGIN_CLIENT_SECRET: "secret",
  SERVICE_API_URL: "https://service.example", SERVICE_API_CLIENT_ID: "service-client", SERVICE_API_CLIENT_SECRET: "secret",
  SITE_SCOPE: "Korda/Jepang", SITE_BASE_URL: "https://vote.example", SITE_NAME: "Pemilihan", SITE_LOGO_PATH: "/logo.svg", APP_MASTER_KEY: "master-key",
};
const site = new Hono<{Bindings: Bindings}>().use("*", setupGuard())
  .get("/", (c) => c.text("public"))
  .get("/robots.txt", (c) => c.text("static"));

beforeEach(async () => {
  await reset();
  await env.DB.batch(migrationSql.split(";").map((s) => s.trim()).filter(Boolean).map((s) => env.DB.prepare(s)));
});

describe("operator bootstrap", () => {
  it("requires the complete runtime configuration", () => {
    expect(loadRuntimeConfig(validConfig)).not.toBeNull();
    expect(loadRuntimeConfig({ ...validConfig, APP_MASTER_KEY: "" })).toBeNull();
    expect(loadRuntimeConfig({ ...validConfig, SITE_LOGO_PATH: "" })?.SITE_LOGO_PATH).toBe("/logo.svg");
  });

  it("creates one draft election, technical admin and initialized site; reruns safely", async () => {
    expect(await bootstrapSite(env.DB, validConfig, "member-123")).toBe(true);
    expect(await bootstrapSite(env.DB, validConfig, "member-456")).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM elections").first()).toMatchObject({n: 1});
    expect(await env.DB.prepare("SELECT member_id, name, is_technical FROM admin_voting").all()).toMatchObject({results: [{member_id: "member-123", name: "Technical Admin", is_technical: 1}]});
    expect(await env.DB.prepare("SELECT value FROM system_config WHERE key='site_scope'").first()).toMatchObject({value: "Korda/Jepang"});
    expect(JSON.stringify(await env.DB.prepare("SELECT * FROM system_config").all())).not.toContain("master-key");
  });


  it("recovers a partial bootstrap that already has an election row", async () => {
    await env.DB.prepare("INSERT INTO elections (title, status_lock) VALUES ('Partial', 'draft')").run();
    expect(await bootstrapSite(env.DB, validConfig, "member-123")).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM elections").first()).toMatchObject({ n: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_voting").first()).toMatchObject({ n: 1 });
    expect(await env.DB.prepare("SELECT value FROM system_config WHERE key='initialized'").first()).toMatchObject({ value: "1" });
  });
  it("leaves missing-config databases uninitialized", async () => {
    expect(await bootstrapSite(env.DB, null, "member-123")).toBe(false);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM elections").first()).toMatchObject({n: 0});
    expect((await site.request("/", {}, { DB: env.DB, MEDIA: {} as Bindings["MEDIA"] })).status).toBe(503);
  });

  it("returns 503 publicly, 404 for reserved setup paths, and serves public paths after bootstrap", async () => {
    expect((await site.request("/", {}, { DB: env.DB, MEDIA: {} as Bindings["MEDIA"] })).status).toBe(503);
    expect((await site.request("/setup", {}, { DB: env.DB, MEDIA: {} as Bindings["MEDIA"] })).status).toBe(404);
    expect((await site.request("/api/setup/claim", {}, { DB: env.DB, MEDIA: {} as Bindings["MEDIA"] })).status).toBe(404);
    expect((await site.request("/robots.txt", {}, { DB: env.DB, MEDIA: {} as Bindings["MEDIA"] })).status).toBe(200);
    await bootstrapSite(env.DB, validConfig, "member-123");
    expect((await site.request("/", {}, { DB: env.DB, MEDIA: {} as Bindings["MEDIA"] })).status).toBe(200);
    expect((await site.request("/setup", {}, { DB: env.DB, MEDIA: {} as Bindings["MEDIA"] })).status).toBe(404);
    expect((await site.request("/api/setup/claim", {}, { DB: env.DB, MEDIA: {} as Bindings["MEDIA"] })).status).toBe(404);
  });
});
