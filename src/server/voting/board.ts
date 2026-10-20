import type { D1Database } from "@cloudflare/workers-types";
import { Hono } from "hono";
import type { Bindings } from "../app";
import { AUDIT_GENESIS_HASH, canonicalRow, sha256Hex, type AuditEntry } from "../lib/audit";
import { stage } from "../lib/stage";
import { hashReceipt, normalizeReceiptCode } from "./receipt";

type Env = { Bindings: Bindings };

export interface ElectionRow {
  id: number;
  status_lock: "draft" | "locked" | "published";
  opens_at: string;
  closes_at: string;
  closed_early_at: string | null;
  closing_snapshot_hash: string | null;
  closing_snapshot_at: string | null;
}

async function readSnapshot(db: D1Database, id: number) {
  return db
    .prepare("SELECT closing_snapshot_hash, closing_snapshot_at FROM elections WHERE id=?")
    .bind(id)
    .first<{ closing_snapshot_hash: string | null; closing_snapshot_at: string | null }>();
}

/**
 * Idempotently computes and persists the closing audit snapshot hash for an election.
 * If already closed early, closeEarly() already persisted its audit hash, which is returned directly.
 * If scheduled close, creates the 'Pemilihan ditutup' audit event on first read with CAS tip protection.
 */
export async function ensureClosingSnapshot(
  db: D1Database,
  now: Date,
  hooks?: { beforeBatch?: () => Promise<void> },
): Promise<string | null> {
  const election = await db
    .prepare("SELECT id, status_lock, opens_at, closes_at, closed_early_at, closing_snapshot_hash, closing_snapshot_at FROM elections ORDER BY id LIMIT 1")
    .first<ElectionRow>();
  if (!election) return null;

  // If already set (from previous scheduled-close read or early close), return immediately.
  if (election.closing_snapshot_hash) return election.closing_snapshot_hash;

  // Must be closed or published.
  const currentStage = stage(election, now.toISOString());
  if (currentStage !== "closed" && election.status_lock !== "published") return null;

  // Early close should have set closing_snapshot_hash inside closeEarly().
  // Only when closed_early_at IS NULL (scheduled close) does first-read finalization create the system event.
  if (election.closed_early_at !== null) {
    return election.closing_snapshot_hash ?? null;
  }

  const at = now.toISOString();
  const auditEntry: AuditEntry = {
    at,
    actor_type: "system",
    actor_member_id: null,
    actor_name: "",
    action: "Pemilihan ditutup",
    target: String(election.id),
    komsat_path: null,
    detail_json: JSON.stringify({ closing_snapshot: true }),
  };

  const tipGuard = "COALESCE((SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1), ?) = ?";

  // Bounded retry loop for concurrent scheduled close finalization.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await db
      .prepare("SELECT id, status_lock, opens_at, closes_at, closed_early_at, closing_snapshot_hash FROM elections WHERE id=?")
      .bind(election.id)
      .first<ElectionRow>();
    if (!current) return null;
    if (current.closing_snapshot_hash) return current.closing_snapshot_hash;
    if (current.closed_early_at !== null) return current.closing_snapshot_hash ?? null;
    if (stage(current, now.toISOString()) !== "closed" && current.status_lock !== "published") return null;

    const tip = await db
      .prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1")
      .first<{ hash: string }>();
    const previousHash = tip?.hash ?? AUDIT_GENESIS_HASH;
    const hash = await sha256Hex(previousHash + canonicalRow({ ...auditEntry, prev_hash: previousHash }));

    await hooks?.beforeBatch?.();

    try {
      const results = await db.batch([
        db.prepare(
          `UPDATE elections
           SET closing_snapshot_hash = ?, closing_snapshot_at = ?
           WHERE id = ?
             AND closing_snapshot_hash IS NULL
             AND closed_early_at IS NULL
             AND ${tipGuard}`,
        ).bind(hash, at, current.id, previousHash, previousHash),
        db.prepare(
          `INSERT INTO audit_log
             (at, actor_type, actor_member_id, actor_name, action, target, komsat_path, detail_json, prev_hash, hash)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           FROM elections
           WHERE id = ?
             AND closing_snapshot_hash = ?
             AND ${tipGuard}`,
        ).bind(
          auditEntry.at,
          auditEntry.actor_type,
          auditEntry.actor_member_id,
          auditEntry.actor_name,
          auditEntry.action,
          auditEntry.target,
          auditEntry.komsat_path,
          auditEntry.detail_json,
          previousHash,
          hash,
          current.id,
          hash,
          previousHash,
          previousHash,
        ),
      ]);

      if (
        (results[0]?.meta?.changes ?? 0) === 1 &&
        (results[1]?.meta?.changes ?? 0) === 1
      ) {
        return hash;
      }
    } catch {
      // If batch failed or another writer won, check below.
    }

    const winner = await readSnapshot(db, election.id);
    if (winner?.closing_snapshot_hash) {
      return winner.closing_snapshot_hash;
    }
  }

  return (await readSnapshot(db, election.id))?.closing_snapshot_hash ?? null;
}

async function consumeReceiptCheck(db: D1Database, ip: string): Promise<boolean> {
  const nowSec = Math.floor(Date.now() / 1000);
  const row = await db.prepare(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
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
  const updatedElection = await db.prepare("SELECT closing_snapshot_at FROM elections WHERE id=?").bind(election.id).first<{ closing_snapshot_at: string | null }>();
  return {
    receipt_hashes: ballots.results.map((row) => row.receipt_hash),
    participation_count: participation?.count ?? 0,
    ballot_count: ballots.results.length,
    closing_snapshot_hash: snapshotHash,
    updated_at: updatedElection?.closing_snapshot_at ?? election.closing_snapshot_at ?? now.toISOString(),
  };
}

export const boardRoutes = new Hono<Env>();

async function handleReceiptCheck(c: import("hono").Context<Env>) {
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!await consumeReceiptCheck(c.env.DB, ip)) return c.json({ error: "rate_limited" }, 429);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "body_tidak_valid" }, 400); }
  const code = typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code : "";
  return c.json(await checkReceipt(c.env.DB, code));
}

async function handleBoard(c: import("hono").Context<Env>) {
  const board = await getPublicBoard(c.env.DB, new Date());
  return board ? c.json(board) : c.json({ error: "pemilihan_belum_ditutup" }, 409);
}

boardRoutes.post("/votes/receipt-check", handleReceiptCheck);
boardRoutes.get("/votes/board", handleBoard);
// Also supports mounting below /votes.
boardRoutes.post("/receipt-check", handleReceiptCheck);
boardRoutes.get("/board", handleBoard);
