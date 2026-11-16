/**
 * Tiga jawaban surat suara mode kandidat tunggal: Setuju, Tidak Setuju dan
 * Abstain (keputusan owner 2026-11-16, menggantikan "tanpa Abstain" W7 Q37).
 * Abstain adalah jawaban nyata yang dipilih Pemilih; anggota yang tidak memilih
 * hingga penutupan juga dihitung Abstain, tetapi hanya sebagai selisih Hak pilih
 * dikurangi partisipasi, tidak pernah sebagai baris surat suara. Pemilihan
 * multi-kandidat tidak punya jawaban ini (choice selalu NULL). Dipakai bersama
 * oleh jalur suara Pemilih (vote.ts) dan Uji Coba panitia (lifecycle.ts) supaya
 * daftar nilai dan pesannya tidak pernah berbeda.
 */
export const VOTE_CHOICES = ["setuju", "tidak_setuju", "abstain"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

/** Label tampilan Bahasa Indonesia per jawaban. */
export const VOTE_CHOICE_LABELS: Record<VoteChoice, string> = {
  setuju: "Setuju",
  tidak_setuju: "Tidak Setuju",
  abstain: "Abstain",
};

export function isVoteChoice(value: unknown): value is VoteChoice {
  return typeof value === "string" && (VOTE_CHOICES as readonly string[]).includes(value);
}
