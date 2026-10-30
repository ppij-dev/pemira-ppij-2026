import type { D1Database } from "@cloudflare/workers-types";
import { stage, type Stage } from "../lib/stage";
import { formatUnitPath } from "../../lib/formatKomsat";

/** Candidate counts of a korda are hidden below this many ballots (admin-dashboard spec). */
export const KORDA_MIN_BALLOTS = 10;
/** Bucket for komsat paths from which no canonical /ppij/<korda> prefix can be derived. */
export const UNKNOWN_REGION_KEY = "/tidak-diketahui";

export class ResultsError extends Error {
  constructor(message: string, public status: 503) {
    super(message);
  }
}

export interface CandidateTally {
  id: number;
  number: number;
  nickname: string;
  color: string | null;
  votes: number;
}

export interface KordaResult {
  /** Canonical region prefix "/ppij/<korda>" derived from frozen ballot/voter paths. */
  key: string;
  /** Unit name when available, otherwise the key. */
  name: string;
  eligible_count: number;
  used_count: number;
  /** Null when the region has no eligible voters to divide by. */
  turnout_percentage: number | null;
  ballot_count: number;
  suppressed: boolean;
  /** Null while suppressed (fewer than KORDA_MIN_BALLOTS ballots). */
  candidates: CandidateTally[] | null;
}

export interface ResultsPayload {
  stage: Stage;
  opens_at: string | null;
  closes_at: string | null;
  updated_at: string;
  eligible_count: number;
  used_count: number;
  unused_count: number;
  turnout_percentage: number;
  participation_count: number;
  ballot_count: number;
  count_matches: boolean;
  candidates: CandidateTally[];
  korda: KordaResult[];
}

export interface DashboardPayload extends ResultsPayload {
  /** True when fewer than two Admin Voting exist. */
  committee_warning: boolean;
  /** Test rows included in the totals above; only present while Draf. */
  test: { participation_count: number; ballot_count: number } | null;
}

interface ElectionRow {
  id: number;
  status_lock: "draft" | "locked" | "published";
  opens_at: string | null;
  closes_at: string | null;
  closed_early_at: string | null;
  allow_admin_voting: number;
  frozen_hak_pilih: number | null;
}

/** Canonical region prefix "/ppij/<korda>"; malformed paths fall back to a named bucket. */
export function regionKey(komsatPath: string): string {
  const parts = komsatPath.split("/").filter(Boolean);
  if (parts.length >= 2) return `/${parts[0]}/${parts[1]}`;
  if (parts.length === 1) return `/${parts[0]}`;
  return UNKNOWN_REGION_KEY;
}

async function getElection(db: D1Database): Promise<ElectionRow> {
  const row = await db
    .prepare("SELECT id, status_lock, opens_at, closes_at, closed_early_at, allow_admin_voting, frozen_hak_pilih FROM elections ORDER BY id LIMIT 1")
    .first<ElectionRow>();
  if (!row) throw new ResultsError("pemilihan_belum_dibuat", 503);
  return row;
}


function bucketByRegion(rows: { path: string; n: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = regionKey(row.path);
    map.set(key, (map.get(key) ?? 0) + row.n);
  }
  return map;
}

