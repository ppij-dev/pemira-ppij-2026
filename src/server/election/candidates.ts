import type { D1Database } from "@cloudflare/workers-types";
import { buildAuditInsert } from "../lib/audit";
import { isSingleCandidateMode } from "./mode";

export class ElectionError extends Error {
  constructor(message: string, public readonly status = 409, public readonly checks?: ReadinessCheck[]) { super(message); this.name = "ElectionError"; }
}
export interface ReadinessCheck { key: string; ok: boolean; message: string }
async function draft(db: D1Database) {
  const row = await db.prepare("SELECT status_lock FROM elections ORDER BY id LIMIT 1").first<{status_lock:string}>();
  if (!row || row.status_lock !== "draft") throw new ElectionError("Perubahan hanya diizinkan saat Draf");
}
async function audit(db:D1Database, now:Date, action:string, target:string|null, detail:string|null=null) {
  return buildAuditInsert(db,{at:now.toISOString(),actor_type:"admin",actor_member_id:null,actor_name:"",action,target,komsat_path:null,detail_json:detail});
}
function validateShortIntro(value: unknown): string {
  if (typeof value !== "string") throw new ElectionError("Intro singkat harus berupa teks. Tulis maksimal 100 karakter.", 400);
  const intro = value.trim().replace(/\s+/g, " ");
  if (Array.from(intro).length > 100) throw new ElectionError("Intro singkat terlalu panjang. Ringkas menjadi maksimal 100 karakter.", 400);
  return intro;
}
export const NAME_MAX_CHARS = 60;
export const NICKNAME_MAX_CHARS = 24;
function validateName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (Array.from(name).length > NAME_MAX_CHARS) throw new ElectionError(`Nama terlalu panjang. Ringkas menjadi maksimal ${NAME_MAX_CHARS} karakter.`, 400);
  return name;
}
function validateNickname(value: string): string {
  const nickname = value.trim().replace(/\s+/g, " ");
  if (Array.from(nickname).length > NICKNAME_MAX_CHARS) throw new ElectionError(`Nama panggilan terlalu panjang. Ringkas menjadi maksimal ${NICKNAME_MAX_CHARS} karakter.`, 400);
  return nickname;
}
/** Pesan saat referensi bukan nomor kartu yang sah untuk mode berjalan. */const CARD_ONLY_MESSAGE = "Gunakan nomor kartu anggota dari portal. ID internal hanya berlaku di Mode Pratinjau, dan hanya untuk anggota yang belum punya nomor kartu.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLL_SELECT = "SELECT member_id,name,komsat_path,member_number FROM voters WHERE ";

async function isPreviewMode(db: D1Database): Promise<boolean> {
  const election = await db.prepare("SELECT preview_mode FROM elections ORDER BY id LIMIT 1").first<{ preview_mode: number }>();
  return election?.preview_mode === 1;
}

/**
 * Cari baris roll untuk kandidat. Di luar Mode Pratinjau hanya nomor kartu
 * portal (OKA-2026-0001) yang diterima; di Mode Pratinjau, member_id juga
 * boleh asalkan baris itu memang belum punya nomor kartu. Referensi member_id
 * yang ditolak selalu memberi pesan yang sama, tanpa membocorkan apakah
 * anggotanya ada di roll.
 */
async function resolveRollMember(db: D1Database, reference: string) {
  const byCard = await db.prepare(`${ROLL_SELECT}member_number = ?`).bind(reference).first<{member_id:string;name:string;komsat_path:string;member_number:string|null}>();
  if (byCard) return byCard;
  if (!UUID.test(reference)) return null;
  if (!(await isPreviewMode(db))) throw new ElectionError(CARD_ONLY_MESSAGE, 409);
  const byId = await db.prepare(`${ROLL_SELECT}member_id = ?`).bind(reference).first<{member_id:string;name:string;komsat_path:string;member_number:string|null}>();
  if (!byId) return null;
  if (byId.member_number) throw new ElectionError(CARD_ONLY_MESSAGE, 409);
  return byId;
}

/** Baris roll pemilik kandidat (dipakai saat permintaan tidak mengirim referensi baru). */
async function rollMemberById(db: D1Database, memberId: string) {
  return db.prepare(`${ROLL_SELECT}member_id = ?`).bind(memberId).first<{member_id:string;name:string;komsat_path:string;member_number:string|null}>();
}

