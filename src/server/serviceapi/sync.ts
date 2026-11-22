import type { D1Database } from "@cloudflare/workers-types";
import { buildAuditInsert } from "../lib/audit";
import { stage } from "../lib/stage";
import { ServiceApiClient, type Member, type ServiceApiConfig } from "./client";
export { ServiceApiError } from "./client";

export interface PemilihSyncResult {
  added: number;
  removed: number;
  /** Anggota ACTIVE dari portal yang belum/tidak berhak memilih (can_vote bukan true). */
  excluded: number;
  total: number;
}
export interface SyncOptions {
  /**
   * Bangun ulang roll dari pembacaan penuh portal (semua status, tanpa
   * changed_since): hanya Anggota Biasa ACTIVE yang tersisa di roll. Dipakai
   * Kunci & Jadwalkan agar roll beku tidak pernah memuat bukan pemilih.
   */
  full?: boolean;
  /**
   * Tanpa entri audit: dipakai segarkan otomatis view portal saat pemungutan
   * suara (mode Tidak Membekukan DPT) agar rantai hash tidak banjir entri
   * buku besar; sinkronisasi manual tetap tercatat.
   */
  silent?: boolean;
}
export async function assertSyncAllowed(db: D1Database): Promise<void> {
  const election = await db.prepare("SELECT status_lock FROM elections ORDER BY id LIMIT 1").first<{ status_lock: string }>();
  if (election && election.status_lock !== "draft") { const error = new Error("Sync hanya diizinkan saat pemilihan berstatus draft") as Error & { status: number }; error.status = 409; throw error; }
}

function isActiveMember(member: Member): boolean {
  return String(member.status ?? "").toUpperCase() === "ACTIVE";
}

/**
 * Hak pilih dari portal: 1 boleh, 0 tidak, null belum ditentukan. Kontraknya
 * JSON boolean (true/false/null); nilai numerik 1/0 tetap diterima agar
 * kekeliruan serialisasi tidak diam-diam mengosongkan seluruh roll.
 */
export function storedCanVote(member: Member): number | null {
  const value = member.can_vote as unknown;
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  return null;
}

/** Anggota ACTIVE yang portalnya menyatakan can_vote true. */
function isEligibleMember(member: Member): boolean {
  return isActiveMember(member) && storedCanVote(member) === 1;
}

function upsertVoter(db: D1Database, member: Member, now: Date) {
  return db.prepare("INSERT INTO voters (member_id,name,nickname,komsat_path,status,synced_at,member_number,category,can_vote) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET name=excluded.name,nickname=excluded.nickname,komsat_path=excluded.komsat_path,status=excluded.status,synced_at=excluded.synced_at,member_number=excluded.member_number,category=excluded.category,can_vote=excluded.can_vote")
    .bind(member.member_id, member.full_name, member.nickname ?? "", member.komsat_path, member.status, now.toISOString(), member.member_number ?? null, member.member_category ?? null, storedCanVote(member));
}

function upsertUnit(db: D1Database, unit: { path: string; name: string; parent_path: string; type: string }) {
  return db.prepare("INSERT INTO units (path,name,parent_path,type) VALUES (?,?,?,?) ON CONFLICT(path) DO UPDATE SET name=excluded.name,parent_path=excluded.parent_path,type=excluded.type").bind(unit.path, unit.name, unit.parent_path, unit.type);
}

