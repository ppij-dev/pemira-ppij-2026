/**
 * Nama tampilan anggota. Klaim `name` dari One Login kadang kosong sehingga
 * berisi UUID anggota; aturannya: jangan pernah tampilkan UUID sebagai nama.
 * Urutan: nama resmi dari roll (sinkronisasi portal) → klaim nama sesi yang
 * memang nama orang → label netral.
 */
import type { D1Database } from "@cloudflare/workers-types";

/** Label netral saat portal belum punya nama untuk anggota. */
export const NEUTRAL_ADMIN_NAME = "Admin Voting";
export const NEUTRAL_ACCOUNT_NAME = "Akun";

const MEMBER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True bila nilai terlihat seperti id anggota (UUID), bukan nama orang. */
export function looksLikeMemberId(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" || MEMBER_ID_PATTERN.test(trimmed);
}

/** Nama layak tampil: tidak kosong, bukan member_id, dan bukan UUID. */
export function usableName(value: string | null | undefined, memberId: string): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "" || trimmed === memberId.trim() || MEMBER_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/** Nama pertama yang layak; label netral bila semuanya id kosong/UUID. */
export function pickDisplayName(candidates: Array<string | null | undefined>, memberId: string, fallback: string): string {
  for (const candidate of candidates) {
    const name = usableName(candidate, memberId);
    if (name) return name;
  }
  return fallback;
}

/**
 * Nama tampilan untuk satu anggota: baris roll (voters.name) menang, lalu klaim
 * sesi, lalu label netral. Kegagalan baca roll tidak boleh menggagalkan halaman.
 */
export async function resolveDisplayName(
  db: D1Database,
  memberId: string,
  sessionName: string | null | undefined,
  fallback: string,
): Promise<string> {
  let rollName: string | null = null;
  try {
    rollName = (await db.prepare("SELECT name FROM voters WHERE member_id = ?").bind(memberId).first<{ name: string }>())?.name ?? null;
  } catch {
    rollName = null;
  }
  return pickDisplayName([rollName, sessionName], memberId, fallback);
}

/** Inisial satu huruf dari nama hasil resolusi; UUID tidak pernah jadi inisial. */
export function initialsFor(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  if (trimmed === "" || MEMBER_ID_PATTERN.test(trimmed)) return "?";
  return trimmed.charAt(0).toUpperCase();
}