/** Election stage from the clock alone; no cron, computed on every request (design.md decision 4). */

export type Stage = "draft" | "scheduled" | "open" | "closed" | "published";

export type ElectionStatusLock = "draft" | "locked" | "published";

export interface StageElection {
  status_lock: ElectionStatusLock;
  opens_at: string | number;
  closes_at: string | number;
  /** Set when a committee closed the election with "Tutup Sekarang". */
  closed_early_at: string | number | null;
}

function toMs(value: string | number): number {
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Waktu tidak valid: ${String(value)}`);
  return ms;
}

/**
 * draft → Draf; locked and now < opens_at → Terjadwal; locked and
 * opens_at ≤ now < closes_at and no early close → Dibuka; otherwise Ditutup;
 * published → Diumumkan.
 */
export function stage(election: StageElection, now: string | number): Stage {
  if (election.status_lock === "draft") return "draft";
  if (election.status_lock === "published") return "published";
  const nowMs = toMs(now);
  if (nowMs < toMs(election.opens_at)) return "scheduled";
  if (election.closed_early_at != null || nowMs >= toMs(election.closes_at)) return "closed";
  return "open";
}
