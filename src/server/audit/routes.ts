import { Hono } from "hono";
import type { Bindings } from "../app";
import { requireAdmin } from "../admin/routes";
import { AUDIT_GENESIS_HASH, type AuditRow } from "../lib/audit";
import { formatJst, maskSecrets, verifyAuditRows } from "./audit";

type Env = { Bindings: Bindings };
export const auditRoutes = new Hono<Env>();
auditRoutes.use("*", requireAdmin);
auditRoutes.get("/audit", async (c) => {
  const before = Number(c.req.query("before_seq"));
  const cursor = Number.isSafeInteger(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER;
  const result = await c.env.DB.prepare("SELECT seq,at,actor_type,actor_name,action,target,komsat_path,detail_json FROM audit_log WHERE seq < ? ORDER BY seq DESC LIMIT 50").bind(cursor).all<Pick<AuditRow,"seq"|"at"|"actor_type"|"actor_name"|"action"|"target"|"komsat_path"|"detail_json">>();
  return c.json({ results: result.results.map((row) => ({ ...row, at: formatJst(row.at), detail_json: row.detail_json ? maskSecrets(JSON.parse(row.detail_json)) : null })) });
});
auditRoutes.get("/audit/integrity", async (c) => {
  let cursor = 0;
  let checked = 0;
  let broken: number | null = null;
  let expectedPrev = AUDIT_GENESIS_HASH;
  while (broken === null) {
    const batch = await c.env.DB.prepare("SELECT seq,at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash FROM audit_log WHERE seq > ? ORDER BY seq ASC LIMIT 500").bind(cursor).all<AuditRow>();
    if (!batch.results.length) break;
    const verified = await verifyAuditRows(batch.results, expectedPrev);
    broken = verified.brokenAt;
    expectedPrev = verified.expectedPrev;
    checked += batch.results.length;
    cursor = batch.results[batch.results.length - 1].seq;
  }
  return c.json({ intact: broken === null, broken_at: broken, checked_at: formatJst(new Date()), entries: checked });
});
auditRoutes.get("/audit/snapshot", async (c) => {
  const snapshot = await c.env.DB.prepare("SELECT closing_snapshot_hash, closing_snapshot_at FROM elections LIMIT 1").first<{closing_snapshot_hash:string|null; closing_snapshot_at:string|null}>();
  return c.json({ closing_snapshot_hash: snapshot?.closing_snapshot_hash ?? null, closing_snapshot_at: snapshot?.closing_snapshot_at ? formatJst(snapshot.closing_snapshot_at) : null });
});
