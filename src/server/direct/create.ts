/**
 * Undangan Langsung: pembuatan batch, daftar (dengan tautan yang dapat disalin
 * lagi), dan pembatalan. Hanya Admin Voting (guard di admin/routes.ts).
 * Keputusan pemilik 2026-11-19: sistem mempercayai tautan, setiap tautan yang
 * belum dibatalkan menambah 1 Hak pilih, dan tautan hanya boleh berubah sebelum
 * pemungutan suara ditutup.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { buildAuditInsert, buildGuardedAuditInsert } from "../lib/audit";
import { stage, type Stage } from "../lib/stage";
import { loadUnitNames } from "../lib/units";
import { unitPathLabel } from "../../lib/formatKomsat";
import {
  generateLinkCode,
  generateReference,
  linkTokenHash,
  openLinkToken,
  publicLink,
  sealLinkToken,
} from "./code";

export const DIRECT_INVITE_BATCH_MAX = 50;
export const DIRECT_INVITE_TOTAL_MAX = 500;
/** Reservasi klaim selama 30 menit; hanya jam, tidak ada job latar. */
export const CLAIM_RESERVATION_MS = 30 * 60 * 1000;

export type DirectInviteErrorStatus = 400 | 403 | 404 | 409 | 503;

export class DirectInviteError extends Error {
  constructor(
    message: string,
    public readonly status: DirectInviteErrorStatus,
    public readonly reason: string,
  ) {
    super(message);
  }
}

export interface DirectInviteActor {
  member_id: string;
  name: string;
}

export type DirectInviteStatus = "belum" | "dipakai" | "dibatalkan";

export interface InviteElectionRow {
  id: number;
  status_lock: "draft" | "locked" | "published";
  opens_at: string | null;
  closes_at: string | null;
  closed_early_at: string | null;
}

export interface DirectInvitationRow {
  id: number;
  reference: string;
  token_hash: string;
  token_enc: string;
  created_at: string;
  created_by: string;
  created_by_name: string;
  claimed_at: string | null;
  claim_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  komsat_path: string | null;
  used_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancelled_by_name: string | null;
}

export interface GeneratedLink {
  id: number;
  reference: string;
  link: string;
}

export interface DirectInvitationView {
  id: number;
  reference: string;
  /** Tautan penuh hanya untuk baris Belum Dipakai; null untuk Dipakai/Dibatalkan. */
  link: string | null;
  status: DirectInviteStatus;
  created_at: string;
  created_by_name: string;
  claimed: { name: string | null; since: string } | null;
  used_at: string | null;
  guest_name: string | null;
  guest_email: string | null;
  komsat_path: string | null;
  komsat_label: string | null;
}

export interface DirectInvitationList {
  stage: Stage;
  active_count: number;
  used_count: number;
  cancelled_count: number;
  rows: DirectInvitationView[];
}

/** Penjaga jendela: pembuatan/pembatalan hanya sebelum pemungutan suara ditutup. */
function windowGuard(alias: string): string {
  const prefix = alias ? `${alias}.` : "";
  return `(${prefix}status_lock = 'draft' OR (${prefix}status_lock = 'locked' AND ${prefix}closed_early_at IS NULL AND julianday(${prefix}closes_at) > julianday(?)))`;
}
const WINDOW_GUARD = windowGuard("");

/** Penjaga tahap Dibuka untuk klaim dan vote: terkunci, sudah dibekukan, dan dalam jadwal. */
export function openElectionGuard(alias = "e"): string {
  const prefix = alias ? `${alias}.` : "";
  return `(${prefix}status_lock = 'locked' AND ${prefix}frozen_at IS NOT NULL AND ${prefix}closed_early_at IS NULL AND julianday(${prefix}opens_at) <= julianday(?) AND julianday(${prefix}closes_at) > julianday(?))`;
}

const CLOSED_MESSAGE =
  "Tautan tidak dapat dibuat atau dibatalkan setelah pemungutan suara ditutup.";

export async function loadInviteElection(db: D1Database): Promise<InviteElectionRow> {
  const row = await db
    .prepare("SELECT id, status_lock, opens_at, closes_at, closed_early_at FROM elections ORDER BY id LIMIT 1")
    .first<InviteElectionRow>();
  if (!row) throw new DirectInviteError("Pemilihan belum dibuat.", 404, "no_election");
  return row;
}

/** Tahap pemilihan untuk halaman undangan; terkunci tanpa jadwal ditolak, bukan 500. */
export function inviteStage(row: InviteElectionRow, nowIso: string): Stage {
  if (row.status_lock === "locked" && (!row.opens_at || !row.closes_at)) {
    throw new DirectInviteError("Jadwal pemilihan belum lengkap.", 409, "invalid_schedule");
  }
  return stage(
    { status_lock: row.status_lock, opens_at: row.opens_at ?? "", closes_at: row.closes_at ?? "", closed_early_at: row.closed_early_at },
    nowIso,
  );
}

