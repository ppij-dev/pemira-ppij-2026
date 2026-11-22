/**
 * Helper murni untuk Papan Bukti (/papan-bukti) dan daftar kodenya
 * (/papan-bukti/daftar). Dipakai skrip halaman dan diuji langsung: penyaringan
 * dan paginasi hash terjadi sepenuhnya di peramban, kode bukti mentah tidak
 * pernah dikirim ke server (aturan keras 3).
 */

/** Jumlah hash per halaman di daftar kode bukti. */
export const RECEIPT_PAGE_SIZE = 100;

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Normalisasi masukan kode bukti di peramban: hilangkan pemisah, besar-kan,
 * petakan alias Crockford (O→0, I/L→1). Mengembalikan null bila hasilnya bukan
 * kode sah (16 karakter baru atau 26 karakter lama), sama dengan aturan server.
 */
export function normalizeBoardCodeInput(input: string): string | null {
  const value = input
    .replace(/[\s\-_.]+/g, "")
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (value.length !== 16 && value.length !== 26) return null;
  return [...value].every((ch) => CODE_ALPHABET.includes(ch)) ? value : null;
}

/** SHA-256 kode ternormalisasi sebagai heks huruf kecil, sama dengan server. */
export async function hashBoardCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Cari satu hash di daftar papan tanpa mempedulikan besar kecil hurufnya. */
export function findHashIndex(hashes: string[], hash: string): number {
  const needle = hash.toLowerCase();
  return hashes.findIndex((candidate) => candidate.toLowerCase() === needle);
}

/** Kueri pencarian hash: trim, kecilkan huruf, buang karakter bukan heks. */
export function normalizeHashQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
}

/** Saring hash berdasarkan awalan (prefiks); urutan asli dipertahankan. */
export function filterHashesByPrefix(hashes: string[], query: string): string[] {
  const prefix = normalizeHashQuery(query);
  if (!prefix) return hashes.slice();
  return hashes.filter((hash) => hash.toLowerCase().startsWith(prefix));
}

/** Jumlah halaman untuk sekian baris tersaring; minimal satu halaman. */
export function pageCountFor(total: number): number {
  return Math.max(1, Math.ceil(total / RECEIPT_PAGE_SIZE));
}

/** Jepit nomor halaman (basis satu) ke rentang sah untuk total tersaring. */
export function clampPage(page: number, total: number): number {
  return Math.min(Math.max(1, Math.trunc(page) || 1), pageCountFor(total));
}

export interface ReceiptPage {
  /** Baris hash halaman ini, sudah dipotong sesuai ukuran halaman. */
  rows: string[];
  /** Nomor halaman setelah dijepit (basis satu). */
  page: number;
  /** Jumlah halaman keseluruhan untuk total tersaring. */
  pages: number;
  /** Nomor baris pertama (basis satu) dan terakhir halaman ini. */
  start: number;
  end: number;
  /** Jumlah baris tersaring keseluruhan. */
  total: number;
}

/** Satu halaman dari daftar hash yang sudah tersaring. */
export function receiptPage(filtered: string[], requestedPage: number): ReceiptPage {
  const total = filtered.length;
  const pages = pageCountFor(total);
  const page = clampPage(requestedPage, total);
  const start = (page - 1) * RECEIPT_PAGE_SIZE;
  const rows = filtered.slice(start, start + RECEIPT_PAGE_SIZE);
  return { rows, page, pages, start: total === 0 ? 0 : start + 1, end: start + rows.length, total };
}
