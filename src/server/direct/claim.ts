/**
 * Formulir klaim Undangan Langsung: Nama, Email dan Korda/Komsat disimpan pada
 * baris undangan (tidak pernah pada surat suara), lalu sesi undangan disegel
 * dengan APP_MASTER_KEY berumur 30 menit. Reservasi 30 menit mencegah dua orang
 * mengisi satu tautan pada saat yang sama; yang memutuskan tetap batch vote.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { affiliationInScope } from "../admin/routes";
import { decryptSecret, encryptSecret } from "../lib/secrets";
import { linkTokenHash, normalizeLinkCode } from "./code";
import {
  CLAIM_RESERVATION_MS,
  DirectInviteError,
  openElectionGuard,
  loadInviteElection,
  inviteStage,
  type DirectInvitationRow,
} from "./create";

export const INVITE_SESSION_COOKIE = "undangan_session";
// Path "/" karena endpoint terkait ada di /api/undangan/* sedangkan halamannya di
// /undangan/*; cookie berpath /undangan tidak akan ikut terkirim ke API.
export const INVITE_SESSION_PATH = "/";
export const INVITE_SESSION_MAX_AGE = 30 * 60;

export interface InviteSessionData {
  invitation_id: number;
  token_hash: string;
  claim_id: string;
  guest_name: string;
  komsat_path: string;
  auth_time: number;
}

function isInviteSessionData(value: unknown): value is InviteSessionData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.invitation_id === "number" &&
    Number.isInteger(row.invitation_id) &&
    typeof row.token_hash === "string" &&
    row.token_hash.length > 0 &&
    typeof row.claim_id === "string" &&
    row.claim_id.length > 0 &&
    typeof row.guest_name === "string" &&
    typeof row.komsat_path === "string" &&
    typeof row.auth_time === "number" &&
    Number.isFinite(row.auth_time)
  );
}

export function sealInviteSession(data: InviteSessionData, masterKey: string): Promise<string> {
  return encryptSecret(masterKey, JSON.stringify(data));
}

export async function openInviteSession(cookie: string, masterKey: string): Promise<InviteSessionData | null> {
  let raw: string;
  try {
    raw = await decryptSecret(masterKey, cookie);
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isInviteSessionData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface InviteUnit {
  path: string;
  name: string;
  type: string;
}

/** Unit korda/komsat di dalam cakupan situs, untuk dropdown Korda/Komsat. */
export async function loadInviteUnits(db: D1Database, scope: string): Promise<InviteUnit[]> {
  const rows = (
    await db
      .prepare("SELECT path, name, type FROM units WHERE type IN ('korda','komsat') ORDER BY path")
      .all<InviteUnit>()
  ).results;
  return rows.filter((row) => affiliationInScope(row.path, scope));
}

export interface ClaimInput {
  kode: string;
  nama: string;
  email: string;
  komsat_path: string;
}

