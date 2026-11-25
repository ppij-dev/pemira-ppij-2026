import type { D1Database } from "@cloudflare/workers-types";
import { Hono } from "hono";
import type { Bindings } from "../app";
import { AUDIT_GENESIS_HASH, canonicalRow, sha256Hex, type AuditEntry } from "../lib/audit";
import { stage } from "../lib/stage";
import { directInviteTerm, liveHakPilih, withDirectInvites } from "../election/hakPilih";
import type { ServiceApiConfig } from "../serviceapi/client";
import { refreshPortalViewForRead, serviceApiConfig, type ServiceApiEnv } from "../serviceapi/sync";

type Env = { Bindings: Bindings & ServiceApiEnv };

export interface ElectionRow {
  id: number;
  status_lock: "draft" | "locked" | "published";
  opens_at: string;
  closes_at: string;
  closed_early_at: string | null;
  closing_snapshot_hash: string | null;
  closing_snapshot_at: string | null;
}

async function readSnapshot(db: D1Database, id: number) {
  return db
    .prepare("SELECT closing_snapshot_hash, closing_snapshot_at FROM elections WHERE id=?")
    .bind(id)
    .first<{ closing_snapshot_hash: string | null; closing_snapshot_at: string | null }>();
}

interface ClosingHakPilihRow {
  id: number;
  status_lock: "draft" | "locked" | "published";
  opens_at: string;
  closes_at: string;
  closed_early_at: string | null;
  closing_hak_pilih: number | null;
  live_voter_roll: number;
}

/**
 * Menetapkan Hak pilih akhir mode "Tidak Membekukan DPT" (keputusan owner
 * 2026-11-19): tidak ada cron, tahap dihitung dari jam, jadi angka live Hak
 * pilih ditetapkan sekali oleh pembacaan pertama yang melihat pemilihan sudah
 * Ditutup, atau langsung di batch Tutup Sekarang. Pola sama dengan
 * ensureClosingSnapshot: UPDATE bergerbang + entri audit bergerbang ujung
 * rantai dalam satu D1 batch, dan pembaca yang kalah membaca nilai pemenang.
 * Hanya pernah menulis saat saklar menyala; saat mati kolom tetap NULL dan
 * Hak pilih tetap dari frozen_hak_pilih.
 */
export async function ensureClosingHakPilih(db: D1Database, now: Date): Promise<number | null> {
  const election = await db
    .prepare("SELECT id, status_lock, opens_at, closes_at, closed_early_at, closing_hak_pilih, live_voter_roll FROM elections ORDER BY id LIMIT 1")
    .first<ClosingHakPilihRow>();
  if (!election) return null;
  if (election.closing_hak_pilih != null) return election.closing_hak_pilih;
  // Saklar mati: snapshot tidak pernah ditulis, Hak pilih dari frozen_hak_pilih.
  if (election.live_voter_roll !== 1) return null;
  const currentStage = stage(election, now.toISOString());
  if (currentStage !== "closed" && election.status_lock !== "published") return null;
  // Tutup lebih awal sudah menetapkan angkanya di batch Tutup Sekarang.
  if (election.closed_early_at !== null) return election.closing_hak_pilih;

  const hakPilih = await liveHakPilih(db);
  const at = now.toISOString();
  const auditEntry: AuditEntry = {
    at,
    actor_type: "system",
    actor_member_id: null,
    actor_name: "",
    action: "Hak pilih akhir disimpan",
    target: String(election.id),
    komsat_path: null,
    detail_json: JSON.stringify({ hak_pilih: hakPilih }),
  };

  const tipGuard = "COALESCE((SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1), ?) = ?";
  const closeGuard = "(closed_early_at IS NOT NULL OR julianday(closes_at) <= julianday('now'))";

  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await db
      .prepare("SELECT id, status_lock, opens_at, closes_at, closed_early_at, closing_hak_pilih, live_voter_roll FROM elections WHERE id=?")
      .bind(election.id)
      .first<ClosingHakPilihRow>();
    if (!current) return null;
    if (current.closing_hak_pilih != null) return current.closing_hak_pilih;
    if (current.live_voter_roll !== 1) return null;
    if (stage(current, now.toISOString()) !== "closed" && current.status_lock !== "published") return null;
    if (current.closed_early_at !== null) return current.closing_hak_pilih;

    const tip = await db.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").first<{ hash: string }>();
    const previousHash = tip?.hash ?? AUDIT_GENESIS_HASH;
    const hash = await sha256Hex(previousHash + canonicalRow({ ...auditEntry, prev_hash: previousHash }));

    try {
      const results = await db.batch([
        db.prepare(
          `UPDATE elections
           SET closing_hak_pilih = ?, closing_hak_pilih_at = ?
           WHERE id = ?
             AND closing_hak_pilih IS NULL
             AND status_lock = 'locked'
             AND live_voter_roll = 1
             AND ${closeGuard}
             AND ${tipGuard}`,
        ).bind(hakPilih, at, current.id, previousHash, previousHash),
        db.prepare(
          `INSERT INTO audit_log
             (at, actor_type, actor_member_id, actor_name, action, target, komsat_path, detail_json, prev_hash, hash)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           FROM elections
           WHERE id = ?
             AND closing_hak_pilih = ?
             AND ${tipGuard}`,
        ).bind(
          auditEntry.at, auditEntry.actor_type, auditEntry.actor_member_id, auditEntry.actor_name,
          auditEntry.action, auditEntry.target, auditEntry.komsat_path, auditEntry.detail_json,
          previousHash, hash, current.id, hakPilih, previousHash, previousHash,
        ),
      ]);
      if ((results[0]?.meta?.changes ?? 0) === 1 && (results[1]?.meta?.changes ?? 0) === 1) {
        return hakPilih;
      }
    } catch {
      // Batch gagal atau penulis lain menang; cek pemenang di bawah.
    }

    const winner = await db
      .prepare("SELECT closing_hak_pilih FROM elections WHERE id=?")
      .bind(election.id)
      .first<{ closing_hak_pilih: number | null }>();
    if (winner?.closing_hak_pilih != null) return winner.closing_hak_pilih;
  }

  const fallback = await db
    .prepare("SELECT closing_hak_pilih FROM elections WHERE id=?")
    .bind(election.id)
    .first<{ closing_hak_pilih: number | null }>();
  return fallback?.closing_hak_pilih ?? null;
}

