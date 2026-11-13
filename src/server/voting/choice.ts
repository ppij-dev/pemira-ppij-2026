/**
 * Tiga jawaban surat suara mode kandidat tunggal. Dipakai bersama oleh jalur
 * suara Pemilih (vote.ts) dan Uji Coba panitia (lifecycle.ts) supaya daftar
 * nilai dan pesannya tidak pernah berbeda.
 */
export const VOTE_CHOICES = ["setuju", "tidak_setuju", "abstain"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

export function isVoteChoice(value: unknown): value is VoteChoice {
  return typeof value === "string" && (VOTE_CHOICES as readonly string[]).includes(value);
}
