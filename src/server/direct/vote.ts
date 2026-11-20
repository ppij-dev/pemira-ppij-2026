/**
 * Surat suara lewat tautan Undangan Langsung: aturan yang sama dengan Pemilih —
 * konfirmasi nama panggilan, mode kandidat tunggal, satu surat suara per tautan,
 * kode bukti sekali pakai, dan batch D1 tunggal yang menjaga kerahasiaan.
 * Yang dikonsumsi batch adalah baris undangan: `used_at` hanya diset bila baris
 * partisipasi benar-benar masuk, sehingga dua permintaan bersamaan tetap
 * menghasilkan satu suara.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { AUDIT_GENESIS_HASH, canonicalRow, type AuditEntry } from "../lib/audit";
import { stage } from "../lib/stage";
import { isVoteChoice, type VoteChoice } from "../voting/choice";
import { generateReceipt } from "../voting/receipt";
import type { InviteSessionData } from "./claim";
import { openElectionGuard } from "./create";
import { allowAttempt, RATE_LIMIT_MESSAGE } from "./limit";

export type InviteVoteErrorStatus = 400 | 403 | 404 | 409 | 429 | 503;

export class InviteVoteError extends Error {
  constructor(
    message: string,
    public readonly status: InviteVoteErrorStatus,
    public readonly reason: string,
  ) {
    super(message);
  }
}

export interface InviteVoteResult {
  receipt_code: string;
  voted_at: string;
}

interface InviteElectionRow {
  id: number;
  status_lock: "draft" | "locked" | "published";
  opens_at: string | null;
  closes_at: string | null;
  closed_early_at: string | null;
  frozen_at: string | null;
  single_candidate_mode: number;
}

interface InviteRow {
  id: number;
  reference: string;
  token_hash: string;
  used_at: string | null;
  cancelled_at: string | null;
  guest_name: string | null;
  komsat_path: string | null;
}

interface InviteVoteRequest {
  candidate_id: number;
  confirmation_text: string;
  choice?: string | null;
}

const ELECTION_SQL =
  "SELECT id,status_lock,opens_at,closes_at,closed_early_at,frozen_at,single_candidate_mode FROM elections ORDER BY id LIMIT 1";
const VOTE_LIMIT = 5;
const VOTE_WINDOW_SEC = 60;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Aturan pemilihan bersama Pemilih: kandidat, konfirmasi nama panggilan, pilihan. */
async function resolveChoice(
  db: D1Database,
  election: InviteElectionRow,
  req: InviteVoteRequest,
): Promise<VoteChoice | null> {
  if (typeof req.candidate_id !== "number" || !Number.isInteger(req.candidate_id) || req.candidate_id <= 0) {
    throw new InviteVoteError("candidate_id tidak valid.", 400, "invalid_body");
  }
  if (typeof req.confirmation_text !== "string") {
    throw new InviteVoteError("confirmation_text tidak valid.", 400, "invalid_body");
  }
  const requestedChoice: unknown = req.choice ?? null;
  let choice: VoteChoice | null = null;
  if (election.single_candidate_mode === 1) {
    if (!isVoteChoice(requestedChoice)) throw new InviteVoteError("Pilihan suara tidak valid.", 400, "invalid_choice");
    const only = await db.prepare("SELECT id FROM candidates ORDER BY number LIMIT 1").first<{ id: number }>();
    if (!only || only.id !== req.candidate_id) {
      throw new InviteVoteError("Kandidat bukan kandidat tunggal pemilihan ini.", 400, "candidate_mismatch");
    }
    choice = requestedChoice;
  } else if (requestedChoice !== null) {
    throw new InviteVoteError("Pilihan suara hanya berlaku pada mode kandidat tunggal.", 400, "invalid_choice");
  }
  const candidate = await db
    .prepare("SELECT id,nickname FROM candidates WHERE id = ?")
    .bind(req.candidate_id)
    .first<{ id: number; nickname: string }>();
  if (!candidate) throw new InviteVoteError("Kandidat tidak ditemukan.", 404, "candidate_not_found");
  if (req.confirmation_text.trim().toLowerCase() !== candidate.nickname.trim().toLowerCase()) {
    throw new InviteVoteError("Konfirmasi nama panggilan tidak cocok.", 400, "confirmation_mismatch");
  }
  return choice;
}

