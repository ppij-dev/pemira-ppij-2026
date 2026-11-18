/**
 * Jadwal pemilihan bergerak antara dua bentuk: instan tersimpan (ISO UTC dengan
 * `Z`) dan nilai `datetime-local` yang dibaca panitia sebagai waktu dinding JST
 * (Asia/Tokyo, +09:00 tanpa DST). Dua fungsi di bawah adalah satu-satunya
 * konversi:
 *   - `toJstInputValue` mengisi input di Pengaturan dengan waktu dinding JST;
 *   - `fromJstInputValue` membaca kiriman formulir (tanpa zona = JST) menjadi
 *     instan UTC.
 * Sebelumnya input diisi potongan UTC dari instan tersimpan, sehingga setiap
 * simpan menggeser jadwal -9 jam. Tampilan dan kiriman kini menyebut instan yang
 * sama.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** `datetime-local` tanpa detik: 2026-11-19T10:00 */
const NAIVE_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/** `datetime-local` dengan detik: 2026-11-19T10:00:00 */
const NAIVE_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** Instan tersimpan (ISO) → nilai input `datetime-local` waktu dinding JST. */
export function toJstInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * Nilai formulir → instan ISO UTC. Nilai tanpa zona waktu datang dari
 * `datetime-local` dan dibaca sebagai JST; nilai yang sudah membawa `Z` atau
 * offset dipakai apa adanya. `null` untuk nilai kosong atau tidak valid.
 */
export function fromJstInputValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  const withZone = NAIVE_MINUTE.test(text) ? `${text}:00+09:00` : NAIVE_SECOND.test(text) ? `${text}+09:00` : text;
  const ms = Date.parse(withZone);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