/** All aggregates for one election, set-based SQL only (no per-voter loops). */
async function computeResults(db: D1Database, election: ElectionRow, currentStage: Stage, nowIso: string) {
  // Test rows stay visible (and labeled) while Draf; later stages count is_test=0 only.
  const realOnly = currentStage !== "draft";
  const testOn = (alias: string) => (realOnly ? `AND ${alias}.is_test = 0` : "");
  // Draf fallback roll and per-region denominators mirror the frozen count rule.
  const excludeAdmins = election.allow_admin_voting === 0
    ? "WHERE member_id NOT IN (SELECT member_id FROM admin_voting)"
    : "";
  const [candidatesResult, votesByRegionResult, participationByPathResult, ballotsByPathResult, votersByPathResult, participationTotalResult, ballotTotalResult, testCountsResult, unitsResult, adminCountResult, eligibleFallbackResult] = await db.batch([
    db.prepare(
      `SELECT c.id, c.number, c.nickname, c.color, COUNT(b.id) AS votes
       FROM candidates c LEFT JOIN ballots b ON b.candidate_id = c.id AND b.election_id = ? ${realOnly ? "AND b.is_test = 0" : ""}
       GROUP BY c.id ORDER BY c.number`,
    ).bind(election.id),
    db.prepare(`SELECT candidate_id, komsat_path AS path, COUNT(*) AS n FROM ballots WHERE election_id = ? ${testOn("ballots")} GROUP BY candidate_id, komsat_path`)
      .bind(election.id),
    db.prepare(
      `SELECT v.komsat_path AS path, COUNT(*) AS n FROM participation p JOIN voters v ON v.member_id = p.member_id
       WHERE p.election_id = ? ${testOn("p")} GROUP BY v.komsat_path`,
    ).bind(election.id),
    db.prepare(`SELECT komsat_path AS path, COUNT(*) AS n FROM ballots WHERE election_id = ? ${testOn("ballots")} GROUP BY komsat_path`)
      .bind(election.id),
    db.prepare(`SELECT komsat_path AS path, COUNT(*) AS n FROM voters ${excludeAdmins} GROUP BY komsat_path`),
    db.prepare(`SELECT COUNT(*) AS n FROM participation WHERE election_id = ? ${testOn("participation")}`)
      .bind(election.id),
    db.prepare(`SELECT COUNT(*) AS n FROM ballots WHERE election_id = ? ${testOn("ballots")}`)
      .bind(election.id),
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM participation WHERE election_id = ? AND is_test = 1) AS participation_count,
              (SELECT COUNT(*) FROM ballots WHERE election_id = ? AND is_test = 1) AS ballot_count`,
    ).bind(election.id, election.id),
    db.prepare("SELECT path, name FROM units WHERE type = 'korda'"),
    db.prepare("SELECT COUNT(*) AS n FROM admin_voting"),
    db.prepare(`SELECT COUNT(*) AS n FROM voters ${excludeAdmins}`),
  ]);
  const candidates = candidatesResult as { results: CandidateTally[] };
  const votesByRegion = votesByRegionResult as { results: { candidate_id: number; path: string; n: number }[] };
  const participationByPath = participationByPathResult as { results: { path: string; n: number }[] };
  const ballotsByPath = ballotsByPathResult as { results: { path: string; n: number }[] };
  const votersByPath = votersByPathResult as { results: { path: string; n: number }[] };
  const participationTotal = participationTotalResult as { results: { n: number }[] };
  const ballotTotal = ballotTotalResult as { results: { n: number }[] };
  const testCounts = testCountsResult as { results: { participation_count: number; ballot_count: number }[] };
  const units = unitsResult as { results: { path: string; name: string }[] };
  const adminCount = adminCountResult as { results: { n: number }[] };
  const eligibleFallback = eligibleFallbackResult as { results: { n: number }[] };

  const candidateRows = candidates.results;
  const votesByRegionRows = votesByRegion.results;
  const participationByPathRows = participationByPath.results;
  const ballotsByPathRows = ballotsByPath.results;
  const votersByPathRows = votersByPath.results;
  const participationCountRow = participationTotal.results[0];
  const ballotCountRow = ballotTotal.results[0];
  const testCountRow = testCounts.results[0];
  const unitRows = units.results;
  const adminCountRow = adminCount.results[0];
  const eligibleFallbackRow = eligibleFallback.results[0];

  const testSummary = realOnly ? null : {
    participation_count: testCountRow?.participation_count ?? 0,
    ballot_count: testCountRow?.ballot_count ?? 0,
  };

  // D1 batch executes these SELECTs as one transaction, so totals and breakdowns
  // observe one consistent database snapshot even if a vote arrives concurrently.
  const eligibleCount = election.frozen_hak_pilih ?? eligibleFallbackRow?.n ?? 0;
  const participationCount = participationCountRow?.n ?? 0;
  const ballotCount = ballotCountRow?.n ?? 0;
  const names = new Map(unitRows.map((unit) => [unit.path, unit.name]));
  const eligibleByRegion = bucketByRegion(votersByPathRows);
  const usedByRegion = bucketByRegion(participationByPathRows);
  const ballotsByRegion = bucketByRegion(ballotsByPathRows);
  const votesByRegionCandidate = new Map<string, Map<number, number>>();
  for (const row of votesByRegionRows) {
    const key = regionKey(row.path);
    const perCandidate = votesByRegionCandidate.get(key) ?? new Map<number, number>();
    perCandidate.set(row.candidate_id, (perCandidate.get(row.candidate_id) ?? 0) + row.n);
    votesByRegionCandidate.set(key, perCandidate);
  }
  const keys = [...new Set([...eligibleByRegion.keys(), ...usedByRegion.keys(), ...ballotsByRegion.keys()])].sort();
  const korda: KordaResult[] = keys.map((key) => {
    const eligible = eligibleByRegion.get(key) ?? 0;
    const used = usedByRegion.get(key) ?? 0;
    const ballots = ballotsByRegion.get(key) ?? 0;
    const suppressed = ballots < KORDA_MIN_BALLOTS;
    const perCandidate = votesByRegionCandidate.get(key);
    return {
      key,
      name: names.get(key) ?? (key === UNKNOWN_REGION_KEY ? "Tidak diketahui" : formatUnitPath(key)),
      eligible_count: eligible,
      used_count: used,
      turnout_percentage: eligible > 0 ? Math.round(((used / eligible) * 100) * 10) / 10 : null,
      ballot_count: ballots,
      suppressed,
      candidates: suppressed
        ? null
        : candidateRows.map((candidate) => ({ ...candidate, votes: perCandidate?.get(candidate.id) ?? 0 })),
    };
  });

  const base: ResultsPayload = {
    stage: currentStage,
    opens_at: election.opens_at,
    closes_at: election.closes_at,
    updated_at: nowIso,
    eligible_count: eligibleCount,
    used_count: participationCount,
    unused_count: Math.max(0, eligibleCount - participationCount),
    turnout_percentage: eligibleCount > 0 ? Math.round(((participationCount / eligibleCount) * 100) * 10) / 10 : 0,
    participation_count: participationCount,
    ballot_count: ballotCount,
    count_matches: participationCount === ballotCount,
    candidates: candidateRows,
    korda,
  };
  return {
    base,
    admin_count: adminCountRow?.n ?? 0,
    test: testSummary,
  };

}

/** Dasbor payload for Admin Voting; the caller records the tally-load audit entry. */
export async function getDashboard(db: D1Database, now: Date): Promise<DashboardPayload> {
  const election = await getElection(db);
  const currentStage = stage(
    { status_lock: election.status_lock, opens_at: election.opens_at ?? "", closes_at: election.closes_at ?? "", closed_early_at: election.closed_early_at },
    now.toISOString(),
  );
  const { base, admin_count, test } = await computeResults(db, election, currentStage, now.toISOString());
  return { ...base, committee_warning: admin_count < 2, test };
}

/** Public aggregates; null until the election is Diumumkan. Never audit-logged. */
export async function getPublicResults(db: D1Database, now: Date): Promise<ResultsPayload | null> {
  const election = await getElection(db);
  const currentStage = stage(
    { status_lock: election.status_lock, opens_at: election.opens_at ?? "", closes_at: election.closes_at ?? "", closed_early_at: election.closed_early_at },
    now.toISOString(),
  );
  if (currentStage !== "published") return null;
  const { base } = await computeResults(db, election, currentStage, now.toISOString());
  return base;
}
