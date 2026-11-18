/**
 * Rate limit untuk endpoint undangan, memakai tabel D1 `rate_limits` yang sama
 * seperti pemungutan suara (UPSERT atomik). Kunci dibangun dari hash kode atau
 * id baris undangan, tidak pernah dari alamat IP: situs ini tidak menyimpan IP.
 */
import type { D1Database } from "@cloudflare/workers-types";

/** Kembalikan true bila percobaan masih di bawah batas, false bila harus ditolak. */
export async function allowAttempt(
  db: D1Database,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const nowSec = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
       RETURNING count`,
    )
    .bind(key, nowSec + windowSec, nowSec, nowSec, nowSec + windowSec)
    .first<{ count: number }>();
  return (row?.count ?? limit + 1) <= limit;
}

export const RATE_LIMIT_MESSAGE = "Terlalu banyak percobaan. Coba lagi nanti.";