export interface HakPilihResolution {
  hakPilih: number;
  /** frozen = frozen_hak_pilih (saklar mati), live = hitungan view, closing = snapshot penutupan. */
  source: "frozen" | "live" | "closing";
}

interface ResolveRow extends ClosingHakPilihRow {
  frozen_hak_pilih: number | null;
}

/**
 * Penyelesai Hak pilih untuk semua konsumen (hasil, Dasbor, turnout, Hitung
 * Abstain): saklar mati memakai frozen_hak_pilih dengan fallback hitungan view
 * saat Draf; saklar menyala memakai snapshot penutupan setelah Ditutup dan
 * hitungan live sebelumnya. Titik penetapan snapshot dijalankan di sini, jadi
 * tidak ada konsumen yang melihat "Ditutup tapi belum disimpan".
 */
export async function resolveHakPilih(db: D1Database, now: Date, portal?: ServiceApiConfig): Promise<HakPilihResolution> {
  const row = await db
    .prepare("SELECT id, status_lock, opens_at, closes_at, closed_early_at, closing_hak_pilih, live_voter_roll, frozen_hak_pilih FROM elections ORDER BY id LIMIT 1")
    .first<ResolveRow>();
  if (!row) return { hakPilih: 0, source: "frozen" };
  if (row.live_voter_roll === 1) {
    // Pembacaan yang menunjukkan Hak pilih (turnout, Dasbor, hasil) menyegarkan
    // view portal lewat jalur yang sama dengan jalur memilih: TTL 30 detik,
    // cooldown gagal, stale-while-unavailable, dengan batas tunggu pendek supaya
    // halaman publik tidak pernah menunggu portal lama. Draf/Ditutup/Diumumkan
    // dilewati oleh penjaga di dalam penyegar.
    await refreshPortalViewForRead(db, portal, now);
  }
  if (row.live_voter_roll !== 1) {
    // Roll beku: `frozen_hak_pilih` tetap hanya suku roll, jadi tautan Undangan
    // Langsung ditambahkan di sini lewat helper yang sama (satu tempat).
    if (row.frozen_hak_pilih != null)
      return { hakPilih: withDirectInvites(row.frozen_hak_pilih, await directInviteTerm(db)), source: "frozen" };
    return { hakPilih: await liveHakPilih(db), source: "live" };
  }
  const currentStage = stage(row, now.toISOString());
  if (currentStage === "closed" || row.status_lock === "published") {
    const saved = await ensureClosingHakPilih(db, now);
    if (saved != null) return { hakPilih: saved, source: "closing" };
  }
  return { hakPilih: await liveHakPilih(db), source: "live" };
}

