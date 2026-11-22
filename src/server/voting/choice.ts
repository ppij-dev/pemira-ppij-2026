/**
 * Dua jawaban surat suara mode kandidat tunggal: Setuju dan Tidak Setuju
 * (keputusan owner 2026-11-22, menggantikan tiga jawaban keputusan 2026-11-16).
 * Abstain tidak lagi dapat dipilih Pemilih: abstain hanya dipakai untuk anggota
 * Hak pilih yang tidak memilih, dihitung agregat lewat Hitung Abstain setelah
 * pemungutan suara ditutup. Nilai `abstain` tetap diterima oleh CHECK kolom
 * `ballots.choice` (migrasi 0013 tidak diubah) karena baris lama dapat
 * memuatnya, tetapi permintaan surat suara dengan pilihan itu ditolak server
 * dengan 400 `invalid_choice`. Pemilihan multi-kandidat tidak punya jawaban ini
 * (choice selalu NULL). Dipakai bersama oleh jalur suara Pemilih (vote.ts),
 * jalur Undangan Langsung (direct/vote.ts) dan Uji Coba panitia (lifecycle.ts)
 * supaya daftar nilai dan pesannya tidak pernah berbeda.
 */
export const VOTE_CHOICES = ["setuju", "tidak_setuju"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

/** Label tampilan Bahasa Indonesia per jawaban. */
export const VOTE_CHOICE_LABELS: Record<VoteChoice, string> = {
  setuju: "Setuju",
  tidak_setuju: "Tidak Setuju",
};

export function isVoteChoice(value: unknown): value is VoteChoice {
  return typeof value === "string" && (VOTE_CHOICES as readonly string[]).includes(value);
}
