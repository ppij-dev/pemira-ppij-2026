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

/** Satu desimal, sama seperti persentase partisipasi. */
function percentage(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
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
  /** Mode kandidat tunggal; null saat mode mati atau baris disembunyikan. */
  setuju_count: number | null;
  tidak_setuju_count: number | null;
  /** Jawaban Abstain yang diberikan Pemilih korda ini. */
  abstain_cast_count: number | null;
  /** Hak pilih korda minus partisipasi korda, dihitung sebagai Abstain. */
  tidak_memilih_count: number | null;
  /** Total Abstain: jawaban Abstain diberikan ditambah tidak memilih. */
  abstain_count: number | null;
  setuju_percentage: number | null;
  tidak_setuju_percentage: number | null;
  abstain_percentage: number | null;
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
  /** True saat pemilihan memakai mode kandidat tunggal (dibekukan di Kunci). */
  single_candidate_mode: boolean;
  /**
   * Hanya angka, tanpa keputusan: sistem tidak pernah menyatakan terpilih,
   * tidak terpilih, atau seri (keputusan owner 2026-11-16). Null saat mode mati.
   */
  setuju_count: number | null;
  tidak_setuju_count: number | null;
  /** Jawaban Abstain yang diberikan Pemilih. */
  abstain_cast_count: number | null;
  /** Hak pilih dikurangi partisipasi (minimal 0); dihitung sebagai Abstain. */
  tidak_memilih_count: number | null;
  /** Total Abstain: jawaban Abstain diberikan ditambah tidak memilih. */
  abstain_count: number | null;
  setuju_percentage: number | null;
  tidak_setuju_percentage: number | null;
  abstain_percentage: number | null;
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
  single_candidate_mode: number;
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
    .prepare("SELECT id, status_lock, opens_at, closes_at, closed_early_at, allow_admin_voting, frozen_hak_pilih, single_candidate_mode FROM elections ORDER BY id LIMIT 1")
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
  // Draf fallback roll and per-region denominators mirror the frozen count rule:
  // only roll rows the portal marks can_vote = 1 may vote, so only they are
  // eligible (can_vote 0 and NULL are never accepted by the vote guard).
  const eligibleVoterFilter = `WHERE can_vote = 1${
    election.allow_admin_voting === 0 ? " AND member_id NOT IN (SELECT member_id FROM admin_voting)" : ""
  }`;
  // Mode kandidat tunggal menambahkan agregat pilihan (GROUP BY choice) pada batch
  // yang sama; mode mati tidak pernah menjalankan kueri tambahan ini.
  const single = election.single_candidate_mode === 1;
  const statements = [
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
    db.prepare(`SELECT komsat_path AS path, COUNT(*) AS n FROM voters ${eligibleVoterFilter} GROUP BY komsat_path`),
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
    db.prepare(`SELECT COUNT(*) AS n FROM voters ${eligibleVoterFilter}`),
  ];
  if (single) {
    // Jawaban per seluruh pemilihan dan jawaban per korda, hanya agregat
    // (GROUP BY choice) dari surat suara nyata saat bukan Draf.
    statements.push(
      db.prepare(`SELECT choice, COUNT(*) AS n FROM ballots WHERE election_id = ? ${testOn("ballots")} AND choice IS NOT NULL GROUP BY choice`)
        .bind(election.id),
      db.prepare(`SELECT choice, komsat_path AS path, COUNT(*) AS n FROM ballots WHERE election_id = ? ${testOn("ballots")} AND choice IS NOT NULL GROUP BY choice, komsat_path`)
        .bind(election.id),
    );
  }
  const batchResults = await db.batch(statements);
  const [candidatesResult, votesByRegionResult, participationByPathResult, ballotsByPathResult, votersByPathResult, participationTotalResult, ballotTotalResult, testCountsResult, unitsResult, adminCountResult, eligibleFallbackResult, choiceTotalResult, choiceByRegionResult] = batchResults;
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
  const choiceTotal = choiceTotalResult as { results: { choice: string; n: number }[] } | undefined;
  const choiceByRegion = choiceByRegionResult as { results: { choice: string; path: string; n: number }[] } | undefined;


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
  // Pilihan surat suara hanya dibaca sebagai agregat, tidak pernah per surat suara.
  const choiceTotals = new Map<string, number>();
  for (const row of choiceTotal?.results ?? []) choiceTotals.set(row.choice, row.n);
  const setuju = choiceTotals.get("setuju") ?? 0;
  const tidakSetuju = choiceTotals.get("tidak_setuju") ?? 0;
  const abstainCast = choiceTotals.get("abstain") ?? 0;
  const choiceByRegionRows = new Map<string, Map<string, number>>();
  for (const row of choiceByRegion?.results ?? []) {
    const key = regionKey(row.path);
    const perChoice = choiceByRegionRows.get(key) ?? new Map<string, number>();
    perChoice.set(row.choice, (perChoice.get(row.choice) ?? 0) + row.n);
    choiceByRegionRows.set(key, perChoice);
  }
  // Tidak memilih = Hak pilih beku dikurangi partisipasi, tidak pernah per orang,
  // dan dihitung sebagai Abstain (keputusan owner 2026-11-16). Sistem tidak
  // menyatakan hasil apa pun: hanya angka dan bagiannya dari Hak pilih.
  const tidakMemilih = Math.max(0, eligibleCount - participationCount);
  const abstainTotal = abstainCast + tidakMemilih;
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
    const perChoice = choiceByRegionRows.get(key);
    // Rincian pilihan mengikuti aturan penyembunyian korda yang sama.
    const kordaSetuju = single && !suppressed ? perChoice?.get("setuju") ?? 0 : null;
    const kordaTidak = single && !suppressed ? perChoice?.get("tidak_setuju") ?? 0 : null;
    const kordaAbstainCast = single && !suppressed ? perChoice?.get("abstain") ?? 0 : null;
    const kordaTidakMemilih = single && !suppressed ? Math.max(0, eligible - used) : null;
    const kordaAbstain = kordaAbstainCast === null || kordaTidakMemilih === null ? null : kordaAbstainCast + kordaTidakMemilih;
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
      setuju_count: kordaSetuju,
      tidak_setuju_count: kordaTidak,
      abstain_cast_count: kordaAbstainCast,
      tidak_memilih_count: kordaTidakMemilih,
      abstain_count: kordaAbstain,
      // Bagian dari Hak pilih korda, sama seperti angka yang ditampilkan.
      setuju_percentage: kordaSetuju === null ? null : percentage(kordaSetuju, eligible),
      tidak_setuju_percentage: kordaTidak === null ? null : percentage(kordaTidak, eligible),
      abstain_percentage: kordaAbstain === null ? null : percentage(kordaAbstain, eligible),
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
    single_candidate_mode: single,
    setuju_count: single ? setuju : null,
    tidak_setuju_count: single ? tidakSetuju : null,
    abstain_cast_count: single ? abstainCast : null,
    tidak_memilih_count: single ? tidakMemilih : null,
    abstain_count: single ? abstainTotal : null,
    // Semua bagian dihitung dari Hak pilih yang sama, jadi jumlahnya 100.
    setuju_percentage: single ? percentage(setuju, eligibleCount) : null,
    tidak_setuju_percentage: single ? percentage(tidakSetuju, eligibleCount) : null,
    abstain_percentage: single ? percentage(abstainTotal, eligibleCount) : null,
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
