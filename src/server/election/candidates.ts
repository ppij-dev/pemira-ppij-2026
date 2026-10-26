import type { D1Database } from "@cloudflare/workers-types";
import { buildAuditInsert } from "../lib/audit";

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
export async function listCandidates(db:D1Database) { return (await db.prepare("SELECT id,member_id,number,name,nickname,komsat_path,description,short_intro,color FROM candidates ORDER BY number").all()).results; }
export async function createCandidate(db:D1Database, now:Date, input:{member_id:string;number:number;name:string;nickname:string;description:string;short_intro?:string}) {
  await draft(db);
  const name = validateName(input.name);
  const nickname = validateNickname(input.nickname);
  const shortIntro = validateShortIntro(input.short_intro === undefined ? "" : input.short_intro);
  const voter=await db.prepare("SELECT name,komsat_path FROM voters WHERE member_id=?").bind(input.member_id).first<{name:string;komsat_path:string}>();
  if(!voter) throw new ElectionError("Anggota tidak ada di daftar Pemilih",409);
  if(await db.prepare("SELECT 1 FROM admin_voting WHERE member_id=?").bind(input.member_id).first()) throw new ElectionError("Admin Voting tidak dapat menjadi kandidat",409);
  if(!Number.isInteger(input.number)||input.number<=0) throw new ElectionError("Nomor urut harus bilangan positif",400);
  const idRow=await db.prepare("SELECT COALESCE(MAX(id),0)+1 AS id FROM candidates").first<{id:number}>(); const id=idRow!.id;
  try { await db.batch([db.prepare("INSERT INTO candidates (id,member_id,number,name,nickname,komsat_path,description,short_intro) VALUES (?,?,?,?,?,?,?,?)").bind(id,input.member_id,input.number,name,nickname,voter.komsat_path,input.description,shortIntro),await audit(db,now,"Kandidat ditambahkan",String(id))]); }
  catch(e) { if(String(e).includes("UNIQUE")||String(e).includes("constraint")) throw new ElectionError("Nomor urut/Nickname sudah dipakai"); throw e; }
  return db.prepare("SELECT id,member_id,number,name,nickname,komsat_path,description,short_intro FROM candidates WHERE id=?").bind(id).first();
}
export async function updateCandidate(db:D1Database,now:Date,id:number,input:{member_id?:string;number:number;name:string;nickname:string;description:string;short_intro?:string}) {
  await draft(db); const old=await db.prepare("SELECT member_id,short_intro FROM candidates WHERE id=?").bind(id).first<{member_id:string;short_intro:string}>(); if(!old) throw new ElectionError("Kandidat tidak ditemukan",404);
  const name = validateName(input.name);
  const nickname = validateNickname(input.nickname);
  const shortIntro = input.short_intro === undefined ? old.short_intro : validateShortIntro(input.short_intro);
  const memberId=input.member_id??old.member_id; const voter=await db.prepare("SELECT komsat_path FROM voters WHERE member_id=?").bind(memberId).first<{komsat_path:string}>(); if(!voter) throw new ElectionError("Anggota tidak ada di daftar Pemilih",409);
  if(await db.prepare("SELECT 1 FROM admin_voting WHERE member_id=?").bind(memberId).first()) throw new ElectionError("Admin Voting tidak dapat menjadi kandidat",409);
  if(!Number.isInteger(input.number)||input.number<=0) throw new ElectionError("Nomor urut harus bilangan positif",400);
  try { await db.batch([db.prepare("UPDATE candidates SET member_id=?,number=?,name=?,nickname=?,komsat_path=?,description=?,short_intro=? WHERE id=?").bind(memberId,input.number,name,nickname,voter.komsat_path,input.description,shortIntro,id),await audit(db,now,"Kandidat diperbarui",String(id))]); }
  catch(e) { if(String(e).includes("UNIQUE")||String(e).includes("constraint")) throw new ElectionError("Nomor urut/Nickname sudah dipakai"); throw e; }
  return db.prepare("SELECT id,member_id,number,name,nickname,komsat_path,description,short_intro FROM candidates WHERE id=?").bind(id).first();
}
export async function deleteCandidate(db:D1Database,now:Date,id:number) {
  await draft(db);
  const result=await db.batch([db.prepare("DELETE FROM candidates WHERE id=?").bind(id),await audit(db,now,"Kandidat dihapus",String(id))]);
  if(!result[0]?.meta.changes) throw new ElectionError("Kandidat tidak ditemukan",404);
}
