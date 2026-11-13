import type { D1Database } from "@cloudflare/workers-types";

/**
 * Nilai saklar mode kandidat tunggal pada baris pemilihan (satu pemilihan per
 * situs). Dibaca, bukan disimpan: nilainya dibekukan saat Kunci & Jadwalkan.
 * Baris pemilihan yang belum ada dianggap mode mati.
 */
export async function isSingleCandidateMode(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT single_candidate_mode FROM elections ORDER BY id LIMIT 1")
    .first<{ single_candidate_mode: number }>();
  return row?.single_candidate_mode === 1;
}
