import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import { sealSession } from "../src/server/auth/session";
import { buildAuditInsert, type AuditEntry } from "../src/server/lib/audit";
import { auditRoutes } from "../src/server/audit/routes";

async function appendMany(count: number) { for (let i = 0; i < count; i++) await append(`bulk-${i}`); }
declare module "*.sql?raw" { const sql: string; export default sql; }
const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const bindings = { DB: env.DB, MEDIA: {} as never, APP_MASTER_KEY: key };
async function request(path: string, member = "admin-1") {
  const cookie = await sealSession({ member_id: member, name: member, affiliation: "/ppij/test", auth_time: Math.floor(Date.now()/1000) }, key);
  return auditRoutes.request(path.replace(/^\/api/, ""), { headers: { cookie: `ppij_session=${cookie}` } }, bindings);
}
async function append(action: string, detail: object | null = null) {
  const entry: AuditEntry = { at: "2026-01-01T00:00:00.000Z", actor_type: "system", actor_member_id: null, actor_name: "test", action, target: null, komsat_path: null, detail_json: detail ? JSON.stringify(detail) : null };
  await env.DB.batch([await buildAuditInsert(env.DB, entry)]);
}
beforeEach(async () => {
  await reset();
  await env.DB.batch(initSql.split(";").map((s) => s.trim()).filter(Boolean).map((s) => env.DB.prepare(s)));
  await env.DB.batch([env.DB.prepare("ALTER TABLE elections ADD COLUMN closing_snapshot_hash TEXT"), env.DB.prepare("ALTER TABLE elections ADD COLUMN closing_snapshot_at TEXT")]);
  await env.DB.prepare("INSERT INTO system_config (key,value) VALUES ('initialized','1'),('site_scope','/ppij/test')").run();
  await env.DB.prepare("INSERT INTO admin_voting (member_id,name,is_technical,created_at) VALUES ('admin-1','Admin',0,'now')").run();
  await env.DB.prepare("INSERT INTO elections (id) VALUES (1)").run();
});
describe("audit API", () => {
  it("requires admin", async () => { expect((await request("/api/audit", "nope")).status).toBe(403); });
  it("lists newest first with JST and masked details", async () => {
    await append("first"); await append("second", { api_key: "abc" });
    const body = await (await request("/api/audit")).json() as {results: Array<{action:string;at:string;detail_json:object}>};
    expect(body.results.map(x => x.action)).toEqual(["second", "first"]);
    expect(body.results[0].at).toContain("+09:00");
    expect(body.results[0].detail_json).toEqual({api_key:"••••••••"});
  });
  it("walks pages by sequence exactly once", async () => {
    for (let i=0;i<55;i++) await append(`a${i}`);
    const one = await (await request("/api/audit")).json() as {results:Array<{seq:number}>};
    const two = await (await request(`/api/audit?before_seq=${one.results.at(-1)!.seq}`)).json() as {results:Array<{seq:number}>};
    expect(one.results).toHaveLength(50); expect(two.results).toHaveLength(5);
    expect(new Set([...one.results,...two.results].map(x=>x.seq)).size).toBe(55);
  });
  it("verifies chain after append and detects changed details", async () => {
    await append("a"); await append("b");
    expect(await (await request("/api/audit/integrity")).json()).toMatchObject({intact:true,entries:2});
    await env.DB.prepare("UPDATE audit_log SET detail_json='{}' WHERE seq=1").run();
    expect(await (await request("/api/audit/integrity")).json()).toMatchObject({intact:false,broken_at:1});
  });
  it("detects a deleted row at the first subsequent sequence", async () => {
    await append("a"); await append("b"); await append("c");
    await env.DB.prepare("DELETE FROM audit_log WHERE seq=2").run();
    expect(await (await request("/api/audit/integrity")).json()).toMatchObject({intact:false,broken_at:3,entries:2});
  });
  it("masks nested secret values recursively", async () => {
    await append("nested", { outer: { api_key: "x" }, list: ["token-y"] });
    const body = await (await request("/api/audit")).json() as { results: Array<{ detail_json: unknown }> };
    expect(body.results[0].detail_json).toEqual({ outer: { api_key: "••••••••" }, list: ["token-y"] });
  });
  it("verifies an intact chain across batches and detects second-batch tampering", async () => {
    await appendMany(601);
    expect(await (await request("/api/audit/integrity")).json()).toMatchObject({ intact: true, broken_at: null, entries: 601 });
    await env.DB.prepare("UPDATE audit_log SET detail_json='{}' WHERE seq=600").run();
    expect(await (await request("/api/audit/integrity")).json()).toMatchObject({ intact: false, broken_at: 600 });
  });
  it("detects a deleted row in the second batch", async () => {
    await appendMany(601);
    await env.DB.prepare("DELETE FROM audit_log WHERE seq=550").run();
    expect(await (await request("/api/audit/integrity")).json()).toMatchObject({ intact: false, broken_at: 551 });
  });
  it("returns closing snapshot values", async () => {
    expect(await (await request("/api/audit/snapshot")).json()).toEqual({closing_snapshot_hash:null,closing_snapshot_at:null});
    await env.DB.prepare("UPDATE elections SET closing_snapshot_hash='abc',closing_snapshot_at='2026-01-01T00:00:00Z'").run();
    expect(await (await request("/api/audit/snapshot")).json()).toMatchObject({closing_snapshot_hash:"abc",closing_snapshot_at:expect.stringContaining("+09:00")});
  });
});