export async function syncPemilih(db: D1Database, cfg: ServiceApiConfig, now: Date, fetchImpl?: typeof fetch, options: SyncOptions = {}): Promise<PemilihSyncResult> {
  // fetchImpl dari cfg (dipakai stub pengujian) menang atas parameter opsional
  // agar injeksi lewat konfigurasi tidak tertimpa default global fetch.
  const client = new ServiceApiClient({ ...cfg, ...(fetchImpl ? { fetchImpl } : {}) });
  const units = await client.getUnits();
  const lastSync = options.full ? undefined : (await db.prepare("SELECT value FROM system_config WHERE key = 'pemilih_last_sync'").first<{ value: string }>())?.value;
  const page = await client.getMembers({ changedSince: lastSync, status: options.full ? "ALL" : undefined });
  const members = page.items;
  const upserts = units.map((unit) => upsertUnit(db, unit));
  let added = 0; let removed = 0; let excluded = 0; let total: number;
  if (options.full) {
    const existing = new Set((await db.prepare("SELECT member_id FROM voters").all<{ member_id: string }>()).results.map((row) => row.member_id));
    const eligible = members.filter(isEligibleMember);
    const eligibleIds = new Set(eligible.map((member) => member.member_id));
    added = eligible.filter((member) => !existing.has(member.member_id)).length;
    removed = [...existing].filter((memberId) => !eligibleIds.has(memberId)).length;
    excluded = members.filter((member) => isActiveMember(member) && !isEligibleMember(member)).length;
    upserts.push(db.prepare("DELETE FROM voters"));
    for (const member of eligible) upserts.push(upsertVoter(db, member, now));
    total = eligible.length;
  } else {
    for (const member of members) {
      const existing = await db.prepare("SELECT 1 FROM voters WHERE member_id=?").bind(member.member_id).first();
      if (isEligibleMember(member)) {
        if (!existing) added++;
        upserts.push(upsertVoter(db, member, now));
      } else {
        if (existing) { removed++; upserts.push(db.prepare("DELETE FROM voters WHERE member_id=?").bind(member.member_id)); }
        if (isActiveMember(member)) excluded++;
      }
    }
    const totalRow = await db.prepare("SELECT COUNT(*) AS total FROM voters").first<{ total: number }>();
    total = (totalRow?.total ?? 0) + added - removed;
  }
  const summary = `+${added} baru / -${removed} keluar` + (excluded ? ` / ${excluded} tanpa hak pilih` : "");
  if (options.silent !== true) {
    const audit = await buildAuditInsert(db, { at: now.toISOString(), actor_type: "system", actor_member_id: null, actor_name: "", action: "pemilih_sync", target: null, komsat_path: null, detail_json: JSON.stringify({ summary, added, removed, excluded, full: options.full === true }) });
    upserts.push(audit);
  }
  // as_of server dari portal, bukan klok lokal: jaminan tidak melewatkan
  // perubahan yang tertulis saat sinkronisasi berjalan (kontrak §4.3).
  upserts.push(db.prepare("INSERT INTO system_config (key,value) VALUES ('pemilih_last_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(page.asOf));
  await db.batch(upserts);
  return { added, removed, excluded, total };
}

/**
 * Lengkapi nama resmi, nomor kartu, kategori tampilan dan hak pilih
 * (can_vote) untuk baris roll yang sudah ada — tanpa menambah/menghapus
 * pemilih dan tanpa mengubah status, sehingga aman dijalankan pada pemilihan
 * yang sudah dibekukan (mis. pratinjau).
 */
export async function enrichRollNames(db: D1Database, cfg: ServiceApiConfig, now: Date, fetchImpl?: typeof fetch): Promise<{ updated: number }> {
  const client = new ServiceApiClient({ ...cfg, ...(fetchImpl ? { fetchImpl } : {}) });
  // Semua status: baris roll beku bisa berisi anggota yang kini non-ACTIVE dan
  // tetap perlu kategori benar agar penolakan saat memilih tepat.
  const page = await client.getMembers({ status: "ALL" });
  const byId = new Map(page.items.map((member) => [member.member_id, member]));
  const rows = await db.prepare("SELECT member_id, name, member_number, category, can_vote FROM voters").all<{ member_id: string; name: string; member_number: string | null; category: string | null; can_vote: number | null }>();
  const updates = [];
  let updated = 0;
  for (const row of rows.results) {
    const member = byId.get(row.member_id);
    if (!member) continue;
    // Perbarui bila nama masih berupa ID anggota (belum tersedia saat
    // pendaftaran), nomor kartu portal berbeda, kategori tampilan berbeda,
    // atau hak pilih (can_vote) berbeda dari yang tersimpan.
    // Nilai portal yang eksplisit null menimpa nilai lama (belum ditentukan).
    const nameMissing = !row.name || row.name.trim() === row.member_id;
    const numberDiffers = Boolean(member.member_number) && (member.member_number !== row.member_number);
    const categoryPresent = member.member_category !== undefined;
    const categoryDiffers = categoryPresent && (member.member_category ?? null) !== row.category;
    const canVotePresent = member.can_vote !== undefined;
    const canVoteDiffers = canVotePresent && storedCanVote(member) !== row.can_vote;
    if (!nameMissing && !numberDiffers && !categoryDiffers && !canVoteDiffers) continue;
    updates.push(db.prepare("UPDATE voters SET name = ?, member_number = COALESCE(?, member_number), category = ?, can_vote = ? WHERE member_id = ?").bind(member.full_name, member.member_number ?? null, member.member_category ?? null, storedCanVote(member), row.member_id));
    updated++;
  }
  if (updates.length) {
    const audit = await buildAuditInsert(db, { at: now.toISOString(), actor_type: "system", actor_member_id: null, actor_name: "", action: "pemilih_nama_diperbarui", target: null, komsat_path: null, detail_json: JSON.stringify({ updated }) });
    await db.batch([...updates, audit]);
  }
  return { updated };
}

/** Hasil usaha segarkan view portal; stale berarti view terakhir dipakai apa adanya. */
export interface PortalViewRefresh {
  refreshed: boolean;
  failed: boolean;
  /** View lebih tua dari TTL dan tidak berhasil disegarkan pada percobaan ini. */
  stale: boolean;
  /** Di luar mode Tidak Membekukan DPT atau di luar tahap Dibuka. */
  skipped: boolean;
}

/** Umur watermark sebelum view dianggap perlu disegarkan (keputusan owner Q19x/design D3). */
export const PORTAL_VIEW_TTL_MS = 30_000;
/** Jeda minimum antar percobaan setelah kegagalan, agar latensi memilih tetap terbatas. */
export const PORTAL_VIEW_COOLDOWN_MS = 15_000;
/**
 * Batas tunggu pembacaan (strip beranda, Dasbor, hasil, halaman Pemilih) saat
 * menyegarkan: halaman publik tidak pernah menunggu portal lama; bila lewat,
 * angka terakhir tetap dilayani dan segarkan berlanjut di latar. Portal yang
 * sehat menjawab satu delta dalam ratusan milidetik, sehingga satu detik sudah
 * cukup untuk pembaruan biasa tanpa membuat pembaca menunggu satu timeout 10 s.
 */
export const PORTAL_VIEW_READ_WAIT_MS = 1_000;

// Cooldown hidup di memori isolate; Workers bisa menjalankan beberapa isolate,
// jadi sesekali dua isolate menyegarkan bersamaan — UPSERT idempoten terhadap
// watermark yang sama, jadi hasilnya konsisten, hanya sedikit boros.
let lastPortalViewFailureAt = 0;
// Satu segarkan berjalan per isolate: pembaca serentak berbagi percobaan yang
// sama, bukan menumpuk permintaan portal (tetap idempoten bila tetap ganda).
let portalViewRefreshInFlight: Promise<PortalViewRefresh> | null = null;

async function runPortalViewRefresh(
  db: D1Database,
  cfg: ServiceApiConfig,
  now: Date,
  hadWatermark: boolean,
  failedAtMs: number,
  fetchImpl?: typeof fetch,
): Promise<PortalViewRefresh> {
  try {
    // Tanpa watermark: bangun ulang penuh (silent) supaya view mulai lengkap;
    // dengan watermark: delta changed_since sejak as_of portal terakhir.
    await syncPemilih(db, cfg, now, fetchImpl, hadWatermark ? { silent: true } : { silent: true, full: true });
    lastPortalViewFailureAt = 0;
    return { refreshed: true, failed: false, stale: false, skipped: false };
  } catch {
    lastPortalViewFailureAt = failedAtMs;
    return { refreshed: false, failed: true, stale: true, skipped: false };
  }
}

export interface PortalViewRefreshOptions {
  /**
   * Batas tunggu maksimal (ms) untuk pembacaan halaman: bila segarkan belum
   * selesai, view terakhir tetap dipakai dan segarkan berlanjut di latar.
   * Tanpa opsi ini (jalur memilih) menunggu sampai selesai seperti semula.
   */
  maxWaitMs?: number;
}

/** Binding Service API pada situs (variabel dan rahasia Wrangler). */
export interface ServiceApiEnv {
  ONELOGIN_ISSUER?: string;
  SERVICE_API_CLIENT_ID?: string;
  SERVICE_API_CLIENT_SECRET?: string;
  SERVICE_API_URL?: string;
}

/**
 * Konfigurasi klien Service API dari binding situs. Tanpa `SERVICE_API_URL`
 * tidak ada percobaan sama sekali: pembacaan tetap dilayani dari view terakhir.
 */
export function serviceApiConfig(env: ServiceApiEnv | undefined): ServiceApiConfig | undefined {
  if (!env?.SERVICE_API_URL) return undefined;
  return { issuer: env.ONELOGIN_ISSUER ?? "", clientId: env.SERVICE_API_CLIENT_ID ?? "", clientSecret: env.SERVICE_API_CLIENT_SECRET ?? "", serviceApiUrl: env.SERVICE_API_URL };
}

/** Opsi segarkan untuk pembaca halaman: batas tunggu pendek, sisanya jalur yang sama. */
const READ_REFRESH_OPTIONS: PortalViewRefreshOptions = { maxWaitMs: PORTAL_VIEW_READ_WAIT_MS };

/**
 * SATU jalur segarkan untuk semua pembaca yang menampilkan Hak pilih: endpoint
 * publik /api/turnout, strip beranda, Dasbor, hasil dan halaman Pemilih. Aturan
 * penyegaran (TTL 30 detik, cooldown gagal 15 detik, stale-while-unavailable)
 * sama persis dengan jalur memilih; bedanya pembaca hanya menunggu paling lama
 * PORTAL_VIEW_READ_WAIT_MS lalu dilayani dari view terakhir, sehingga tidak ada
 * halaman yang tertahan menunggu portal. Tidak pernah melempar, termasuk saat
 * kueri penjaga D1 gagal sesaat.
 */
export async function refreshPortalViewForRead(db: D1Database, cfg: ServiceApiConfig | undefined, now: Date): Promise<PortalViewRefresh> {
  if (!cfg) return { refreshed: false, failed: false, stale: false, skipped: true };
  return ensurePortalViewFresh(db, cfg, now, undefined, READ_REFRESH_OPTIONS);
}

/**
 * Segarkan view portal (tabel voters) secara lazy saat pemungutan suara
 * berjalan dalam mode "Tidak Membekukan DPT" (keputusan owner 2026-11-19):
 * incremental changed_since dari watermark portal (as_of, bukan klok lokal)
 * bila view lebih tua dari TTL; tanpa watermark, bangun ulang penuh. Portal
 * tidak tersedia berarti view terakhir tetap dipakai (stale-while-unavailable)
 * dan percobaan berulang ditekan cooldown 15 detik. Tidak pernah melempar:
 * pemilih tetap dilayani dari view terakhir. Tanpa entri audit (silent).
 * Dipakai jalur memilih lewat `ensurePortalViewFresh` langsung (menunggu sampai
 * selesai) dan semua pembacaan Hak pilih lewat `refreshPortalViewForRead`
 * (batas tunggu pendek) supaya angka yang tampil selalu dari view yang sama.
 * Tahap Terjadwal ikut disegarkan supaya angka sudah hidup sebelum dibuka;
 * Draf dan Mode Pratinjau tidak pernah menyegarkan. Jaminan "tidak pernah
 * melempar" meliputi kueri penjaga di awal: saat D1 sibuk (lonjakan pembukaan
 * pemungutan suara) kueri sesaat ini bisa gagal sesaat, dan pemilih tetap
 * dilayani dari view terakhir, bukan galat 500.
 */
export async function ensurePortalViewFresh(
  db: D1Database,
  cfg: ServiceApiConfig,
  now: Date,
  fetchImpl?: typeof fetch,
  options?: PortalViewRefreshOptions,
): Promise<PortalViewRefresh> {
  const nowMs = now.getTime();
  try {
    const idle: PortalViewRefresh = { refreshed: false, failed: false, stale: false, skipped: true };
    const election = await db
      .prepare("SELECT status_lock, opens_at, closes_at, closed_early_at, live_voter_roll, preview_mode FROM elections ORDER BY id LIMIT 1")
      .first<{ status_lock: string; opens_at: string | null; closes_at: string | null; closed_early_at: string | null; live_voter_roll: number; preview_mode: number }>();
    if (!election || election.live_voter_roll !== 1) return idle;
    // Mode Pratinjau selalu menang (design D3): pemilihan pratinjau tetap berlatih
    // dengan baris yang didaftarkan otomatis, jadi view portal tidak pernah
    // disegarkan dan tidak pernah tercampur data asli. Saklar yang tertinggal
    // menyala tidak mengubah perilaku pratinjau sedikit pun.
    if (election.preview_mode === 1) return idle;
    const currentStage = stage(election as never, now.toISOString());
    if (currentStage !== "open" && currentStage !== "scheduled") return idle;

    const watermark = (await db.prepare("SELECT value FROM system_config WHERE key = 'pemilih_last_sync'").first<{ value: string }>())?.value;
    const watermarkAt = watermark ? Date.parse(watermark) : NaN;
    const fresh = Number.isFinite(watermarkAt) && nowMs - watermarkAt < PORTAL_VIEW_TTL_MS;
    if (fresh) return { refreshed: false, failed: false, stale: false, skipped: false };

    if (nowMs - lastPortalViewFailureAt < PORTAL_VIEW_COOLDOWN_MS) {
      return { refreshed: false, failed: false, stale: true, skipped: false };
    }

    if (!portalViewRefreshInFlight) {
      portalViewRefreshInFlight = runPortalViewRefresh(db, cfg, now, Number.isFinite(watermarkAt), nowMs, fetchImpl).finally(() => {
        portalViewRefreshInFlight = null;
      });
    }
    const attempt = portalViewRefreshInFlight;
    if (!options?.maxWaitMs) return attempt;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      attempt.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), options.maxWaitMs);
      }),
    ]);
    clearTimeout(timer);
    // Lewat batas tunggu: halaman dilayani dari view terakhir (usang apa adanya);
    // segarkan di latar berlanjut dan pembaca berikutnya mendapat view barunya.
    return timedOut ? { refreshed: false, failed: false, stale: true, skipped: false } : attempt;
  } catch {
    // Kueri penjaga (baris pemilihan, watermark) bisa gagal sesaat saat D1 sibuk.
    // Kontraknya tetap: tidak pernah melempar — view terakhir dilayani apa adanya
    // dan jeda cooldown menahan percobaan berikutnya.
    lastPortalViewFailureAt = nowMs;
    return { refreshed: false, failed: true, stale: true, skipped: false };
  }
}
