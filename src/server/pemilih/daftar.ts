import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { unitNameOf, unitPathLabel, type UnitNames } from "../../lib/formatKomsat";
import { memberCategoryLabel } from "../../lib/memberCategory";

/**
 * SATU penyusun kueri Daftar Pemilih untuk halaman `/admin/pemilih` dan
 * endpoint unduh `/api/admin/pemilih/export`: WHERE dan ORDER yang sama
 * persis, sehingga yang dilihat panitia dan yang diunduhnya tidak bisa saling
 * melenceng. LIMIT/OFFSET hanya dipasang bila `paging` diberikan (halaman);
 * ekspor memanggil tanpa paging supaya semua halaman ikut terunduh.
 */
export interface PemilihFilter {
  /** Kata kunci pencarian nama; kosong berarti semua nama. */
  q: string;
  /** Jalur komsat persis; kosong berarti semua komsat. */
  komsat: string;
  /** "voted", "not-voted", atau apa pun (kosong) berarti semua status. */
  status: string;
}

export interface PemilihPaging {
  limit: number;
  offset: number;
}

/** Baris roll: kolom yang sama dengan tabel halaman, ditambah waktu memilih. */
export interface PemilihRollRow {
  member_id: string;
  name: string;
  member_number: string | null;
  category: string | null;
  can_vote: number | null;
  komsat_path: string;
  voted_at: string | null;
  voted: number;
}

const DAFTAR_PEMILIH_SQL =
  "SELECT v.member_id,v.name,v.member_number,v.category,v.can_vote,v.komsat_path,p.voted_at,CASE WHEN p.member_id IS NULL THEN 0 ELSE 1 END AS voted FROM voters v LEFT JOIN participation p ON p.member_id=v.member_id AND p.election_id=(SELECT MAX(id) FROM elections) WHERE (?='' OR v.name LIKE ?) AND (?='' OR v.komsat_path=?) AND (?='' OR (?='voted' AND p.member_id IS NOT NULL) OR (?='not-voted' AND p.member_id IS NULL)) ORDER BY v.name";

export function daftarPemilihStatement(db: D1Database, filter: PemilihFilter, paging?: PemilihPaging): D1PreparedStatement {
  // Pola ikatan halaman lama dipertahankan apa adanya: LIKE hanya bila q isi.
  const binds: (string | number)[] = [filter.q, filter.q ? `%${filter.q}%` : "", filter.komsat, filter.komsat, filter.status, filter.status, filter.status];
  if (paging) binds.push(paging.limit, paging.offset);
  return db.prepare(paging ? `${DAFTAR_PEMILIH_SQL} LIMIT ? OFFSET ?` : DAFTAR_PEMILIH_SQL).bind(...binds);
}

/** Nama resmi unit per jalur dari tabel units; satu pembacaan untuk halaman dan ekspor. */
export async function loadUnitNames(db: D1Database): Promise<UnitNames> {
  const page = await db.prepare("SELECT path,name FROM units").all<{ path: string; name: string }>();
  const names: UnitNames = {};
  for (const row of page.results) names[row.path] = row.name;
  return names;
}

/**
 * Pecah jalur roll menjadi kolom ekspor Korda dan Komsat: korda adalah unit
 * tepat di bawah akar nasional (/ppij/<korda>), komsat adalah unit terdalam
 * pada jalur. Baris yang menempel di korda sendiri mendapat Komsat kosong.
 * Jalur di luar pola menurun ke nama pecahan jalur, tidak pernah ke galat.
 */
export function kordaKomsatLabels(path: string, names: UnitNames = {}): { korda: string; komsat: string } {
  const parts = path.split("/").filter(Boolean);
  const korda = parts.length >= 2 ? unitPathLabel(`/${parts.slice(0, 2).join("/")}`, names) : unitPathLabel(path, names);
  const komsat = parts.length > 2 ? unitNameOf(path, names) : "";
  return { korda, komsat };
}

/** Label kategori tampilan: sama dengan lencana halaman (kategori, tanpa hak pilih, belum ditentukan). */
export function kategoriLabel(row: Pick<PemilihRollRow, "category" | "can_vote">): string {
  if (row.can_vote === 1) return memberCategoryLabel(row.category);
  if (row.can_vote === 0) return "Tidak berhak memilih";
  return "Belum ditentukan";
}
