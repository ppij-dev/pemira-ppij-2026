import type { D1Database } from "@cloudflare/workers-types";
import { buildAuditInsert } from "../lib/audit";
import { ServiceApiClient, type ServiceApiConfig } from "./client";
export { ServiceApiError } from "./client";
export async function assertSyncAllowed(db: D1Database): Promise<void> {
  const election = await db.prepare("SELECT status_lock FROM elections ORDER BY id LIMIT 1").first<{ status_lock: string }>();
  if (election && election.status_lock !== "draft") { const error = new Error("Sync hanya diizinkan saat pemilihan berstatus draft") as Error & { status: number }; error.status = 409; throw error; }
}
export async function syncPemilih(db: D1Database, cfg: ServiceApiConfig, now: Date): Promise<{ added: number; removed: number; total: number }> {
  const client = new ServiceApiClient(cfg);
  const units = await client.getUnits();
  const lastSync = await db.prepare("SELECT value FROM system_config WHERE key = 'pemilih_last_sync'").first<{ value: string }>();
  const members = await client.getMembers(lastSync?.value);
  const upserts = units.map((unit) => db.prepare("INSERT INTO units (path,name,parent_path,type) VALUES (?,?,?,?) ON CONFLICT(path) DO UPDATE SET name=excluded.name,parent_path=excluded.parent_path,type=excluded.type").bind(unit.path, unit.name, unit.parent_path, unit.type));
  let added = 0; let removed = 0;
  for (const member of members) {
    if (member.status === "ACTIVE") {
      const existing = await db.prepare("SELECT 1 FROM voters WHERE member_id=?").bind(member.member_id).first();
      if (!existing) added++;
      upserts.push(db.prepare("INSERT INTO voters (member_id,name,nickname,komsat_path,status,synced_at) VALUES (?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET name=excluded.name,nickname=excluded.nickname,komsat_path=excluded.komsat_path,status=excluded.status,synced_at=excluded.synced_at").bind(member.member_id, member.full_name, member.nickname, member.komsat_path, member.status, now.toISOString()));
    } else {
      const existing = await db.prepare("SELECT 1 FROM voters WHERE member_id=?").bind(member.member_id).first();
      if (existing) {
        removed++;
        upserts.push(db.prepare("DELETE FROM voters WHERE member_id=?").bind(member.member_id));
      }
    }
  }
  const totalRow = await db.prepare("SELECT COUNT(*) AS total FROM voters").first<{ total: number }>();
  const audit = await buildAuditInsert(db, { at: now.toISOString(), actor_type: "system", actor_member_id: null, actor_name: "", action: "pemilih_sync", target: null, komsat_path: null, detail_json: JSON.stringify({ summary: `+${added} baru / -${removed} keluar`, added, removed }) });
  upserts.push(db.prepare("INSERT INTO system_config (key,value) VALUES ('pemilih_last_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(now.toISOString()), audit);
  await db.batch(upserts);
  return { added, removed, total: (totalRow?.total ?? 0) + added - removed };
}
