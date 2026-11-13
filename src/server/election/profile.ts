/**
 * URL dan pencarian halaman profil kandidat. Bentuk bernomor
 * `/kandidat/<nomor>-<nickname>` tetap dipakai pemilihan multi-kandidat. Di
 * mode kandidat tunggal nomor urut tidak pernah ditampilkan, jadi profilnya
 * hidup di `/kandidat/<nickname>` dan dicari lewat nickname.
 */
import type { D1Database } from "@cloudflare/workers-types";

export interface CandidateProfile {
  id: number;
  number: number;
  name: string;
  nickname: string;
  komsat_path: string;
  description: string | null;
  color: string | null;
  photo_key: string | null;
  short_intro: string | null;
}

const PROFILE_COLUMNS = "id,number,name,nickname,komsat_path,description,color,photo_key,short_intro";

/** Tautan profil: tanpa segmen nomor saat mode kandidat tunggal. */
export function candidateProfileHref(candidate: { nickname: string; number: number }, singleCandidateMode: boolean): string {
  const nickname = encodeURIComponent(candidate.nickname);
  return singleCandidateMode ? `/kandidat/${nickname}` : `/kandidat/${candidate.number}-${nickname}`;
}

/**
 * Cari kandidat dari segmen URL. Mode kandidat tunggal: nickname saja
 * (tanpa peduli huruf besar/kecil, sama seperti keunikan nickname). Mode biasa:
 * `<nomor>-<nickname>` seperti sebelumnya.
 */
export async function resolveCandidateProfile(
  db: D1Database,
  slug: string,
  singleCandidateMode: boolean,
): Promise<CandidateProfile | null> {
  if (singleCandidateMode) {
    let nickname: string;
    try {
      nickname = decodeURIComponent(slug).trim();
    } catch {
      return null;
    }
    if (!nickname) return null;
    return db
      .prepare(`SELECT ${PROFILE_COLUMNS} FROM candidates WHERE nickname = ? COLLATE NOCASE LIMIT 1`)
      .bind(nickname)
      .first<CandidateProfile>();
  }
  const match = /^(\d+)-(.+)$/.exec(slug);
  if (!match) return null;
  return db
    .prepare(`SELECT ${PROFILE_COLUMNS} FROM candidates WHERE number = ? AND nickname = ?`)
    .bind(Number(match[1]), decodeURIComponent(match[2]!))
    .first<CandidateProfile>();
}
