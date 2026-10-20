import type { AuditRow } from "../lib/audit";

export function formatJst(value: string | Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T") + "+09:00";
}

export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [/secret|key|token|password/i.test(key) ? key : key, /secret|key|token|password/i.test(key) ? "••••••••" : maskSecrets(item)]));
  return value;
}

export async function verifyAuditRows(rows: AuditRow[]): Promise<number | null> {
  let expectedPrev = "0".repeat(64);
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) return row.seq;
    const canonical = JSON.stringify({ at: row.at, actor_type: row.actor_type, actor_member_id: row.actor_member_id, actor_name: row.actor_name, action: row.action, target: row.target, komsat_path: row.komsat_path, detail_json: row.detail_json, prev_hash: row.prev_hash });
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(row.prev_hash + canonical)));
    const hash = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hash !== row.hash) return row.seq;
    expectedPrev = row.hash;
  }
  return null;
}