export function assertInviteWindow(row: InviteElectionRow, nowIso: string): void {
  const current = inviteStage(row, nowIso);
  if (current === "closed" || current === "published") {
    throw new DirectInviteError(CLOSED_MESSAGE, 409, "invite_window_closed");
  }
}

export function invitationStatus(row: Pick<DirectInvitationRow, "used_at" | "cancelled_at">): DirectInviteStatus {
  if (row.cancelled_at) return "dibatalkan";
  if (row.used_at) return "dipakai";
  return "belum";
}

/**
 * Buat `count` tautan dalam satu batch; entri audit ditulis bersama batch dan
 * hanya bila barisnya benar-benar masuk (guard `changes() = 1`).
 */
export async function generateDirectInvitations(
  db: D1Database,
  now: Date,
  requested: unknown,
  actor: DirectInviteActor,
  opts: { masterKey: string; baseUrl: string },
): Promise<{ created: number; links: GeneratedLink[] }> {
  const count = typeof requested === "number" ? requested : Number(requested);
  if (!Number.isInteger(count) || count < 1 || count > DIRECT_INVITE_BATCH_MAX) {
    throw new DirectInviteError(`Jumlah undangan harus antara 1 dan ${DIRECT_INVITE_BATCH_MAX}.`, 400, "invalid_count");
  }
  const election = await loadInviteElection(db);
  const nowIso = now.toISOString();
  assertInviteWindow(election, nowIso);
  const total = (await db.prepare("SELECT COUNT(*) AS n FROM direct_invitations").first<{ n: number }>())?.n ?? 0;
  if (total + count > DIRECT_INVITE_TOTAL_MAX) {
    throw new DirectInviteError(
      `Satu pemilihan dapat memiliki paling banyak ${DIRECT_INVITE_TOTAL_MAX} undangan.`,
      409,
      "invite_total_limit",
    );
  }
  const taken = new Set(
    (await db.prepare("SELECT reference FROM direct_invitations").all<{ reference: string }>()).results.map((row) => row.reference),
  );
  const planned: { reference: string; code: string; hash: string; sealed: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const code = generateLinkCode();
    const reference = generateReference(taken);
    taken.add(reference);
    planned.push({ reference, code, hash: await linkTokenHash(code), sealed: await sealLinkToken(opts.masterKey, code) });
  }
  const inserts = planned.map((item) =>
    db
      .prepare(
        `INSERT INTO direct_invitations (reference, token_hash, token_enc, created_at, created_by, created_by_name)
         SELECT ?, ?, ?, ?, ?, ? FROM elections WHERE id = ? AND ${WINDOW_GUARD}`,
      )
      .bind(item.reference, item.hash, item.sealed, nowIso, actor.member_id, actor.name, election.id, nowIso),
  );
  const audit = await buildGuardedAuditInsert(db, {
    at: nowIso,
    actor_type: "admin",
    actor_member_id: actor.member_id,
    actor_name: actor.name,
    action: "Undangan langsung dibuat",
    target: null,
    komsat_path: null,
    detail_json: JSON.stringify({ count: planned.length, references: planned.map((item) => item.reference) }),
  });
  const results = await db.batch([...inserts, audit]);
  const inserted = inserts.reduce((sum, _statement, index) => sum + (results[index]?.meta.changes ?? 0), 0);
  if (inserted !== count) {
    throw new DirectInviteError(CLOSED_MESSAGE, 409, "invite_window_closed");
  }
  const placeholders = planned.map(() => "?").join(",");
  const rows = await db
    .prepare(`SELECT id, reference FROM direct_invitations WHERE reference IN (${placeholders})`)
    .bind(...planned.map((item) => item.reference))
    .all<{ id: number; reference: string }>();
  const idByReference = new Map(rows.results.map((row) => [row.reference, row.id]));
  const links = planned.map((item) => ({
    id: idByReference.get(item.reference) ?? 0,
    reference: item.reference,
    link: publicLink(opts.baseUrl, item.code),
  }));
  return { created: count, links };
}

