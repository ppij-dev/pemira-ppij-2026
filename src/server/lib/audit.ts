import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

/**
 * Hash chain for audit_log (design.md decision 9):
 * hash = SHA-256(prev_hash || canonical row), genesis prev_hash for the first entry.
 */
export const AUDIT_GENESIS_HASH = "0".repeat(64);

/** Values match the audit_log CHECK in migrations/0001_init.sql. */
export type AuditActorType = "admin" | "voter" | "system";

export interface AuditEntry {
  /** ISO-8601 timestamp (JST) of the action. */
  at: string;
  actor_type: AuditActorType;
  actor_member_id: string | null;
  actor_name: string;
  action: string;
  target: string | null;
  komsat_path: string | null;
  detail_json: string | null;
}

export interface AuditRow extends AuditEntry {
  seq: number;
  prev_hash: string;
  hash: string;
}

/**
 * Deterministic serialization of one audit row, in a fixed key order.
 * Writer and verifier must use this exact function.
 */
export function canonicalRow(row: AuditEntry & { prev_hash: string }): string {
  return JSON.stringify({
    at: row.at,
    actor_type: row.actor_type,
    actor_member_id: row.actor_member_id,
    actor_name: row.actor_name,
    action: row.action,
    target: row.target,
    komsat_path: row.komsat_path,
    detail_json: row.detail_json,
    prev_hash: row.prev_hash,
  });
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Builds the INSERT statement for one audit entry, with prev_hash taken from the
 * last row and hash = SHA-256(prev_hash || canonical row). Awaiting this returns
 * a prepared statement the caller includes in its D1 batch next to the action
 * it records.
 */
export async function buildAuditInsert(
  db: D1Database,
  entry: AuditEntry,
): Promise<D1PreparedStatement> {
  const last = await db
    .prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1")
    .first<{ hash: string }>();
  const prevHash = last?.hash ?? AUDIT_GENESIS_HASH;
  const hash = await sha256Hex(prevHash + canonicalRow({ ...entry, prev_hash: prevHash }));
  return db
    .prepare(
      "INSERT INTO audit_log (at, actor_type, actor_member_id, actor_name, action, target, komsat_path, detail_json, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      entry.at,
      entry.actor_type,
      entry.actor_member_id,
      entry.actor_name,
      entry.action,
      entry.target,
      entry.komsat_path,
      entry.detail_json,
      prevHash,
      hash,
    );
}

/**
 * Walks rows in seq order and reports the seq of the first entry that breaks the
 * chain (edited row, or first entry after a deleted row), or null when intact.
 */
export async function verifyChain(rows: AuditRow[]): Promise<number | null> {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  let expectedPrev = AUDIT_GENESIS_HASH;
  for (const row of ordered) {
    if (row.prev_hash !== expectedPrev) return row.seq;
    const recomputed = await sha256Hex(row.prev_hash + canonicalRow(row));
    if (recomputed !== row.hash) return row.seq;
    expectedPrev = row.hash;
  }
  return null;
}
