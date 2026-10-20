import type { D1Database } from "@cloudflare/workers-types";
import { Hono } from "hono";
import type { Bindings } from "../app";
import { buildAuditInsert } from "../lib/audit";
import { stage } from "../lib/stage";
import { hashReceipt, normalizeReceiptCode } from "./receipt";

type Env = { Bindings: Bindings };

interface ElectionRow {
  id: number;
  status_lock: "draft" | "locked" | "published";
  opens_at: string;
  closes_at: string;
  closed_early_at: string | null;
  closing_snapshot_hash: string | null;
  closing_snapshot_at: string | null;
}

async function readSnapshot(db: D1Database, id: number) {
  return db.prepare("SELECT closing_snapshot_hash FROM elections WHERE id=?").bind(id).first<{ closing_snapshot_hash: string | null }>();
}

/** Create once on the first read after scheduled or early closure. */
export async function ensureClosingSnapshot(db: D1Database, now: Date): Promise<string | null> {
  const election = await db.prepare("SELECT * FROM elections ORDER BY id LIMIT 1").first<ElectionRow>();
  if (!election) return null;
  const existing = election.closing_snapshot_hash;
  if (existing) return existing;
  if (stage(election, now.toISOString()) !== "closed" && election.status_lock !== "published") return null;

  const at = now.toISOString();
  const audit = await buildAuditInsert(db, {
    at,
    actor_type: "system",
    actor_member_id: null,
    actor_name: "",
    action: "Pemilihan ditutup",
    target: String(election.id),
    komsat_path: null,
    detail_json: JSON.stringify({ closing_snapshot: true }),
  });
  try {
    await db.batch([
      audit,
      db.prepare("UPDATE elections SET closing_snapshot_hash=(SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1), closing_snapshot_at=? WHERE id=? AND closing_snapshot_hash IS NULL").bind(at, election.id),
    ]);
  } catch {
    // A concurrent request may have appended the same audit chain entry first.
  }
  return (await readSnapshot(db, election.id))?.closing_snapshot_hash ?? null;
}

async function consumeReceiptCheck(db: D1Database, ip: string): Promise<boolean> {
  const nowSec = Math.floor(Date.now() / 1000);
  const row = await db.prepare(
    `INSERT INTO rate_limits (key,count,reset_at) VALUES (?,1,?)
     ON CONFLICT(key) DO UPDATE SET
       count=CASE WHEN rate_limits.reset_at<=? THEN 1 ELSE rate_limits.count+1 END,
       reset_at=CASE WHEN rate_limits.reset_at<=? THEN ? ELSE rate_limits.reset_at END
     RETURNING count`,
  ).bind(`receipt:${ip}`, nowSec + 60, nowSec, nowSec, nowSec + 60).first<{ count: number }>();
  return (row?.count ?? 31) <= 30;
}

export async function checkReceipt(db: D1Database, code: string): Promise<{ found: boolean }> {
  const hash = await hashReceipt(normalizeReceiptCode(code));
  const found = await db.prepare("SELECT 1 FROM ballots WHERE receipt_hash=? LIMIT 1").bind(hash).first();
  return { found: !!found };
}

export async function getPublicBoard(db: D1Database, now: Date) {
  const election = await db.prepare("SELECT * FROM elections ORDER BY id LIMIT 1").first<ElectionRow>();
  if (!election || (stage(election, now.toISOString()) !== "closed" && election.status_lock !== "published")) return null;
  const snapshotHash = await ensureClosingSnapshot(db, now);
  const ballots = await db.prepare("SELECT receipt_hash FROM ballots WHERE election_id=? ORDER BY id").bind(election.id).all<{ receipt_hash: string }>();
  const participation = await db.prepare("SELECT COUNT(*) AS count FROM participation WHERE election_id=? AND is_test=0").bind(election.id).first<{ count: number }>();
  return { receipt_hashes: ballots.results.map((row) => row.receipt_hash), participation_count: participation?.count ?? 0, ballot_count: ballots.results.length, closing_snapshot_hash: snapshotHash, updated_at: election.closing_snapshot_at ?? now.toISOString() };
}

export const boardRoutes = new Hono<Env>();
boardRoutes.post("/votes/receipt-check", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "body_tidak_valid" }, 400); }
  const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code : "";
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!await consumeReceiptCheck(c.env.DB, ip)) return c.json({ error: "rate_limited" }, 429);
  return c.json(await checkReceipt(c.env.DB, code));
});
boardRoutes.get("/votes/board", async (c) => {
  const board = await getPublicBoard(c.env.DB, new Date());
  return board ? c.json(board) : c.json({ error: "pemilihan_belum_ditutup" }, 409);
});
// Also supports mounting below /votes.
boardRoutes.post("/receipt-check", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "body_tidak_valid" }, 400); }
  const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code : "";
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!await consumeReceiptCheck(c.env.DB, ip)) return c.json({ error: "rate_limited" }, 429);
  return c.json(await checkReceipt(c.env.DB, code));
});
boardRoutes.get("/board", async (c) => {
  const board = await getPublicBoard(c.env.DB, new Date());
  return board ? c.json(board) : c.json({ error: "pemilihan_belum_ditutup" }, 409);
});
