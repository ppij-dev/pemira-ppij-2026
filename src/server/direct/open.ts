/**
 * Membuka tautan Undangan Langsung: kode dicari lewat SHA-256, tahap pemilihan
 * ditentukan jam, dan hasilnya memberi halaman undangan tahu apa yang boleh
 * ditampilkan. Token mentah tidak pernah dibaca dari penyimpanan di sini.
 */
import type { D1Database } from "@cloudflare/workers-types";
import type { Stage } from "../lib/stage";
import { linkTokenHash, normalizeLinkCode } from "./code";
import { invitationStatus, inviteStage, loadInviteElection, type DirectInvitationRow } from "./create";
import { allowAttempt } from "./limit";

export type DirectLinkOutcome = "ok" | "used" | "cancelled" | "unknown" | "unavailable";

export interface DirectLinkInvitation {
  id: number;
  reference: string;
  guest_name: string | null;
  claimed_at: string | null;
  komsat_path: string | null;
}

export interface DirectLinkView {
  outcome: DirectLinkOutcome;
  stage: Stage | null;
  opens_at: string | null;
  closes_at: string | null;
  closed_early_at: string | null;
  invitation: DirectLinkInvitation | null;
}

const empty: DirectLinkView = {
  outcome: "unknown",
  stage: null,
  opens_at: null,
  closes_at: null,
  closed_early_at: null,
  invitation: null,
};

/**
 * Batas pembukaan tautan: per kode (anti tebak) dan satu langit-langit global.
 * Kunci dibangun dari hash kode, bukan alamat IP; tidak ada IP yang disimpan.
 * false = terlalu banyak permintaan, halaman menampilkan not-found biasa.
 */
export async function consumeOpenLimit(db: D1Database, rawCode: string): Promise<boolean> {
  const code = normalizeLinkCode(rawCode);
  const perCode = code
    ? await allowAttempt(db, `undangan:buka:${(await linkTokenHash(code)).slice(0, 16)}`, 30, 60)
    : true;
  const global = await allowAttempt(db, "undangan:buka:semua", 600, 60);
  return perCode && global;
}

/** Selesaikan satu kode; tidak pernah melempar untuk kode yang tidak dikenal. */
export async function resolveDirectLink(db: D1Database, now: Date, rawCode: string): Promise<DirectLinkView> {
  const code = normalizeLinkCode(rawCode);
  if (!code) return empty;
  const row = await db
    .prepare("SELECT id, reference, used_at, cancelled_at, claimed_at, guest_name, komsat_path FROM direct_invitations WHERE token_hash = ?")
    .bind(await linkTokenHash(code))
    .first<Pick<DirectInvitationRow, "id" | "reference" | "used_at" | "cancelled_at" | "claimed_at" | "guest_name" | "komsat_path">>();
  if (!row) return empty;
  const invitation: DirectLinkInvitation = {
    id: row.id,
    reference: row.reference,
    guest_name: row.guest_name,
    claimed_at: row.claimed_at,
    komsat_path: row.komsat_path,
  };
  let election: Awaited<ReturnType<typeof loadInviteElection>>;
  try {
    election = await loadInviteElection(db);
  } catch {
    return { ...empty, outcome: "unavailable", invitation };
  }
  const base = { opens_at: election.opens_at, closes_at: election.closes_at, closed_early_at: election.closed_early_at, invitation };
  const status = invitationStatus(row);
  if (status === "dipakai") return { outcome: "used", stage: null, ...base };
  if (status === "dibatalkan") return { outcome: "cancelled", stage: null, ...base };
  let currentStage: Stage;
  try {
    currentStage = inviteStage(election, now.toISOString());
  } catch {
    // Jadwal terkunci yang rusak: perlakukan sebagai ditutup, jangan 500.
    currentStage = "closed";
  }
  return { outcome: "ok", stage: currentStage, ...base };
}
