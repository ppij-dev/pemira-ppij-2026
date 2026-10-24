/**
 * Logika pemungutan suara (vote): otorisasi berlapis, konfirmasi nama
 * panggilan, rate limit 5/60s per sesi, dan penulisan partisipasi + ballot
 * + audit secara atomik dalam satu D1 batch. Tidak pernah mencatat pilihan
 * kandidat atau kode bukti mentah.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { stage, type ElectionStatusLock, type Stage } from "../lib/stage";
import { affiliationInScope } from "../admin/routes";
import { AUDIT_GENESIS_HASH, canonicalRow, type AuditEntry } from "../lib/audit";
import { generateReceipt } from "./receipt";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class VoteError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    /** Kode alasan stabil untuk UI (mis. eligibility). */
    public readonly reason: string,
  ) {
    super(message);
  }
}

export interface VoteSession {
  member_id: string;
  name: string;
  affiliation: string | string[] | null;
  auth_time: number;
}

const VOTE_LIMIT = 5;
const VOTE_WINDOW_SEC = 60;

export interface ElectionRow {
  id: number;
  status_lock: ElectionStatusLock;
  opens_at: string;
  closes_at: string;
  closed_early_at: string | null;
  frozen_at: string | null;
  allow_admin_voting: number;
  preview_mode: number;
}

export interface VoterRow {
  member_id: string;
  name: string;
  komsat_path: string;
  status: string;
}

const ELECTION_SQL =
  "SELECT id,status_lock,opens_at,closes_at,closed_early_at,frozen_at,allow_admin_voting,preview_mode FROM elections ORDER BY id LIMIT 1";

/** Usia auth_time dalam detik; negatif berarti dari masa depan. */
function sessionAgeSec(session: VoteSession): number {
  return Math.floor(Date.now() / 1000) - session.auth_time;
}

