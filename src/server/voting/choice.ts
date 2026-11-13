/**
 * Dua jawaban surat suara mode kandidat tunggal: Setuju / Tidak Setuju.
 * Tidak ada Abstain (keputusan owner 2026-11-13, W7 Q37): anggota yang tidak
 * memilih dihitung sebagai Tidak Setuju saat penutupan. Dipakai bersama oleh
 * jalur suara Pemilih (vote.ts) dan Uji Coba panitia (lifecycle.ts) supaya
 * daftar nilai dan pesannya tidak pernah berbeda.
 */
export const VOTE_CHOICES = ["setuju", "tidak_setuju"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

export function isVoteChoice(value: unknown): value is VoteChoice {
  return typeof value === "string" && (VOTE_CHOICES as readonly string[]).includes(value);
}