/**
 * Idempotently computes and persists the closing audit snapshot hash for an election.
 * If already closed early, closeEarly() already persisted its audit hash, which is returned directly.
 * If scheduled close, creates the 'Pemilihan ditutup' audit event on first read with CAS tip protection.
 */
export async function ensureClosingSnapshot(
  db: D1Database,
  now: Date,
  hooks?: { beforeBatch?: () => Promise<void> },
): Promise<string | null> {
  const election = await db
    .prepare("SELECT id, status_lock, opens_at, closes_at, closed_early_at, closing_snapshot_hash, closing_snapshot_at FROM elections ORDER BY id LIMIT 1")
    .first<ElectionRow>();
  if (!election) return null;

  // If already set (from previous scheduled-close read or early close), return immediately.
  if (election.closing_snapshot_hash) return election.closing_snapshot_hash;

  // Must be closed or published.
  const currentStage = stage(election, now.toISOString());
  if (currentStage !== "closed" && election.status_lock !== "published") return null;

  // Early close should have set closing_snapshot_hash inside closeEarly().
  // Only when closed_early_at IS NULL (scheduled close) does first-read finalization create the system event.
  if (election.closed_early_at !== null) {
    return election.closing_snapshot_hash ?? null;
  }

  const at = now.toISOString();
  const auditEntry: AuditEntry = {
    at,
    actor_type: "system",
    actor_member_id: null,
    actor_name: "",
    action: "Pemilihan ditutup",
    target: String(election.id),
    komsat_path: null,
    detail_json: JSON.stringify({ closing_snapshot: true }),
  };

  const tipGuard = "COALESCE((SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1), ?) = ?";

  // Bounded retry loop for concurrent scheduled close finalization.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await db
      .prepare("SELECT id, status_lock, opens_at, closes_at, closed_early_at, closing_snapshot_hash FROM elections WHERE id=?")
      .bind(election.id)
      .first<ElectionRow>();
    if (!current) return null;
    if (current.closing_snapshot_hash) return current.closing_snapshot_hash;
    if (current.closed_early_at !== null) return current.closing_snapshot_hash ?? null;
    if (stage(current, now.toISOString()) !== "closed" && current.status_lock !== "published") return null;

    const tip = await db
      .prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1")
      .first<{ hash: string }>();
    const previousHash = tip?.hash ?? AUDIT_GENESIS_HASH;
    const hash = await sha256Hex(previousHash + canonicalRow({ ...auditEntry, prev_hash: previousHash }));

    await hooks?.beforeBatch?.();

    try {
      const results = await db.batch([
        db.prepare(
          `UPDATE elections
           SET closing_snapshot_hash = ?, closing_snapshot_at = ?
           WHERE id = ?
             AND closing_snapshot_hash IS NULL
             AND closed_early_at IS NULL
             AND ${tipGuard}`,
        ).bind(hash, at, current.id, previousHash, previousHash),
        db.prepare(
          `INSERT INTO audit_log
             (at, actor_type, actor_member_id, actor_name, action, target, komsat_path, detail_json, prev_hash, hash)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           FROM elections
           WHERE id = ?
             AND closing_snapshot_hash = ?
             AND ${tipGuard}`,
        ).bind(
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
          current.id,
          hash,
          previousHash,
          previousHash,
        ),
      ]);

      if (
        (results[0]?.meta?.changes ?? 0) === 1 &&
        (results[1]?.meta?.changes ?? 0) === 1
      ) {
        return hash;
      }
    } catch {
      // If batch failed or another writer won, check below.
    }

    const winner = await readSnapshot(db, election.id);
    if (winner?.closing_snapshot_hash) {
      return winner.closing_snapshot_hash;
    }
  }

  return (await readSnapshot(db, election.id))?.closing_snapshot_hash ?? null;
}