/** Rate limit atomic via D1 UPSERT; bukan memori isolate. Lempar 429 di atas batas. */
async function consumeVoteAttempt(db: D1Database, memberId: string): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
       RETURNING count, reset_at`,
    )
    .bind(`vote:${memberId}`, nowSec + VOTE_WINDOW_SEC, nowSec, nowSec, nowSec + VOTE_WINDOW_SEC)
    .first<{ count: number }>();
  if (!row || row.count > VOTE_LIMIT) throw new VoteError("Terlalu banyak percobaan. Coba lagi nanti.", 429, "rate_limited");
}

/**
 * Mode Pratinjau (fork): afiliasi pertama di dalam cakupan dipakai sebagai
 * jalur komsat pemilih; tanpa afiliasi di dalam cakupan, pakai cakupannya.
 */
export function previewKomsatPath(affiliation: string | string[] | null, scope: string): string {
  const paths = Array.isArray(affiliation) ? affiliation : affiliation ? [affiliation] : [];
  return paths.find((path) => path.startsWith(scope)) ?? scope;
}

/** Daftarkan pemilih Mode Pratinjau dari klaim sesi; idempoten. */
async function autoRegisterPreviewVoter(db: D1Database, session: VoteSession, scope: string): Promise<VoterRow> {
  await db
    .prepare(
      `INSERT INTO voters (member_id, name, nickname, komsat_path, status, synced_at)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?)
       ON CONFLICT(member_id) DO NOTHING`,
    )
    .bind(session.member_id, session.name, session.name, previewKomsatPath(session.affiliation, scope), new Date().toISOString())
    .run();
  const voter = await db
    .prepare("SELECT member_id,name,komsat_path,status FROM voters WHERE member_id = ?")
    .bind(session.member_id)
    .first<VoterRow>();
  if (!voter) throw new VoteError("Pendaftaran otomatis gagal. Coba lagi.", 403, "auto_register_failed");
  return voter;
}

/**
 * Pemeriksaan otorisasi penuh untuk memilih; melempar VoteError dengan
 * status sesuai kontrak bila gagal, mengembalikan election+voter bila lolos.
 * Dipakai castVote dan getEligibility agar aturan selalu identik.
 */
export async function authorizeVoter(
  db: D1Database,
  session: VoteSession,
): Promise<{ election: ElectionRow; voter: VoterRow }> {
  // Tahap harus tersedia dan afiliasi sesi di dalam cakupan situs
  const election = await db.prepare(ELECTION_SQL).first<ElectionRow>();
  if (!election) throw new VoteError("Pemilihan tidak ditemukan.", 404, "no_election");
  const scope = await db.prepare("SELECT value FROM system_config WHERE key = 'site_scope'").first<{ value: string }>();
  if (!scope || !affiliationInScope(session.affiliation, scope.value)) {
    throw new VoteError("Anda tidak berada dalam cakupan pemilihan ini.", 403, "out_of_scope");
  }

  // Sesi sah mengikuti umur cookie sesi (maksimum 7 hari); fork ini tidak
  // memaksa masuk ulang sebelum memilih. auth_time dari masa depan tetap
  // ditolak karena menandakan cookie yang tidak sah.
  const age = sessionAgeSec(session);
  if (age < 0) {
    throw new VoteError("Sesi masuk tidak valid. Silakan masuk kembali.", 401, "stale_session");
  }

  if (!election.frozen_at) throw new VoteError("Daftar pemilih belum dibekukan.", 409, "not_locked");
  if (stage(election, new Date().toISOString()) !== "open") {
    throw new VoteError("Pemilihan sudah ditutup atau belum dibuka.", 409, "not_open");
  }

  // Admin Voting hanya boleh memilih bila pengaturan mengizinkan
  if (
    election.allow_admin_voting === 0 &&
    (await db.prepare("SELECT 1 FROM admin_voting WHERE member_id = ?").bind(session.member_id).first())
  ) {
    throw new VoteError("Admin Voting tidak ikut memilih di pemilihan ini.", 403, "admin_voting_not_allowed");
  }

  // Pemilih harus ada di roll beku dan berstatus ACTIVE. Pada Mode Pratinjau
  // keanggotaan aktif dalam cakupan sudah terbukti dari klaim sesi, sehingga
  // pemilih terdaftar otomatis tanpa menunggu sinkronisasi daftar beku.
  let voter = await db
    .prepare("SELECT member_id,name,komsat_path,status FROM voters WHERE member_id = ?")
    .bind(session.member_id)
    .first<VoterRow>();
  if (!voter && election.preview_mode === 1) {
    voter = await autoRegisterPreviewVoter(db, session, scope.value);
  }
  if (!voter) throw new VoteError("Anda tidak terdaftar dalam daftar pemilih yang dibekukan.", 403, "not_in_roll");
  if (voter.status.toUpperCase() !== "ACTIVE") throw new VoteError("Keanggotaan Anda belum aktif.", 403, "not_active");

  return { election, voter };
}

export interface VoteRequest {
  candidate_id: number;
  confirmation_text: string;
}

export interface VoteResult {
  receipt_code: string;
  voted_at: string;
}

/**
 * Jalankan semua pemeriksaan otorisasi lalu tulis vote secara atomik.
 * Kode bukti hanya muncul di respons; tidak pernah disimpan/dicatat.
 */
export async function castVote(
  db: D1Database,
  session: VoteSession,
  body: unknown,
  hooks?: { beforeBatch?: () => Promise<void> },
): Promise<VoteResult> {
  const { voter } = await authorizeVoter(db, session);

  // Rate limit: 5 percobaan per 60 detik per sesi, dihitung setelah otorisasi
  await consumeVoteAttempt(db, session.member_id);

  // Body: candidate_id integer positif + confirmation_text string
  if (typeof body !== "object" || body === null) throw new VoteError("Body tidak valid.", 400, "invalid_body");
  const req = body as VoteRequest;
  if (typeof req.candidate_id !== "number" || !Number.isInteger(req.candidate_id) || req.candidate_id <= 0) {
    throw new VoteError("candidate_id tidak valid.", 400, "invalid_body");
  }
  if (typeof req.confirmation_text !== "string") throw new VoteError("confirmation_text tidak valid.", 400, "invalid_body");

  // Kandidat harus ada dan konfirmasi cocok (trim + case-insensitive)
  const candidate = await db
    .prepare("SELECT id,nickname FROM candidates WHERE id = ?")
    .bind(req.candidate_id)
    .first<{ id: number; nickname: string }>();
  if (!candidate) throw new VoteError("Kandidat tidak ditemukan.", 404, "candidate_not_found");
  if (req.confirmation_text.trim().toLowerCase() !== candidate.nickname.trim().toLowerCase()) {
    throw new VoteError("Konfirmasi nama panggilan tidak cocok.", 400, "confirmation_mismatch");
  }

  const receipt = await generateReceipt();
  const ballotId = crypto.randomUUID();
  const votedAt = new Date().toISOString();
  const auditEntry: AuditEntry = {
    at: votedAt,
    actor_type: "voter",
    actor_member_id: session.member_id,
    actor_name: voter.name,
    action: "voted",
    target: null,
    komsat_path: voter.komsat_path,
    detail_json: null,
  };
  const openGuard = `
    status_lock = 'locked'
    AND frozen_at IS NOT NULL
    AND closed_early_at IS NULL
    AND julianday(opens_at) <= julianday('now')
    AND julianday(closes_at) > julianday('now')
  `;

  // All batch statements compare the audit tip observed before the batch.
  // A concurrent append makes all three inserts no-op; retry with a fresh tip.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await authorizeVoter(db, session);
    const tip = await db.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").first<{ hash: string }>();
    const previousHash = tip?.hash ?? AUDIT_GENESIS_HASH;
    const hash = await sha256Hex(previousHash + canonicalRow({ ...auditEntry, prev_hash: previousHash }));
    const tipGuard = "COALESCE((SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1), ?) = ?";
    await hooks?.beforeBatch?.();

    try {
      const results = await db.batch([
        db.prepare(
          `INSERT INTO participation (election_id, member_id, member_name, voted_at, is_test)
           SELECT ?, ?, ?, ?, 0 FROM elections WHERE id = ? AND ${openGuard} AND ${tipGuard}`,
        ).bind(current.election.id, session.member_id, current.voter.name, votedAt, current.election.id, previousHash, previousHash),
        db.prepare(
          `INSERT INTO ballots (id, election_id, candidate_id, komsat_path, receipt_hash, is_test)
           SELECT ?, ?, ?, ?, ?, 0 FROM participation
           WHERE election_id = ? AND member_id = ? AND changes() = 1`,
        ).bind(ballotId, current.election.id, req.candidate_id, current.voter.komsat_path, receipt.hash, current.election.id, session.member_id),
        db.prepare(
          `INSERT INTO audit_log
             (at, actor_type, actor_member_id, actor_name, action, target, komsat_path, detail_json, prev_hash, hash)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           FROM participation
           WHERE election_id = ? AND member_id = ? AND changes() = 1 AND ${tipGuard}`,
        ).bind(
          auditEntry.at, auditEntry.actor_type, auditEntry.actor_member_id, auditEntry.actor_name,
          auditEntry.action, auditEntry.target, auditEntry.komsat_path, auditEntry.detail_json,
          previousHash, hash, current.election.id, session.member_id, previousHash, previousHash,
        ),
      ]);
      if (
        (results[0]?.meta?.changes ?? 0) === 1 &&
        (results[1]?.meta?.changes ?? 0) === 1 &&
        (results[2]?.meta?.changes ?? 0) === 1
      ) return { receipt_code: receipt.code, voted_at: votedAt };
    } catch (error) {
      const message = String(error);
      if (message.includes("UNIQUE") || message.includes("constraint")) {
        throw new VoteError("Anda sudah memilih.", 409, "already_voted");
      }
      throw error;
    }

    const latest = await db.prepare(ELECTION_SQL).first<ElectionRow>();
    if (!latest || !latest.frozen_at || stage(latest, new Date().toISOString()) !== "open") {
      throw new VoteError("Pemilihan sudah ditutup.", 409, "not_open");
    }
    if (attempt === 2) throw new VoteError("Pemilihan sedang menerima suara lain. Coba lagi.", 409, "audit_tip_changed");
  }
  throw new VoteError("Pemilihan sedang menerima suara lain. Coba lagi.", 409, "audit_tip_changed");
}

/** GET /api/votes/me: hanya voted_at, tidak pernah kandidat/hash/kode. */
export async function getVoteMe(db: D1Database, session: VoteSession): Promise<{ voted_at: string | null }> {
  const election = await db.prepare("SELECT id FROM elections ORDER BY id LIMIT 1").first<{ id: number }>();
  if (!election) return { voted_at: null };
  const row = await db
    .prepare("SELECT voted_at FROM participation WHERE election_id = ? AND member_id = ?")
    .bind(election.id, session.member_id)
    .first<{ voted_at: string }>();
  return { voted_at: row?.voted_at ?? null };
}

export interface EligibilityResult {
  allowed: boolean;
  reason: string | null;
  fresh_login_needed: boolean;
  stage: Stage | null;
}

/** GET /api/votes/eligibility: allowed/reason/fresh_login_needed + stage, tanpa kandidat. */
export async function getEligibility(db: D1Database, session: VoteSession | null): Promise<EligibilityResult> {
  const election = await db.prepare(ELECTION_SQL).first<ElectionRow>();
  const currentStage = election ? stage(election, new Date().toISOString()) : null;
  if (!session) return { allowed: false, reason: "not_logged_in", fresh_login_needed: true, stage: currentStage };
  try {
    await authorizeVoter(db, session);
  } catch (error) {
    if (error instanceof VoteError) {
      return {
        allowed: false,
        reason: error.reason,
        fresh_login_needed: error.status === 401,
        stage: currentStage,
      };
    }
    throw error;
  }
  const already = await db
    .prepare("SELECT 1 FROM participation WHERE election_id = ? AND member_id = ?")
    .bind(election!.id, session.member_id)
    .first();
  return already
    ? { allowed: false, reason: "already_voted", fresh_login_needed: false, stage: currentStage }
    : { allowed: true, reason: null, fresh_login_needed: false, stage: currentStage };
}