/** Klasifikasi kegagalan batch yang jujur: "sudah dipakai" hanya bila suara
 * benar-benar ada — tautan benar-benar terpakai, atau baris partisipasi
 * undangan ini sudah ada di buku besar. Kegagalan batasan lain (mis. data
 * lama yang tidak konsisten) bukan tanda tautan terpakai: jangan pernah
 * melaporkan "sudah dipakai" pada tautan yang belum mengirim suara apa pun. */
async function inviteVoteBlocker(db: D1Database, invitationId: number, memberId: string): Promise<InviteVoteError> {
  const still = await db
    .prepare("SELECT used_at FROM direct_invitations WHERE id = ?")
    .bind(invitationId)
    .first<{ used_at: string | null }>();
  if (still?.used_at) return new InviteVoteError("Tautan sudah dipakai.", 409, "invite_used");
  const voted = await db
    .prepare("SELECT 1 AS vote FROM participation WHERE member_id = ? LIMIT 1")
    .bind(memberId)
    .first<{ vote: number }>();
  if (voted) return new InviteVoteError("Tautan sudah dipakai.", 409, "invite_used");
  return new InviteVoteError("Suara belum dapat disimpan. Coba lagi sebentar; bila tetap gagal, hubungi panitia.", 503, "vote_write_failed");
}