async function consumeReceiptCheck(db: D1Database, ip: string): Promise<boolean> {
  const nowSec = Math.floor(Date.now() / 1000);
  const row = await db.prepare(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
     RETURNING count`,
  ).bind(`receipt:${ip}`, nowSec + 60, nowSec, nowSec, nowSec + 60).first<{ count: number }>();
  return (row?.count ?? 31) <= 30;
}

export async function checkReceipt(db: D1Database, receiptHash: string): Promise<{ found: boolean }> {
  const found = await db.prepare("SELECT 1 FROM ballots WHERE receipt_hash=? LIMIT 1").bind(receiptHash).first();
  return { found: !!found };
}

export interface PublicBoard {
  /** Hash kode bukti, bukan kode mentah atau pilihan kandidat (aturan keras 3). */
  receipt_hashes: string[];
  participation_count: number;
  ballot_count: number;
  closing_snapshot_hash: string | null;
  updated_at: string;
  /** Hak pilih akhir: snapshot penutupan atau angka beku (penyelesai tunggal). */
  hak_pilih: number;
  hak_pilih_source: HakPilihResolution["source"];
  /** Satu desimal, aturan yang sama dengan persentase partisipasi hasil. */
  turnout_percentage: number;
  /** Waktu penutupan: Tutup Sekarang atau jadwal closes_at. */
  closed_at: string | null;
  /** True saat Diumumkan: halaman dan API publik tidak menampilkan jumlah. */
  published: boolean;
}

export async function getPublicBoard(db: D1Database, now: Date, portal?: ServiceApiConfig): Promise<PublicBoard | null> {
  const election = await db.prepare("SELECT * FROM elections ORDER BY id LIMIT 1").first<ElectionRow>();
  if (!election || (stage(election, now.toISOString()) !== "closed" && election.status_lock !== "published")) return null;
  const snapshotHash = await ensureClosingSnapshot(db, now);
  // Mode Tidak Membekukan DPT: penetapan Hak pilih akhir ikut dibaca di sini
  // supaya tidak ada pembaca yang melihat "Ditutup tapi belum disimpan".
  const hakPilih = await resolveHakPilih(db, now, portal);
  const ballots = await db.prepare("SELECT receipt_hash FROM ballots WHERE election_id=? ORDER BY id").bind(election.id).all<{ receipt_hash: string }>();
  const participation = await db.prepare("SELECT COUNT(*) AS count FROM participation WHERE election_id=? AND is_test=0").bind(election.id).first<{ count: number }>();
  const updatedElection = await db.prepare("SELECT closing_snapshot_at FROM elections WHERE id=?").bind(election.id).first<{ closing_snapshot_at: string | null }>();
  const participationCount = participation?.count ?? 0;
  return {
    receipt_hashes: ballots.results.map((row) => row.receipt_hash),
    participation_count: participationCount,
    ballot_count: ballots.results.length,
    closing_snapshot_hash: snapshotHash,
    updated_at: updatedElection?.closing_snapshot_at ?? election.closing_snapshot_at ?? now.toISOString(),
    hak_pilih: hakPilih.hakPilih,
    hak_pilih_source: hakPilih.source,
    turnout_percentage: hakPilih.hakPilih > 0 ? Math.round((participationCount / hakPilih.hakPilih) * 1000) / 10 : 0,
    closed_at: election.closed_early_at ?? election.closes_at,
    published: election.status_lock === "published",
  };
}

export const boardRoutes = new Hono<Env>();

async function handleReceiptCheck(c: import("hono").Context<Env>) {
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!await consumeReceiptCheck(c.env.DB, ip)) return c.json({ error: "rate_limited" }, 429);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "body_tidak_valid" }, 400); }
  const receiptHash = typeof body === "object" && body !== null && "receipt_hash" in body && typeof body.receipt_hash === "string" ? body.receipt_hash : "";
  if (!/^[0-9a-f]{64}$/.test(receiptHash)) return c.json({ error: "hash_tidak_valid" }, 400);
  return c.json(await checkReceipt(c.env.DB, receiptHash));
}

async function handleBoard(c: import("hono").Context<Env>) {
  const board = await getPublicBoard(c.env.DB, new Date(), serviceApiConfig(c.env));
  if (!board) return c.json({ error: "pemilihan_belum_ditutup" }, 409);
  // Setelah Diumumkan papan publik tanpa jumlah (owner 2026-11-26); daftar hash tetap
  // ada karena itulah alat Pemilih memeriksa kode bukti.
  if (board.published) {
    const { receipt_hashes, closing_snapshot_hash, updated_at, closed_at, published } = board;
    return c.json({ receipt_hashes, closing_snapshot_hash, updated_at, closed_at, published, counts_match: board.participation_count === board.ballot_count });
  }
  return c.json(board);
}

boardRoutes.post("/votes/receipt-check", handleReceiptCheck);
boardRoutes.get("/votes/board", handleBoard);
// Also supports mounting below /votes.
boardRoutes.post("/receipt-check", handleReceiptCheck);
boardRoutes.get("/board", handleBoard);