export interface ClaimResult {
  session: InviteSessionData;
  cookie: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Simpan data tamu dan reservasi tautan. `currentClaimId` berasal dari cookie
 * sesi undangan bila ada, sehingga pemegang reservasi boleh melanjutkan.
 */
export async function claimDirectInvitation(
  db: D1Database,
  now: Date,
  input: ClaimInput,
  currentClaimId: string | null,
  opts: { masterKey: string; scope: string },
): Promise<ClaimResult> {
  const code = normalizeLinkCode(input.kode);
  if (!code) throw new DirectInviteError("Tautan tidak ditemukan.", 404, "invite_not_found");
  const nama = typeof input.nama === "string" ? input.nama.trim().replace(/\s+/g, " ") : "";
  if (nama.length < 2 || nama.length > 80) {
    throw new DirectInviteError("Nama harus diisi 2 sampai 80 karakter.", 400, "invalid_name");
  }
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (email.length === 0 || email.length > 120 || !EMAIL.test(email)) {
    throw new DirectInviteError("Alamat email tidak valid.", 400, "invalid_email");
  }
  const komsatPath = typeof input.komsat_path === "string" ? input.komsat_path.trim() : "";
  const unit = await db
    .prepare("SELECT path FROM units WHERE path = ? AND type IN ('korda','komsat')")
    .bind(komsatPath)
    .first<{ path: string }>();
  if (!unit || !affiliationInScope(unit.path, opts.scope)) {
    throw new DirectInviteError("Pilihan Korda/Komsat tidak dikenal.", 400, "invalid_unit");
  }
  const row = await db
    .prepare(
      `SELECT id, reference, token_hash, used_at, cancelled_at, claimed_at, claim_id, guest_name, komsat_path
       FROM direct_invitations WHERE token_hash = ?`,
    )
    .bind(await linkTokenHash(code))
    .first<Pick<DirectInvitationRow, "id" | "reference" | "token_hash" | "used_at" | "cancelled_at" | "claimed_at" | "claim_id" | "guest_name" | "komsat_path">>();
  if (!row) throw new DirectInviteError("Tautan tidak ditemukan.", 404, "invite_not_found");
  if (row.used_at) throw new DirectInviteError("Tautan ini sudah dipakai. Satu tautan hanya berlaku untuk satu orang.", 409, "invite_used");
  if (row.cancelled_at) throw new DirectInviteError("Tautan ini dibatalkan oleh panitia.", 409, "invite_cancelled");
  // Suara untuk identitas undangan ini sudah ada di buku besar (mis. baris
  // tautan pernah direset panitia tanpa menghapus suaranya): tolak klaim sejak
  // awal dengan pesan yang jujur, bukan setelah tamu mengisi seluruh formulir.
  const priorVote = await db
    .prepare("SELECT 1 AS vote FROM participation WHERE member_id = ? LIMIT 1")
    .bind(`undangan:${row.reference}`)
    .first<{ vote: number }>();
  if (priorVote) throw new DirectInviteError("Tautan ini sudah dipakai. Satu tautan hanya berlaku untuk satu orang.", 409, "invite_used");
  const election = await loadInviteElection(db);
  const nowIso = now.toISOString();
  const currentStage = inviteStage(election, nowIso);
  if (currentStage !== "open") {
    throw new DirectInviteError(
      currentStage === "scheduled" || currentStage === "draft"
        ? "Pemungutan suara belum dibuka. Simpan tautan ini dan kembali sesuai jadwal."
        : "Pemungutan suara telah ditutup.",
      409,
      "invite_not_open",
    );
  }
  // Reservasi hidup milik orang lain: tolak tanpa menimpa.
  const claimedMs = row.claimed_at ? Date.parse(row.claimed_at) : Number.NaN;
  const otherHolds =
    Boolean(row.claim_id) &&
    Number.isFinite(claimedMs) &&
    now.getTime() - claimedMs < CLAIM_RESERVATION_MS &&
    row.claim_id !== currentClaimId;
  if (otherHolds) {
    throw new DirectInviteError(
      "Tautan sedang diisi orang lain. Minta panitia mengirim tautan baru bila perlu.",
      409,
      "invite_reserved",
    );
  }
  const claimId = currentClaimId && row.claim_id === currentClaimId ? currentClaimId : crypto.randomUUID();
  const result = await db
    .prepare(
      `UPDATE direct_invitations
       SET claimed_at = ?, claim_id = ?, guest_name = ?, guest_email = ?, komsat_path = ?
       WHERE id = ? AND used_at IS NULL AND cancelled_at IS NULL
         AND EXISTS (SELECT 1 FROM elections e WHERE ${openElectionGuard("e")})
         AND (claimed_at IS NULL OR claim_id = ? OR (strftime('%s', ?) - strftime('%s', claimed_at)) >= ?)`,
    )
    .bind(nowIso, claimId, nama, email, unit.path, row.id, nowIso, nowIso, claimId, nowIso, Math.floor(CLAIM_RESERVATION_MS / 1000))
    .run();
  if (!result.meta.changes) {
    throw new DirectInviteError(
      "Tautan sedang diisi orang lain. Minta panitia mengirim tautan baru bila perlu.",
      409,
      "invite_reserved",
    );
  }
  const session: InviteSessionData = {
    invitation_id: row.id,
    token_hash: row.token_hash,
    claim_id: claimId,
    guest_name: nama,
    komsat_path: unit.path,
    auth_time: Math.floor(now.getTime() / 1000),
  };
  return { session, cookie: await sealInviteSession(session, opts.masterKey) };
}