export async function castInviteVote(
  db: D1Database,
  session: InviteSessionData,
  body: unknown,
  hooks?: { beforeBatch?: () => Promise<void> },
): Promise<InviteVoteResult> {
  if (!(await allowAttempt(db, `undangan:suara:${session.invitation_id}`, VOTE_LIMIT, VOTE_WINDOW_SEC))) {
    throw new InviteVoteError(RATE_LIMIT_MESSAGE, 429, "rate_limited");
  }
  const election = await db.prepare(ELECTION_SQL).first<InviteElectionRow>();
  if (!election) throw new InviteVoteError("Pemilihan tidak ditemukan.", 404, "no_election");
  const invitation = await db
    .prepare("SELECT id, reference, token_hash, used_at, cancelled_at, guest_name, komsat_path FROM direct_invitations WHERE id = ?")
    .bind(session.invitation_id)
    .first<InviteRow>();
  if (!invitation || invitation.token_hash !== session.token_hash) {
    throw new InviteVoteError("Tautan tidak ditemukan.", 404, "invite_not_found");
  }
  if (invitation.used_at) {
    throw new InviteVoteError("Tautan sudah dipakai.", 409, "invite_used");
  }
  if (invitation.cancelled_at) {
    throw new InviteVoteError("Tautan ini dibatalkan oleh panitia.", 409, "invite_cancelled");
  }
  if (typeof body !== "object" || body === null) throw new InviteVoteError("Body tidak valid.", 400, "invalid_body");
  const req = body as InviteVoteRequest;
  const choice = await resolveChoice(db, election, req);

  const receipt = await generateReceipt();
  const ballotId = crypto.randomUUID();
  const votedAt = new Date().toISOString();
  const memberId = `undangan:${invitation.reference}`;
  const guestName = invitation.guest_name ?? session.guest_name;
  const komsatPath = invitation.komsat_path ?? session.komsat_path;
  const auditEntry: AuditEntry = {
    at: votedAt,
    actor_type: "voter",
    actor_member_id: memberId,
    actor_name: guestName,
    action: "Pemungutan suara undangan",
    target: memberId,
    komsat_path: komsatPath,
    detail_json: null,
  };

  // Setiap statement menjaga tip audit yang dibaca sebelum batch; penambahan
  // bersamaan membuat semuanya no-op dan dicoba ulang dengan tip baru.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tip = await db.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").first<{ hash: string }>();
    const previousHash = tip?.hash ?? AUDIT_GENESIS_HASH;
    const hash = await sha256Hex(previousHash + canonicalRow({ ...auditEntry, prev_hash: previousHash }));
    const tipGuard = "COALESCE((SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1), ?) = ?";
    await hooks?.beforeBatch?.();
    try {
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test)
             SELECT e.id, ?, COALESCE(di.guest_name, ?), ?, 0
             FROM direct_invitations di, elections e
             WHERE di.id = ? AND di.token_hash = ? AND di.used_at IS NULL AND di.cancelled_at IS NULL
               AND e.id = ? AND ${openElectionGuard("e")} AND ${tipGuard}`,
          )
          .bind(memberId, guestName, votedAt, invitation.id, session.token_hash, election.id, votedAt, votedAt, previousHash, previousHash),
        db
          .prepare(
            `UPDATE direct_invitations SET used_at = ?
             WHERE id = ? AND used_at IS NULL AND cancelled_at IS NULL AND changes() = 1`,
          )
          .bind(votedAt, invitation.id),
        db
          .prepare(
            `INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test, choice)
             SELECT ?, ?, ?, ?, ?, 0, ? FROM participation
             WHERE election_id = ? AND member_id = ? AND changes() = 1`,
          )
          .bind(ballotId, election.id, req.candidate_id, komsatPath, receipt.hash, choice, election.id, memberId),
        db
          .prepare(
            `INSERT INTO audit_log
               (at, actor_type, actor_member_id, actor_name, action, target, komsat_path, detail_json, prev_hash, hash)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             FROM participation
             WHERE election_id = ? AND member_id = ? AND changes() = 1 AND ${tipGuard}`,
          )
          .bind(
            auditEntry.at,
            auditEntry.actor_type,
            auditEntry.actor_member_id,
            auditEntry.actor_name,
            auditEntry.action,
            auditEntry.target,
            auditEntry.komsat_path,
            auditEntry.detail_json,
            previousHash,
            hash,
            election.id,
            memberId,
            previousHash,
            previousHash,
          ),
      ]);
      if (
        (results[0]?.meta.changes ?? 0) === 1 &&
        (results[1]?.meta.changes ?? 0) === 1 &&
        (results[2]?.meta.changes ?? 0) === 1 &&
        (results[3]?.meta.changes ?? 0) === 1
      ) {
        return { receipt_code: receipt.code, voted_at: votedAt };
      }
    } catch (error) {
      const message = String(error);
      if (message.includes("UNIQUE") || message.includes("constraint")) {
        throw await inviteVoteBlocker(db, invitation.id, memberId);
      }
      throw error;
    }
    const latest = await db.prepare(ELECTION_SQL).first<InviteElectionRow>();
    const stillOpen =
      latest !== null &&
      latest.status_lock === "locked" &&
      latest.opens_at !== null &&
      latest.closes_at !== null &&
      stage(
        { status_lock: latest.status_lock, opens_at: latest.opens_at, closes_at: latest.closes_at, closed_early_at: latest.closed_early_at },
        new Date().toISOString(),
      ) === "open";
    if (!stillOpen) {
      throw new InviteVoteError("Batas waktu pemungutan suara telah lewat.", 409, "not_open");
    }
    const stillClaimed = await db
      .prepare("SELECT used_at, cancelled_at FROM direct_invitations WHERE id = ?")
      .bind(invitation.id)
      .first<{ used_at: string | null; cancelled_at: string | null }>();
    if (stillClaimed?.used_at) throw new InviteVoteError("Tautan sudah dipakai.", 409, "invite_used");
    if (stillClaimed?.cancelled_at) throw new InviteVoteError("Tautan ini dibatalkan oleh panitia.", 409, "invite_cancelled");
    if (attempt === 2) throw new InviteVoteError("Pemilihan sedang menerima suara lain. Coba lagi.", 409, "audit_tip_changed");
  }
  throw new InviteVoteError("Pemilihan sedang menerima suara lain. Coba lagi.", 409, "audit_tip_changed");
}