export async function listCandidates(db:D1Database) { return (await db.prepare("SELECT c.id,c.member_id,c.number,c.name,c.nickname,c.komsat_path,c.description,c.short_intro,c.color,v.member_number FROM candidates c LEFT JOIN voters v ON v.member_id=c.member_id ORDER BY c.number").all()).results; }
export async function createCandidate(db:D1Database, now:Date, input:{member_id:string;number:number;name:string;nickname:string;description:string;short_intro?:string}) {
  await draft(db);
  const name = validateName(input.name);
  const nickname = validateNickname(input.nickname);
  const shortIntro = validateShortIntro(input.short_intro === undefined ? "" : input.short_intro);
  // Mode kandidat tunggal: hanya satu kandidat, tanpa nomor urut dari form.
  const single = await isSingleCandidateMode(db);
  if (single && ((await db.prepare("SELECT COUNT(*) AS n FROM candidates").first<{ n: number }>())?.n ?? 0) >= 1) {
    throw new ElectionError("Mode kandidat tunggal aktif: hanya satu kandidat yang dapat didaftarkan.", 409);
  }
  const voter=await resolveRollMember(db,input.member_id);
  if(!voter) throw new ElectionError("Anggota tidak ada di daftar Pemilih. Pakai nomor kartu anggota dari portal (jalankan 'Perbarui Nama & Kategori dari Portal' bila belum ada).",409);
  const memberId=voter.member_id;
  if(await db.prepare("SELECT 1 FROM admin_voting WHERE member_id=?").bind(memberId).first()) throw new ElectionError("Admin Voting tidak dapat menjadi kandidat",409);
  // Nomor urut internal saat mode kandidat tunggal selalu 1 dan tidak pernah
  // dirender; ia hanya memenuhi NOT NULL UNIQUE CHECK (number > 0).
  const number = single ? 1 : input.number;
  if(!single && (!Number.isInteger(input.number)||input.number<=0)) throw new ElectionError("Nomor urut harus bilangan positif",400);
  const idRow=await db.prepare("SELECT COALESCE(MAX(id),0)+1 AS id FROM candidates").first<{id:number}>(); const id=idRow!.id;
  try { await db.batch([db.prepare("INSERT INTO candidates (id,member_id,number,name,nickname,komsat_path,description,short_intro) VALUES (?,?,?,?,?,?,?,?)").bind(id,memberId,number,name,nickname,voter.komsat_path,input.description,shortIntro),await audit(db,now,"Kandidat ditambahkan",String(id))]); }
  catch(e) { if(String(e).includes("UNIQUE")||String(e).includes("constraint")) throw new ElectionError("Nomor urut/Nickname sudah dipakai"); throw e; }
  return db.prepare("SELECT id,member_id,number,name,nickname,komsat_path,description,short_intro FROM candidates WHERE id=?").bind(id).first();
}
export async function updateCandidate(db:D1Database,now:Date,id:number,input:{member_id?:string;number:number;name:string;nickname:string;description:string;short_intro?:string}) {
  await draft(db); const old=await db.prepare("SELECT member_id,short_intro,number FROM candidates WHERE id=?").bind(id).first<{member_id:string;short_intro:string;number:number}>(); if(!old) throw new ElectionError("Kandidat tidak ditemukan",404);
  const name = validateName(input.name);
  const nickname = validateNickname(input.nickname);
  const shortIntro = input.short_intro === undefined ? old.short_intro : validateShortIntro(input.short_intro);
  // Tanpa referensi baru (form mengirim kosong), kandidat tetap memakai
  // anggota yang sudah tercatat — tidak perlu nomor kartu.
  const reference=input.member_id?.trim();
  const voter=reference?await resolveRollMember(db,reference):await rollMemberById(db,old.member_id);
  if(!voter) throw new ElectionError("Anggota tidak ada di daftar Pemilih. Pakai nomor kartu anggota dari portal (jalankan 'Perbarui Nama & Kategori dari Portal' bila belum ada).",409);
  const resolvedId=voter.member_id;
  if(await db.prepare("SELECT 1 FROM admin_voting WHERE member_id=?").bind(resolvedId).first()) throw new ElectionError("Admin Voting tidak dapat menjadi kandidat",409);
  // Mode kandidat tunggal tidak pernah menulis ulang nomor urut tersimpan.
  const single = await isSingleCandidateMode(db);
  const number = single ? old.number : input.number;
  if(!single && (!Number.isInteger(input.number)||input.number<=0)) throw new ElectionError("Nomor urut harus bilangan positif",400);
  try { await db.batch([db.prepare("UPDATE candidates SET member_id=?,number=?,name=?,nickname=?,komsat_path=?,description=?,short_intro=? WHERE id=?").bind(resolvedId,number,name,nickname,voter.komsat_path,input.description,shortIntro,id),await audit(db,now,"Kandidat diperbarui",String(id))]); }
  catch(e) { if(String(e).includes("UNIQUE")||String(e).includes("constraint")) throw new ElectionError("Nomor urut/Nickname sudah dipakai"); throw e; }
  return db.prepare("SELECT id,member_id,number,name,nickname,komsat_path,description,short_intro FROM candidates WHERE id=?").bind(id).first();
}
export async function deleteCandidate(db:D1Database,now:Date,id:number) {
  await draft(db);
  const result=await db.batch([db.prepare("DELETE FROM candidates WHERE id=?").bind(id),await audit(db,now,"Kandidat dihapus",String(id))]);
  if(!result[0]?.meta.changes) throw new ElectionError("Kandidat tidak ditemukan",404);
}
