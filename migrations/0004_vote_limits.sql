-- Tabel rate limit untuk API pemungutan suara dan cek bukti.
-- key = "vote:<member_id>" untuk POST /api/votes (5/60s per sesi)
-- key = "receipt:<ip>" untuk cek hash bukti (30/60s per IP, task 4.2)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