/** Daftar lengkap; satu entri audit per tampilan (tally view), tanpa tautan. */
export async function listDirectInvitations(
  db: D1Database,
  now: Date,
  actor: DirectInviteActor,
  opts: { masterKey: string; baseUrl: string },
): Promise<DirectInvitationList> {
  const election = await loadInviteElection(db);
  const nowIso = now.toISOString();
  const currentStage = inviteStage(election, nowIso);
  const rows = (
    await db
      .prepare(
        `SELECT id, reference, token_hash, token_enc, created_at, created_by, created_by_name,
                claimed_at, claim_id, guest_name, guest_email, komsat_path, used_at,
                cancelled_at, cancelled_by, cancelled_by_name
         FROM direct_invitations ORDER BY created_at DESC, id DESC`,
      )
      .all<DirectInvitationRow>()
  ).results;
  const names = await loadUnitNames(db);
  const nowMs = now.getTime();
  let active = 0;
  let used = 0;
  let cancelled = 0;
  const views: DirectInvitationView[] = [];
  for (const row of rows) {
    const status = invitationStatus(row);
    if (status === "belum") active += 1;
    if (status === "dipakai") used += 1;
    if (status === "dibatalkan") cancelled += 1;
    let link: string | null = null;
    if (status === "belum") {
      const code = await openLinkToken(opts.masterKey, row.token_enc);
      if (code) link = publicLink(opts.baseUrl, code);
    }
    // Reservasi klaim hanya relevan sebelum dipakai/dibatalkan dan belum lewat 30 menit.
    const claimMs = row.claimed_at ? Date.parse(row.claimed_at) : Number.NaN;
    const claimed =
      status === "belum" && row.claimed_at && Number.isFinite(claimMs) && nowMs - claimMs < CLAIM_RESERVATION_MS
        ? { name: row.guest_name, since: row.claimed_at }
        : null;
    views.push({
      id: row.id,
      reference: row.reference,
      link,
      status,
      created_at: row.created_at,
      created_by_name: row.created_by_name,
      claimed,
      used_at: row.used_at,
      guest_name: row.guest_name,
      guest_email: row.guest_email,
      komsat_path: row.komsat_path,
      komsat_label: row.komsat_path ? unitPathLabel(row.komsat_path, names) : null,
    });
  }
  await db.batch([
    await buildAuditInsert(db, {
      at: nowIso,
      actor_type: "admin",
      actor_member_id: actor.member_id,
      actor_name: actor.name,
      action: "Daftar undangan dilihat",
      target: null,
      komsat_path: null,
      detail_json: JSON.stringify({ stage: currentStage, count: views.length }),
    }),
  ]);
  return { stage: currentStage, active_count: active, used_count: used, cancelled_count: cancelled, rows: views };
}

/** Batalkan satu tautan Belum Dipakai; menolak tautan terpakai dan jendela tutup. */
export async function cancelDirectInvitation(
  db: D1Database,
  now: Date,
  requestedId: unknown,
  actor: DirectInviteActor,
): Promise<{ reference: string }> {
  const id = typeof requestedId === "number" ? requestedId : Number(requestedId);
  if (!Number.isInteger(id) || id <= 0) throw new DirectInviteError("Undangan tidak ditemukan.", 404, "invite_not_found");
  const row = await db
    .prepare("SELECT id, reference, used_at, cancelled_at FROM direct_invitations WHERE id = ?")
    .bind(id)
    .first<{ id: number; reference: string; used_at: string | null; cancelled_at: string | null }>();
  if (!row) throw new DirectInviteError("Undangan tidak ditemukan.", 404, "invite_not_found");
  if (row.used_at) {
    throw new DirectInviteError("Tautan ini sudah dipakai dan tidak dapat dibatalkan.", 409, "invite_used");
  }
  if (row.cancelled_at) throw new DirectInviteError("Tautan ini sudah dibatalkan.", 409, "invite_cancelled");
  const election = await loadInviteElection(db);
  const nowIso = now.toISOString();
  assertInviteWindow(election, nowIso);
  const audit = await buildGuardedAuditInsert(db, {
    at: nowIso,
    actor_type: "admin",
    actor_member_id: actor.member_id,
    actor_name: actor.name,
    action: "Undangan langsung dibatalkan",
    target: `undangan:${row.reference}`,
    komsat_path: null,
    detail_json: JSON.stringify({ reference: row.reference }),
  });
  const results = await db.batch([
    db
      .prepare(
        `UPDATE direct_invitations
         SET cancelled_at = ?, cancelled_by = ?, cancelled_by_name = ?
         WHERE id = ? AND used_at IS NULL AND cancelled_at IS NULL
           AND EXISTS (SELECT 1 FROM elections e WHERE e.id = ? AND ${windowGuard("e")})`,
      )
      .bind(nowIso, actor.member_id, actor.name, id, election.id, nowIso),
    audit,
  ]);
  if (!results[0]?.meta.changes) {
    const current = await db
      .prepare("SELECT used_at, cancelled_at FROM direct_invitations WHERE id = ?")
      .bind(id)
      .first<{ used_at: string | null; cancelled_at: string | null }>();
    if (current?.used_at) throw new DirectInviteError("Tautan ini sudah dipakai dan tidak dapat dibatalkan.", 409, "invite_used");
    if (current?.cancelled_at) throw new DirectInviteError("Tautan ini sudah dibatalkan.", 409, "invite_cancelled");
    throw new DirectInviteError(CLOSED_MESSAGE, 409, "invite_window_closed");
  }
  return { reference: row.reference };
}
