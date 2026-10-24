import { AUDIT_GENESIS_HASH, canonicalRow, sha256Hex, type AuditRow } from "../lib/audit";

export function formatJst(value: string | Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T") + "+09:00";
}

export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [/secret|key|token|password/i.test(key) ? key : key, /secret|key|token|password/i.test(key) ? "••••••••" : maskSecrets(item)]));
  return value;
}

export async function verifyAuditRows(rows: AuditRow[], expectedPrev = AUDIT_GENESIS_HASH): Promise<{ brokenAt: number | null; expectedPrev: string }> {
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) return { brokenAt: row.seq, expectedPrev };
    if (await sha256Hex(row.prev_hash + canonicalRow(row)) !== row.hash) return { brokenAt: row.seq, expectedPrev };
    expectedPrev = row.hash;
  }
  return { brokenAt: null, expectedPrev };
}
