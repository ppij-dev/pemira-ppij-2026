import type { D1Database } from "@cloudflare/workers-types";
import { buildAuditInsert } from "../lib/audit";
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
  const audit = await buildAuditInsert(db, { at: now.toISOString(), actor_type: "system", actor_member_id: null, actor_name: "", action: "pemilih_sync", target: null, komsat_path: null, detail_json: JSON.stringify({ summary, added, removed, excluded, full: options.full === true }) });
  // as_of server dari portal, bukan klok lokal: jaminan tidak melewatkan
  // perubahan yang tertulis saat sinkronisasi berjalan (kontrak §4.3).
  upserts.push(db.prepare("INSERT INTO system_config (key,value) VALUES ('pemilih_last_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(page.asOf), audit);
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
