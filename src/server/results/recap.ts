import type { D1Database } from "@cloudflare/workers-types";
import { stage, type Stage } from "../lib/stage";
import { ResultsError, regionKey, UNKNOWN_REGION_KEY } from "./queries";
import { resolveHakPilih } from "../voting/board";
import { formatUnitPath, unitNameOf, unitPathLabel } from "../../lib/formatKomsat";
import { VOTE_CHOICE_LABELS } from "../voting/choice";
import { getRecapState } from "../election/lifecycle";

/**
 * Payload Rekapitulasi Suara untuk Admin Voting (keputusan owner Q232–Q234,
 * 2026-11-22). Semua angka dihitung set-based (satu batch SQL, tanpa perulangan
 * per pemilih), dari tabel mentah dengan filter Hak pilih yang sama dengan
 * penyelesai (can_vote = 1, Admin Voting dibuang saat pengaturan melarang).
 * Angka pilihan hanya tersedia setelah Rekapitulasi Suara dijalankan; sebelum
 * itu payload hanya membawa keadaan dan tidak ada satu blok data pun.
 */

/** Satu desimal, sama seperti persentase partisipasi di hasil. */
function percentage(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

export const RECAP_LINK_REMAINDER_LABEL = "Tautan undangan belum dipakai";
export const RECAP_UNMATCHED_KOMSAT_LABEL = "Di luar daftar komsat";

export interface RecapSummary {
  title: string;
  opens_at: string | null;
  closes_at: string | null;
  recap_at: string | null;
  exported_at: string;
  /** Sumber angka DPT dari penyelesai: frozen (Kunci atau Bekukan DPT), closing (snapshot penutupan), atau live. */
  dpt_source: "frozen" | "closing" | "live";
  dpt_source_label: string;
  /** Suku roll saja (tanpa tautan Undangan Langsung). */
  total_dpt: number;
  invites_created: number;
  invites_cancelled: number;
  invites_used: number;
  invites_unused: number;
  /** Hak pilih yang dipakai hasil: roll + tautan yang belum dibatalkan. */
  dpt_final: number;
  votes_used: number;
  ballot_count: number;
  setuju: number;
  tidak_setuju: number;
  abstain: number;
  setuju_pct: number;
  tidak_setuju_pct: number;
  abstain_pct: number;
}

export interface RecapRegionRow {
  key: string;
  name: string;
  hak_pilih: number;
  used: number;
  /** Null saat korda tidak punya Hak pilih untuk dibagi. */
  participation_pct: number | null;
  /** Baris sisa yang menjelaskan kekurangan penjumlahan (tautan belum dipakai / di luar unit). */
  remainder: boolean;
}

export interface RecapKomsatRow {
  path: string;
  name: string;
  korda: string;
  hak_pilih: number;
  used: number;
  participation_pct: number | null;
  remainder: boolean;
}

export interface RecapBallotRow {
  receipt_hash: string;
  choice: string;
}

export interface RecapAbstainRow {
  name: string;
  member_number: string | null;
  korda: string;
  komsat: string;
  /** True untuk baris tautan undangan yang tidak dipakai (bukan anggota). */
  is_link: boolean;
}

export interface RecapPayload {
  stage: Stage;
  single_candidate_mode: boolean;
  recap_done: boolean;
  recap_at: string | null;
  pending_count: number;
  can_run: boolean;
  reason: string | null;
  summary?: RecapSummary;
  korda?: RecapRegionRow[];
  komsat?: RecapKomsatRow[];
  ballots?: RecapBallotRow[];
  abstain?: RecapAbstainRow[];
}

interface RecapElectionRow {
  id: number;
  title: string;
  status_lock: "draft" | "locked" | "published";
  opens_at: string | null;
  closes_at: string | null;
  closed_early_at: string | null;
  allow_admin_voting: number;
  frozen_hak_pilih: number | null;
  closing_hak_pilih: number | null;
  single_candidate_mode: number;
  recap_at: string | null;
  recap_abstain_count: number | null;
  live_voter_roll: number;
}

const DPT_SOURCE_LABEL: Record<RecapSummary["dpt_source"], string> = {
  frozen: "Dibekukan",
  closing: "Snapshot penutupan",
  live: "Portal langsung",
};

/** Label jawaban surat suara; baris Abstain lama tetap berlabel Abstain, dan suara multi-kandidat memakai nickname kandidatnya. */
function choiceLabel(choice: string | null, candidateNames: Map<number, string>, candidateId: number | null): string {
  if (choice === "abstain") return "Abstain";
  if (choice && choice in VOTE_CHOICE_LABELS) return VOTE_CHOICE_LABELS[choice as keyof typeof VOTE_CHOICE_LABELS];
  if (choice) return choice;
  if (candidateId != null && candidateNames.has(candidateId)) return candidateNames.get(candidateId)!;
  return "";
}

/**
 * Seluruh payload rekap: keadaan di setiap tahap, dan kelima blok data hanya
 * setelah rekap dijalankan. Set-based: satu batch SQL untuk semua agregat.
 */
export async function getRecapPayload(db: D1Database, now: Date): Promise<RecapPayload> {
  const election = await db
    .prepare("SELECT id, title, status_lock, opens_at, closes_at, closed_early_at, allow_admin_voting, frozen_hak_pilih, closing_hak_pilih, single_candidate_mode, recap_at, recap_abstain_count, live_voter_roll FROM elections ORDER BY id LIMIT 1")
    .first<RecapElectionRow>();
  if (!election) throw new ResultsError("pemilihan_belum_dibuat", 503);
  const currentStage = stage(
    { status_lock: election.status_lock, opens_at: election.opens_at ?? "", closes_at: election.closes_at ?? "", closed_early_at: election.closed_early_at },
    now.toISOString(),
  );
  // Keadaan dari fungsi yang sama dengan tombol rekap: tahap, angka belum memilih,
  // dan alasan penolakan bila rekap belum dapat dijalankan.
  const state = await getRecapState(db, now);
  const base: RecapPayload = {
    stage: currentStage,
    single_candidate_mode: state.single_candidate_mode,
    recap_done: state.done,
    recap_at: state.done_at,
    pending_count: state.pending_count,
    can_run: state.can_run,
    reason: state.reason,
  };
  if (!state.done) return base;

  // Filter roll yang sama dengan rumus Hak pilih (election/hakPilih.ts).
  const rollFilter = election.allow_admin_voting === 0 ? " AND member_id NOT IN (SELECT member_id FROM admin_voting)" : "";
  const statements = [
    // 0: roll per jalur komsat eksak; korda dibentuk di JS dengan regionKey yang sama.
    db.prepare(`SELECT komsat_path AS path, COUNT(*) AS n FROM voters WHERE can_vote = 1${rollFilter} GROUP BY komsat_path`),
    // 1: partisipasi anggota roll per jalur (tamu Undangan Langsung tidak ada di voters).
    db.prepare("SELECT v.komsat_path AS path, COUNT(*) AS n FROM participation p JOIN voters v ON v.member_id = p.member_id WHERE p.election_id = ? AND p.is_test = 0 GROUP BY v.komsat_path").bind(election.id),
    // 2: total partisipasi dan surat suara nyata.
    db.prepare("SELECT (SELECT COUNT(*) FROM participation WHERE election_id = ? AND is_test = 0) AS participation, (SELECT COUNT(*) FROM ballots WHERE election_id = ? AND is_test = 0) AS ballots").bind(election.id, election.id),
    // 3: kotak suara — hash + pilihan saja (Q229), urut hash yang sudah acak.
    db.prepare("SELECT receipt_hash, choice, candidate_id FROM ballots WHERE election_id = ? AND is_test = 0 ORDER BY receipt_hash").bind(election.id),
    // 4: total jawaban per pilihan (hanya agregat).
    db.prepare("SELECT choice, COUNT(*) AS n FROM ballots WHERE election_id = ? AND is_test = 0 AND choice IS NOT NULL GROUP BY choice").bind(election.id),
    // 5: status semua tautan Undangan Langsung.
    db.prepare("SELECT COUNT(*) AS created, SUM(CASE WHEN cancelled_at IS NOT NULL THEN 1 ELSE 0 END) AS cancelled, SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END) AS used, SUM(CASE WHEN used_at IS NULL AND cancelled_at IS NULL THEN 1 ELSE 0 END) AS unused FROM direct_invitations"),
    // 6: tautan terpakai per jalur komsat pilihan tamunya.
    db.prepare("SELECT komsat_path AS path, COUNT(*) AS n FROM direct_invitations WHERE cancelled_at IS NULL AND used_at IS NOT NULL GROUP BY komsat_path"),
    // 7: daftar unit dari portal.
    db.prepare("SELECT path, name, parent_path, type FROM units ORDER BY path"),
    // 8: anggota roll yang tidak memilih (Q230), tanpa pernah per surat suara.
    db.prepare(`SELECT member_id, name, member_number, komsat_path FROM voters WHERE can_vote = 1${rollFilter} AND member_id NOT IN (SELECT member_id FROM participation WHERE election_id = ? AND is_test = 0) ORDER BY name, member_id`).bind(election.id),
    // 9: tautan yang tidak dipakai dan tidak dibatalkan — baris Abstain palsu.
    db.prepare("SELECT reference FROM direct_invitations WHERE used_at IS NULL AND cancelled_at IS NULL ORDER BY reference"),
    // 10: nama kandidat untuk label surat suara tanpa kolom pilihan.
    db.prepare("SELECT id, nickname FROM candidates"),
  ];
  const batch = await db.batch(statements);
  const votersByPath = batch[0] as { results: { path: string; n: number }[] };
  const participationByPath = batch[1] as { results: { path: string; n: number }[] };
  const totals = batch[2] as { results: { participation: number; ballots: number }[] };
  const ballotRows = batch[3] as { results: { receipt_hash: string; choice: string | null; candidate_id: number }[] };
  const choiceRows = batch[4] as { results: { choice: string; n: number }[] };
  const inviteTotals = batch[5] as { results: { created: number; cancelled: number | null; used: number | null; unused: number | null }[] };
  const usedInvitesByPath = batch[6] as { results: { path: string; n: number }[] };
  const unitRows = batch[7] as { results: { path: string; name: string; parent_path: string | null; type: string }[] };
  const nonVoterRows = batch[8] as { results: { member_id: string; name: string; member_number: string | null; komsat_path: string }[] };
  const unusedLinkRows = batch[9] as { results: { reference: string }[] };
  const candidateRows = batch[10] as { results: { id: number; nickname: string }[] };

  const names = new Map(unitRows.results.map((unit) => [unit.path, unit.name]));
  const kordaUnits = unitRows.results.filter((unit) => unit.type === "korda");
  const komsatUnits = unitRows.results.filter((unit) => unit.type === "komsat");
  const kordaNameOf = new Map(kordaUnits.map((unit) => [unit.path, unit.name]));
  const candidateNames = new Map(candidateRows.results.map((row) => [row.id, row.nickname]));

  const totalVoters = (row: { path: string; n: number }[]) => row.reduce((sum, entry) => sum + entry.n, 0);
  const sumByPath = (rows: { path: string; n: number }[]) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.path, (map.get(row.path) ?? 0) + row.n);
    return map;
  };
  const votersByPathMap = sumByPath(votersByPath.results);
  const participationByPathMap = sumByPath(participationByPath.results);
  const usedInviteByPathMap = sumByPath(usedInvitesByPath.results);

  // Hak pilih (DPT final) dari satu penyelesai yang sama dengan Dasbor/hasil.
  const resolution = await resolveHakPilih(db, now);
  const dptFinal = resolution.hakPilih;
  const activeLinks = (inviteTotals.results[0]?.created ?? 0) - (inviteTotals.results[0]?.cancelled ?? 0);
  // Suku roll saja. Roll beku menyimpan suku roll apa adanya; snapshot penutupan
  // memuat istilah tautan, dan tautan tidak dapat berubah setelah penutupan,
  // jadi selisihnya tepat suku roll saat rekap dijalankan.
  const totalDptRoll = resolution.source === "frozen"
    ? election.frozen_hak_pilih ?? totalVoters(votersByPath.results)
    : Math.max(0, dptFinal - activeLinks);

  const participationCount = totals.results[0]?.participation ?? 0;
  const ballotCount = totals.results[0]?.ballots ?? 0;
  const choiceTotals = new Map(choiceRows.results.map((row) => [row.choice, row.n]));
  const setuju = choiceTotals.get("setuju") ?? 0;
  const tidakSetuju = choiceTotals.get("tidak_setuju") ?? 0;
  // Abstain yang ditampilkan sama dengan hasil/Dasbor: jawaban Abstain surat
  // suara lama (bila ada) ditambah angka tidak memilih yang disimpan rekap.
  const abstainCast = choiceTotals.get("abstain") ?? 0;
  const abstainCount = abstainCast + (election.recap_abstain_count ?? 0);

  const summary: RecapSummary = {
    title: election.title,
    opens_at: election.opens_at,
    closes_at: election.closes_at,
    recap_at: election.recap_at,
    exported_at: now.toISOString(),
    dpt_source: resolution.source,
    dpt_source_label: DPT_SOURCE_LABEL[resolution.source],
    total_dpt: totalDptRoll,
    invites_created: inviteTotals.results[0]?.created ?? 0,
    invites_cancelled: inviteTotals.results[0]?.cancelled ?? 0,
    invites_used: inviteTotals.results[0]?.used ?? 0,
    invites_unused: inviteTotals.results[0]?.unused ?? 0,
    dpt_final: dptFinal,
    votes_used: participationCount,
    ballot_count: ballotCount,
    setuju,
    tidak_setuju: tidakSetuju,
    abstain: abstainCount,
    setuju_pct: percentage(setuju, dptFinal),
    tidak_setuju_pct: percentage(tidakSetuju, dptFinal),
    abstain_pct: percentage(abstainCount, dptFinal),
  };

  // Korda: partisipasi saja (tanpa angka pilihan per korda). Setiap jalur data
  // digulokkan dengan regionKey yang sama dengan Dasbor, jadi jumlah kolom
  // selalu sama dengan angka nasional; baris sisa menutup tautan belum dipakai.
  const kordaMap = new Map<string, { name: string; hakPilih: number; used: number }>();
  for (const unit of kordaUnits) kordaMap.set(unit.path, { name: unit.name, hakPilih: 0, used: 0 });
  const ensureKorda = (key: string) => {
    const existing = kordaMap.get(key);
    if (existing) return existing;
    const created = {
      name: kordaNameOf.get(key) ?? (key === UNKNOWN_REGION_KEY ? "Tidak diketahui" : formatUnitPath(key)),
      hakPilih: 0,
      used: 0,
    };
    kordaMap.set(key, created);
    return created;
  };
  for (const [path, n] of votersByPathMap) {
    const bucket = ensureKorda(regionKey(path));
    bucket.hakPilih += n;
  }
  for (const [path, n] of usedInviteByPathMap) {
    const bucket = ensureKorda(regionKey(path));
    bucket.hakPilih += n;
    bucket.used += n;
  }
  for (const [path, n] of participationByPathMap) {
    ensureKorda(regionKey(path)).used += n;
  }
  const kordaRows: RecapRegionRow[] = [...kordaMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, bucket]) => ({
      key,
      name: bucket.name,
      hak_pilih: bucket.hakPilih,
      used: bucket.used,
      participation_pct: bucket.hakPilih > 0 ? percentage(bucket.used, bucket.hakPilih) : null,
      remainder: false,
    }));
  if (summary.invites_unused > 0) {
    kordaRows.push({ key: "_tautan_belum_dipakai", name: RECAP_LINK_REMAINDER_LABEL, hak_pilih: summary.invites_unused, used: 0, participation_pct: null, remainder: true });
  }

  // Komsat: kecocokan jalur eksak dengan unit komsat; jalur di luar daftar
  // digulokkan menjadi satu baris sisa agar total tetap menambah dengan benar.
  const komsatMap = new Map<string, { name: string; korda: string; hakPilih: number; used: number }>();
  for (const unit of komsatUnits) {
    komsatMap.set(unit.path, {
      name: unitNameOf(unit.path, Object.fromEntries(names)),
      korda: unit.parent_path ? names.get(unit.parent_path) ?? formatUnitPath(unit.parent_path) : formatUnitPath(unit.path),
      hakPilih: 0,
      used: 0,
    });
  }
  let unmatchedHakPilih = 0;
  let unmatchedUsed = 0;
  const collectKomsat = (path: string, hakPilihDelta: number, usedDelta: number) => {
    const bucket = komsatMap.get(path);
    if (bucket) {
      bucket.hakPilih += hakPilihDelta;
      bucket.used += usedDelta;
      return;
    }
    unmatchedHakPilih += hakPilihDelta;
    unmatchedUsed += usedDelta;
  };
  for (const [path, n] of votersByPathMap) collectKomsat(path, n, 0);
  for (const [path, n] of usedInviteByPathMap) collectKomsat(path, n, n);
  for (const [path, n] of participationByPathMap) collectKomsat(path, 0, n);
  const komsatRows: RecapKomsatRow[] = [...komsatMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, bucket]) => ({
      path,
      name: bucket.name,
      korda: bucket.korda,
      hak_pilih: bucket.hakPilih,
      used: bucket.used,
      participation_pct: bucket.hakPilih > 0 ? percentage(bucket.used, bucket.hakPilih) : null,
      remainder: false,
    }));
  if (summary.invites_unused > 0) {
    komsatRows.push({ path: "_tautan_belum_dipakai", name: RECAP_LINK_REMAINDER_LABEL, korda: "—", hak_pilih: summary.invites_unused, used: 0, participation_pct: null, remainder: true });
  }
  if (unmatchedHakPilih > 0 || unmatchedUsed > 0) {
    komsatRows.push({ path: "_di_luar_daftar", name: RECAP_UNMATCHED_KOMSAT_LABEL, korda: "—", hak_pilih: unmatchedHakPilih, used: unmatchedUsed, participation_pct: unmatchedHakPilih > 0 ? percentage(unmatchedUsed, unmatchedHakPilih) : null, remainder: true });
  }

  // Kotak suara: hash + label pilihan saja (Q229); urutan hash sudah acak.
  const ballots: RecapBallotRow[] = ballotRows.results.map((row) => ({
    receipt_hash: row.receipt_hash,
    choice: choiceLabel(row.choice, candidateNames, row.candidate_id),
  }));

  // Abstain: anggota roll yang tidak memilih (Q230) + tautan yang tidak dipakai.
  const abstainRows: RecapAbstainRow[] = nonVoterRows.results.map((row) => {
    const key = regionKey(row.komsat_path);
    return {
      name: row.name,
      member_number: row.member_number,
      korda: kordaNameOf.get(key) ?? (key === UNKNOWN_REGION_KEY ? "Tidak diketahui" : formatUnitPath(key)),
      komsat: unitPathLabel(row.komsat_path, Object.fromEntries(names)),
      is_link: false,
    };
  });
  for (const row of unusedLinkRows.results) {
    abstainRows.push({ name: `Tautan undangan ${row.reference} (tidak dipakai)`, member_number: null, korda: "—", komsat: "—", is_link: true });
  }

  return {
    ...base,
    summary,
    korda: kordaRows,
    komsat: komsatRows,
    ballots,
    abstain: abstainRows,
  };
}
