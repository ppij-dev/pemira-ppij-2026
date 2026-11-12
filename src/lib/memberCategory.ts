/**
 * Kategori keanggotaan AD/ART PPIJ dari portal (Service API `anggota.dasar`,
 * field `member_category`). Hanya Anggota Biasa yang berhak memilih dan
 * dipilih (ART Bab II Pasal 2–3); portal mengirim `BIASA`, `LUAR_BIASA`, atau
 * null bila kategori belum ditentukan.
 */
export const REGULAR_MEMBER_CATEGORY = "BIASA";
export const REGULAR_MEMBER_LABEL = "Anggota Biasa";
export const EXTRAORDINARY_MEMBER_LABEL = "Anggota Luar Biasa";
export const UNDETERMINED_MEMBER_LABEL = "Belum ditentukan";

/** Benar hanya untuk kategori Anggota Biasa; null/kosong berarti belum ditentukan. */
export function isRegularMember(category: string | null | undefined): boolean {
  return typeof category === "string" && category.trim().toUpperCase() === REGULAR_MEMBER_CATEGORY;
}

/** Label Bahasa Indonesia untuk chip UI; null berarti portal belum menentukan. */
export function memberCategoryLabel(category: string | null | undefined): string {
  if (!category || !category.trim()) return UNDETERMINED_MEMBER_LABEL;
  return isRegularMember(category) ? REGULAR_MEMBER_LABEL : EXTRAORDINARY_MEMBER_LABEL;
}
