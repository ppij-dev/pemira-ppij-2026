import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { Hono } from "hono";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import lockSql from "../migrations/0003_election_lock.sql?raw";
import limitsSql from "../migrations/0004_vote_limits.sql?raw";
import snapshotSql from "../migrations/0005_closing_snapshot.sql?raw";
import { boardRoutes, ensureClosingSnapshot } from "../src/server/voting/board";
import { encodeReceipt, decodeReceipt, hashReceipt } from "../src/server/voting/receipt";
import type { Bindings } from "../src/server/app";

declare module "*.sql?raw" { const sql: string; export default sql; }
const bindings = { DB: env.DB, MEDIA: {} as never, APP_MASTER_KEY: "" } satisfies Bindings;
const app = new Hono<{ Bindings: Bindings }>().basePath("/api");
app.route("/", boardRoutes);
const open = new Date(Date.now() - 60_000).toISOString();
const future = new Date(Date.now() + 60_000).toISOString();

beforeEach(async () => {
  await reset();
  const sql = [initSql, unitsSql, lockSql, limitsSql, snapshotSql].flatMap((part) => part.split(";")).map((s) => s.trim()).filter(Boolean);
  await env.DB.batch(sql.map((s) => env.DB.prepare(s)));
  await env.DB.prepare("INSERT INTO elections (id,title,status_lock,opens_at,closes_at) VALUES (1,'Pemilihan','locked',?,?)").bind(open, future).run();
});

describe("receipt board", () => {
  it("round trips 128-bit receipt encoding and lookup hides unknown codes", async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const code = encodeReceipt(bytes);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(decodeReceipt(code)).toEqual(bytes);
    const missing = await app.request("/api/votes/receipt-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) }, bindings);
    expect(await missing.json()).toEqual({ found: false });
    await env.DB.prepare("INSERT INTO candidates (id,member_id,number,name,nickname,komsat_path) VALUES (1,'m',1,'A','A','x')").run();
    await env.DB.prepare("INSERT INTO ballots (id,election_id,candidate_id,komsat_path,receipt_hash,is_test) VALUES ('b',1,1,'x',?,0)").bind(await hashReceipt(code)).run();
    const found = await app.request("/api/votes/receipt-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) }, bindings);
    expect(await found.json()).toEqual({ found: true });
  });

  it("rejects early board reads, then publishes only ordered hashes and stable snapshot", async () => {
    expect((await app.request("/api/votes/board", {}, bindings)).status).toBe(409);
    await env.DB.prepare("UPDATE elections SET closes_at=? WHERE id=1").bind(new Date(Date.now() - 1000).toISOString()).run();
    await env.DB.prepare("INSERT INTO candidates (id,member_id,number,name,nickname,komsat_path) VALUES (1,'m',1,'A','A','x')").run();
    for (const [id, hash] of [["b", "hash-b"], ["a", "hash-a"]]) {
      await env.DB.prepare("INSERT INTO ballots (id,election_id,candidate_id,komsat_path,receipt_hash,is_test) VALUES (?,1,1,'x',?,0)").bind(id, hash).run();
    }
    const response = await app.request("/api/votes/board", {}, bindings);
    const board = await response.json() as { receipt_hashes: string[]; ballot_count: number; closing_snapshot_hash: string };
    expect(board.receipt_hashes).toEqual(["hash-a", "hash-b"]);
    expect(board.ballot_count).toBe(2);
    const snapshot = board.closing_snapshot_hash;
    expect(snapshot).toBeTruthy();
    await Promise.all([ensureClosingSnapshot(env.DB, new Date()), ensureClosingSnapshot(env.DB, new Date())]);
    await env.DB.prepare("INSERT INTO audit_log (at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash) VALUES ('x','system',NULL,'','later',NULL,NULL,NULL,'p','later')").run();
    const unchanged = await ensureClosingSnapshot(env.DB, new Date());
    expect(unchanged).toBe(snapshot);
    const events = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='Pemilihan ditutup'").first<{ n: number }>();
    expect(events?.n).toBe(1);
  });

  it("limits receipt checks to 30 per IP per minute", async () => {
    for (let i = 0; i < 30; i++) {
      const response = await app.request("/api/votes/receipt-check", { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": "198.51.100.1" }, body: JSON.stringify({ code: "invalid" }) }, bindings);
      expect(response.status).toBe(200);
    }
    const limited = await app.request("/api/votes/receipt-check", { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": "198.51.100.1" }, body: JSON.stringify({ code: "invalid" }) }, bindings);
    expect(limited.status).toBe(429);
  });
});
