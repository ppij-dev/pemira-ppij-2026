import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { Hono } from "hono";
import initSql from "../migrations/0001_init.sql?raw";
import unitsSql from "../migrations/0002_units.sql?raw";
import lockSql from "../migrations/0003_election_lock.sql?raw";
import limitsSql from "../migrations/0004_vote_limits.sql?raw";
import snapshotSql from "../migrations/0005_closing_snapshot.sql?raw";
import { boardRoutes, ensureClosingSnapshot } from "../src/server/voting/board";
import { closeEarly } from "../src/server/election/lifecycle";
import { verifyChain, type AuditRow } from "../src/server/lib/audit";
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

  it("rejects early board reads, then persists one scheduled snapshot and verifies its audit chain", async () => {
    expect((await app.request("/api/votes/board", {}, bindings)).status).toBe(409);
    await env.DB.prepare("UPDATE elections SET closes_at=? WHERE id=1").bind(new Date(Date.now() - 1000).toISOString()).run();
    await env.DB.prepare("INSERT INTO candidates (id,member_id,number,name,nickname,komsat_path) VALUES (1,'m',1,'A','A','x')").run();
    for (const [id, hash] of [["b", "hash-b"], ["a", "hash-a"]]) {
      await env.DB.prepare("INSERT INTO ballots (id,election_id,candidate_id,komsat_path,receipt_hash,is_test) VALUES (?,1,1,'x',?,0)").bind(id, hash).run();
    }
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const beforeBatch = async () => {
      arrived++;
      if (arrived === 2) release();
      await gate;
    };
    const [first, second] = await Promise.all([
      ensureClosingSnapshot(env.DB, new Date(Date.now() + 1), { beforeBatch }),
      ensureClosingSnapshot(env.DB, new Date(Date.now() + 2), { beforeBatch }),
    ]);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    const response = await app.request("/api/votes/board", {}, bindings);
    const board = await response.json() as { receipt_hashes: string[]; ballot_count: number; closing_snapshot_hash: string };
    expect(board.receipt_hashes).toEqual(["hash-a", "hash-b"]);
    expect(board.ballot_count).toBe(2);
    expect(board.closing_snapshot_hash).toBe(first);
    const events = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='Pemilihan ditutup'").first<{ n: number }>();
    expect(events?.n).toBe(1);
    const rows = await env.DB.prepare("SELECT * FROM audit_log ORDER BY seq").all<AuditRow>();
    expect(await verifyChain(rows.results)).toBeNull();
    await env.DB.prepare("INSERT INTO audit_log (at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash) SELECT 'x','system',NULL,'','later',NULL,NULL,NULL,hash,'later' FROM audit_log ORDER BY seq DESC LIMIT 1").run();
    expect(await ensureClosingSnapshot(env.DB, new Date())).toBe(first);
  });

  it("uses the early-close audit event hash and does not append a second close event", async () => {
    await env.DB.prepare("UPDATE elections SET closes_at=? WHERE id=1").bind(new Date(Date.now() + 60_000).toISOString()).run();
    await closeEarly(env.DB, new Date(), "incident");
    const early = await env.DB.prepare("SELECT hash FROM audit_log WHERE action='Pemilihan ditutup lebih awal'").first<{ hash: string }>();
    const board = await app.request("/api/votes/board", {}, bindings);
    expect(board.status).toBe(200);
    const body = await board.json() as { closing_snapshot_hash: string };
    expect(body.closing_snapshot_hash).toBe(early?.hash);
    expect(await ensureClosingSnapshot(env.DB, new Date())).toBe(early?.hash);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='Pemilihan ditutup'").first()).toEqual({ n: 0 });
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
