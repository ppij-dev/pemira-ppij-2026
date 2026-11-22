import type { D1Database } from "@cloudflare/workers-types";
import { AUDIT_GENESIS_HASH, buildAuditInsert, buildGuardedAuditInsert, canonicalRow, sha256Hex } from "../lib/audit";
import { stage, type ElectionStatusLock, type Stage } from "../lib/stage";
import { syncPemilih } from "../serviceapi/sync";
import type { ServiceApiConfig } from "../serviceapi/client";
import { ElectionError, type ReadinessCheck } from "./candidates";
import { directInviteTerm, liveHakPilih } from "./hakPilih";
import { resolveHakPilih } from "../voting/board";
import { isVoteChoice, type VoteChoice } from "../voting/choice";
import { fromJstInputValue } from "../../lib/scheduleInput";
const palette=['#B91C1C','#1D4ED8','#15803D','#C2410C','#7E22CE','#BE185D','#0F766E','#4338CA','#92400E','#155E75'];
async function audit(db:D1Database,now:Date,action:string,target:string|null,detail:string|null=null,actor?:AdminActor) { return buildAuditInsert(db,{at:now.toISOString(),actor_type:"admin",actor_member_id:actor?.member_id??null,actor_name:actor?.name??"",action,target,komsat_path:null,detail_json:detail}); }
/** Admin Voting yang memicu tindakan; dipakai entri audit yang mencatat pelakunya. */
export interface AdminActor { member_id: string; name: string }
export async function getReadiness(db:D1Database,now:Date):Promise<ReadinessCheck[]> {
 const e=await db.prepare("SELECT * FROM elections ORDER BY id LIMIT 1").first<{opens_at:string|null;closes_at:string|null;preview_mode:number;single_candidate_mode:number}>();
 const candidates=await db.prepare("SELECT COUNT(*) AS n FROM candidates").first<{n:number}>();
 const duplicate=await db.prepare("SELECT nickname FROM candidates GROUP BY nickname COLLATE NOCASE HAVING COUNT(*)>1 LIMIT 1").first();
 const sync=await db.prepare("SELECT value FROM system_config WHERE key='pemilih_last_sync'").first(); const voters=await db.prepare("SELECT COUNT(*) AS n FROM voters").first<{n:number}>();
 const adminCandidate=await db.prepare("SELECT 1 FROM candidates c JOIN admin_voting a ON a.member_id=c.member_id LIMIT 1").first();
 const time= e?.opens_at ? Date.parse(e.opens_at) : NaN;
 const preview= e?.preview_mode===1;
 // Mode kandidat tunggal mengganti aturan jumlah kandidat: tepat satu, bukan 2-10.
 const single= e?.single_candidate_mode===1;
 const candidateTotal= candidates?.n??0;
 return [
  {key:"schedule",ok:!!e?.opens_at&&!!e.closes_at&&Date.parse(e.closes_at)>time,message:"Jadwal harus diatur dengan waktu yang valid"},
  {key:"opens_future",ok:Number.isFinite(time)&&(preview?true:time>now.getTime()),message:preview?"Mode pratinjau: pemilihan dapat dibuka sekarang":"Waktu mulai harus di masa depan"},
  {key:"candidate_count",ok:single?candidateTotal===1:candidateTotal>=2&&candidateTotal<=10,message:single?"Mode kandidat tunggal: harus tepat 1 kandidat":(candidateTotal<2?"Minimal 2 kandidat":"Maksimal 10 kandidat")},
  {key:"nicknames",ok:!duplicate,message:"Nickname kandidat harus unik"},
  {key:"roll_synced",ok:preview|| (!!sync&&(voters?.n??0)>0),message:preview?"Mode pratinjau: pemilih terdaftar otomatis saat masuk":"Daftar Pemilih belum disinkronkan"},
  {key:"admin_candidate",ok:!adminCandidate,message:"Admin Voting tidak dapat menjadi kandidat"},
 ];
}
/** Jumlah suara tersimpan (bukan Uji Coba) pada pemilihan; data uji dibuang Kunci berikutnya. */
async function keptVoteBallots(db:D1Database){ return (await db.prepare("SELECT COUNT(*) AS n FROM ballots WHERE is_test=0").first<{n:number}>())?.n??0; }
const keptBallotsMessage=(n:number)=>`Mode kandidat tunggal tidak dapat diubah: ${n} suara tersimpan harus tetap dihitung dengan aturan yang sama.`;
/**
 * Saklar mode kandidat tunggal untuk halaman Pengaturan: nilainya hanya dapat
 * diubah saat Draf, dan tetap beku selama suara tersimpan ada karena makna surat
 * suara ditentukan saat dicoblos (design.md D5).
 */
export async function getSingleCandidateMode(db:D1Database):Promise<{enabled:boolean;editable:boolean;kept_ballots:number;reason:string|null}> {
 const row=await db.prepare("SELECT status_lock,single_candidate_mode FROM elections ORDER BY id LIMIT 1").first<{status_lock:string;single_candidate_mode:number}>();
 const kept=await keptVoteBallots(db);
 const draft=row?.status_lock==="draft";
 return {enabled:row?.single_candidate_mode===1,editable:draft&&kept===0,kept_ballots:kept,reason:kept>0?keptBallotsMessage(kept):draft?null:"Nilai ini dibekukan setelah Kunci & Jadwalkan."};
}
/**
 * Ubah mode kandidat tunggal (Draf saja). Mengaktifkan ditolak selama dua
 * kandidat atau lebih terdaftar, karena Kunci & Jadwalkan menuntut tepat satu.
 * Setiap perubahan diterima dicatat di audit (tanpa rujukan anggota/surat suara).
 */
export async function setSingleCandidateMode(db:D1Database,now:Date,enabled:boolean,actor?:AdminActor) {
 if(typeof enabled!=="boolean") throw new ElectionError("Nilai mode kandidat tunggal tidak valid",400);
 const row=await db.prepare("SELECT status_lock FROM elections ORDER BY id LIMIT 1").first<{status_lock:string}>();
 if(!row) throw new ElectionError("Pemilihan belum dibuat",404);
 if(row.status_lock!=="draft") throw new ElectionError("Mode kandidat tunggal hanya dapat diubah saat Draf",409);
 // Kedua arah ditolak selama suara tersimpan ada: surat suara tidak dapat ditulis
 // ulang ke bentuk lain tanpa memautkannya ke pemilih (design.md D5).
 const kept=await keptVoteBallots(db);
 if(kept>0) throw new ElectionError(keptBallotsMessage(kept),409);
 if(enabled) {
  const total=(await db.prepare("SELECT COUNT(*) AS n FROM candidates").first<{n:number}>())?.n??0;
  if(total>=2) throw new ElectionError(`Mode kandidat tunggal tidak dapat diaktifkan: saat ini terdaftar ${total} kandidat. Sisakan 0 atau 1 kandidat terlebih dahulu.`,409);
 }
 await db.batch([
  db.prepare("UPDATE elections SET single_candidate_mode=? WHERE status_lock='draft'").bind(enabled?1:0),
  await audit(db,now,enabled?"Mode kandidat tunggal diaktifkan":"Mode kandidat tunggal dinonaktifkan",null,JSON.stringify({single_candidate_mode:enabled}),actor),
 ]);
 return {enabled};
}
/**
 * Saklar "Tidak Membekukan DPT" (keputusan owner 2026-11-19): saat menyala, roll
 * mengikuti portal selama pemungutan suara dan Hak pilih ditetapkan saat
 * penutupan; surat suara tak terpengaruh, jadi tidak ada syarat suara tersimpan
 * di sini. Saat Draf saklar bebas diubah (dibekukan nilainya oleh Kunci &
 * Jadwalkan). Selama pemilihan terkunci dan sedang berjalan (Terjadwal atau
 * Dibuka) saklar yang menyala dapat dimatikan untuk membekukan DPT sekarang
 * (keputusan owner 2026-11-22): satu arah, tidak ada pembukaan kembali.
 */
export interface LiveVoterRollState {
 /** Posisi saklar: bernilai true selama roll mengikuti portal. */
 enabled:boolean;
 /** Hanya Draf; menyalakan kembali hanya mungkin di Draf. */
 editable:boolean;
 /** Terkunci, Terjadwal/Dibuka, saklar menyala: mematikan saklar = bekukan DPT sekarang. */
 can_freeze:boolean;
 stage:Stage|null;
 /** Waktu DPT dibekukan (Kunci & Jadwalkan atau Bekukan DPT sekarang). */
 frozen_at:string|null;
 frozen_hak_pilih:number|null;
 /** Hak pilih saat ini: angka yang disebut dialog pembekuan. */
 hak_pilih:number;
 reason:string|null;
 /** Kalimat bantuan saat saklar dapat dimatikan untuk membekukan DPT. */
 freeze_hint:string|null;
}
interface LiveVoterRollRow {status_lock:string;opens_at:string|null;closes_at:string|null;closed_early_at:string|null;live_voter_roll:number;preview_mode:number;frozen_at:string|null;frozen_hak_pilih:number|null}
export const FREEZE_HINT="Pemilihan sedang berjalan dengan daftar Pemilih yang mengikuti portal. Matikan saklar ini untuk membekukan DPT sekarang.";
export async function getLiveVoterRollMode(db:D1Database,now:Date=new Date(),portal?:ServiceApiConfig):Promise<LiveVoterRollState> {
 const row=await db.prepare("SELECT status_lock,opens_at,closes_at,closed_early_at,live_voter_roll,preview_mode,frozen_at,frozen_hak_pilih FROM elections ORDER BY id LIMIT 1").first<LiveVoterRollRow>();
 const enabled=row?.live_voter_roll===1;
 const draft=row?.status_lock==="draft";
 const st=row&&row.opens_at&&row.closes_at?stage({status_lock:row.status_lock as ElectionStatusLock,opens_at:row.opens_at,closes_at:row.closes_at,closed_early_at:row.closed_early_at},now.toISOString()):null;
 const running=st==="scheduled"||st==="open";
 const canFreeze=Boolean(row&&!draft&&row.status_lock!=="published"&&running&&enabled&&row.preview_mode!==1&&row.frozen_at==null);
 const frozenAt=row?.frozen_at??null;
 const reason=draft?null
  :canFreeze?null
  :row?.preview_mode===1?"Mode Pratinjau: daftar Pemilih tidak dibekukan."
  :enabled?"Pemungutan suara sudah ditutup; daftar Pemilih tidak dapat dibekukan lagi."
  :frozenAt!=null?"Daftar Pemilih sudah dibekukan dan tidak dapat dibuka kembali; saklar hanya dapat diaktifkan lagi dari Draf."
  :"Daftar Pemilih dibekukan saat Kunci & Jadwalkan; saklar hanya dapat diaktifkan lagi dari Draf.";
 const hakPilih=row?(await resolveHakPilih(db,now,portal)).hakPilih:0;
 return {enabled,editable:draft,can_freeze:canFreeze,stage:st,frozen_at:frozenAt,frozen_hak_pilih:row?.frozen_hak_pilih??null,hak_pilih:hakPilih,reason,freeze_hint:canFreeze?FREEZE_HINT:null};
}
/**
 * Bekukan DPT sekarang (keputusan owner 2026-11-22), dipicu dengan mematikan
 * saklar "Tidak Membekukan DPT" saat pemilihan terkunci dan sedang berjalan.
 * Satu segarkan final portal lewat jalur yang sama dengan Kunci & Jadwalkan
 * (sync penuh); bila portal gagal tindakan ditolak dengan galat jelas dan tidak
 * ada yang dibekukan dari data usang. Lalu satu D1 batch bergerbang menulis
 * frozen_at, frozen_hak_pilih dan live_voter_roll=0 persis seperti pembekuan
 * Kunci, dengan entri audit yang menyebut angka dan waktunya. Satu arah: tidak
 * ada pembukaan kembali, dan roll beku tidak pernah disegarkan dari portal lagi.
 */
export interface FreezeVoterRollResult {frozen_hak_pilih:number;frozen_at:string;hak_pilih:number}
async function freezeVoterRollInternal(db:D1Database,cfg:ServiceApiConfig|undefined,now:Date,fetchImpl?:typeof fetch,actor?:AdminActor):Promise<FreezeVoterRollResult> {
 const row=await db.prepare("SELECT id,status_lock,opens_at,closes_at,closed_early_at,allow_admin_voting,preview_mode,live_voter_roll,frozen_at FROM elections ORDER BY id LIMIT 1").first<{id:number;status_lock:string;opens_at:string|null;closes_at:string|null;closed_early_at:string|null;allow_admin_voting:number;preview_mode:number;live_voter_roll:number;frozen_at:string|null}>();
 if(!row) throw new ElectionError("Pemilihan belum dibuat",404);
 if(row.status_lock==="draft") throw new ElectionError("Daftar Pemilih baru dapat dibekukan setelah pemilihan dikunci.",409);
 if(row.status_lock==="published") throw new ElectionError("Hasil sudah diumumkan; daftar Pemilih tidak dapat dibekukan lagi.",409);
 if(row.live_voter_roll!==1) throw new ElectionError("Daftar Pemilih sudah dibekukan dan tidak dapat dibekukan dua kali.",409);
 if(row.frozen_at!==null) throw new ElectionError("Daftar Pemilih sudah dibekukan.",409);
 if(row.preview_mode===1) throw new ElectionError("Mode Pratinjau: daftar Pemilih tidak dibekukan.",409);
 if(!row.opens_at||!row.closes_at) throw new ElectionError("Jadwal pemilihan belum lengkap",409);
 const st=stage({status_lock:row.status_lock as ElectionStatusLock,opens_at:row.opens_at,closes_at:row.closes_at,closed_early_at:row.closed_early_at},now.toISOString());
 if(st!=="scheduled"&&st!=="open") throw new ElectionError("Daftar Pemilih tidak dapat dibekukan setelah pemungutan suara ditutup.",409);
 // Segarkan final portal: jalur yang sama dengan Kunci & Jadwalkan. Gagal berarti
 // tindakan ditolak; DPT tidak pernah dibekukan dari view yang usang.
 if(!cfg?.serviceApiUrl) throw new ElectionError("Sinkronisasi final gagal: Service API belum dikonfigurasi sehingga daftar Pemilih tidak dapat dipastikan terbaru.",503);
 try { await syncPemilih(db,cfg,now,fetchImpl,{full:true}); }
 catch(error) { throw new ElectionError(`Sinkronisasi final gagal: ${error instanceof Error?error.message:String(error)}`,503); }
 // Angka beku dihitung dengan rumus yang sama persis dengan Kunci: baris roll
 // yang boleh memilih, dikurangi Admin Voting saat mereka tidak ikut memilih.
 const count=(await db.prepare("SELECT COUNT(*) AS n FROM voters WHERE can_vote = 1").first<{n:number}>())?.n??0;
 const admins=(await db.prepare("SELECT COUNT(*) AS n FROM voters v JOIN admin_voting a ON a.member_id=v.member_id WHERE v.can_vote = 1").first<{n:number}>())?.n??0;
 const frozen=count-(row.allow_admin_voting===0?admins:0);
 const at=now.toISOString();
 const auditEntry=await buildGuardedAuditInsert(db,{at,actor_type:"admin",actor_member_id:actor?.member_id??null,actor_name:actor?.name??"",action:"DPT dibekukan",target:String(row.id),komsat_path:null,detail_json:JSON.stringify({frozen_hak_pilih:frozen,frozen_at:at,stage_before:st})});
 const results=await db.batch([
  db.prepare("UPDATE elections SET live_voter_roll=0,frozen_at=?,frozen_hak_pilih=? WHERE id=? AND status_lock='locked' AND live_voter_roll=1 AND frozen_at IS NULL AND preview_mode=0 AND closed_early_at IS NULL AND julianday(opens_at) <= julianday(?) AND julianday(closes_at) > julianday(?)").bind(at,frozen,row.id,at,at),
  auditEntry,
 ]);
 if(!results[0]?.meta.changes) throw new ElectionError("Daftar Pemilih sudah dibekukan atau pemungutan suara telah ditutup.",409);
 return {frozen_hak_pilih:frozen,frozen_at:at,hak_pilih:frozen+await directInviteTerm(db)};
}
export async function freezeVoterRoll(db:D1Database,now:Date,cfg?:ServiceApiConfig,fetchImpl?:typeof fetch,actor?:AdminActor):Promise<FreezeVoterRollResult> {
 return freezeVoterRollInternal(db,cfg,now,fetchImpl,actor);
}
/**
 * Ubah saklar Tidak Membekukan DPT. Di Draf: bebas dinyalakan/dimatikan seperti
 * semula. Setelah Kunci: hanya mematikan saklar yang menyala, dan itu berarti
 * Bekukan DPT sekarang (satu arah). Menyalakan kembali hanya mungkin di Draf.
 */
export async function setLiveVoterRollMode(db:D1Database,now:Date,enabled:boolean,actor?:AdminActor,opts?:{cfg?:ServiceApiConfig;fetchImpl?:typeof fetch}):Promise<{enabled:boolean}&Partial<FreezeVoterRollResult>> {
 if(typeof enabled!=="boolean") throw new ElectionError("Nilai saklar Tidak Membekukan DPT tidak valid",400);
 const row=await db.prepare("SELECT status_lock FROM elections ORDER BY id LIMIT 1").first<{status_lock:string}>();
 if(!row) throw new ElectionError("Pemilihan belum dibuat",404);
 if(row.status_lock==="draft") {
  await db.batch([
   db.prepare("UPDATE elections SET live_voter_roll=? WHERE status_lock='draft'").bind(enabled?1:0),
   await audit(db,now,enabled?"Tidak Membekukan DPT diaktifkan":"Tidak Membekukan DPT dinonaktifkan",null,JSON.stringify({live_voter_roll:enabled}),actor),
  ]);
  return {enabled};
 }
 if(enabled) throw new ElectionError("Tidak Membekukan DPT hanya dapat diaktifkan saat Draf.",409);
 return {enabled:false,...await freezeVoterRollInternal(db,opts?.cfg,now,opts?.fetchImpl,actor)};
}
/** Frasa konfirmasi "Kembali ke Draf"; dibandingkan seperti konfirmasi nickname. */
export const RETURN_TO_DRAFT_PHRASE="KEMBALI KE DRAF";
/** Tahap terkunci yang boleh ditinggalkan; Draf dan Diumumkan tidak pernah masuk sini. */
type LockedStage=Extract<Stage,"scheduled"|"open"|"closed">;
export interface ReturnToDraftResult { kept_ballots:number; kept_participation:number; stage_before:LockedStage }
/** Alasan penolakan untuk baris pemilihan saat ini, atau null bila tindakannya boleh. */
function returnRefusal(row:{status_lock:string;preview_mode:number;opens_at:string|null},now:Date):string|null {
 // Diumumkan adalah catatan publik final; Draf tidak punya apa pun untuk dikembalikan.
 if(row.status_lock==="published") return "Hasil sudah diumumkan; pemilihan tidak dapat kembali ke Draf.";
 if(row.status_lock==="draft") return "Pemilihan sudah berada di Draf.";
 // Mode Pratinjau boleh di setiap tahap terkunci; pemilihan riil hanya sebelum dibuka,
 // sehingga suara yang tersimpan tidak pernah dicabut pada pemilihan sungguhan.
 if(row.preview_mode===1) return null;
 const opensAt=row.opens_at?Date.parse(row.opens_at):NaN;
 return Number.isFinite(opensAt)&&now.getTime()<opensAt?null:"Kembali ke Draf hanya tersedia sebelum pemungutan suara dibuka.";
}
/**
 * Matriks tampil-tombol Pengaturan (design.md D2): tindakan hanya ditawarkan saat
 * pemilihan terkunci, dan pada pemilihan riil hanya sebelum pemungutan suara dibuka.
 * Server tetap memeriksa ulang lewat returnToDraft; ini hanya untuk tampilan.
 */
export function canReturnToDraft(row:{status_lock:string;preview_mode:number;opens_at:string|null},now:Date):boolean {
 return row.status_lock==="locked"&&returnRefusal(row,now)===null;
}
/**
 * Kembalikan pemilihan terkunci ke Draf (design.md D1–D3, D7). Suara yang sudah
 * masuk (is_test=0) tetap tersimpan apa adanya; satu-satunya data yang dibuang
 * adalah data tahap yang dibatalkan, supaya Kunci berikutnya membuka pemilihan
 * menurut jam alih-alih tertinggal di Ditutup. Satu D1 batch: UPDATE bergerbang
 * status_lock, lalu entri audit yang hanya ditulis bila UPDATE itu berhasil.
 */
export async function returnToDraft(db:D1Database,now:Date,phrase:unknown,actor?:AdminActor):Promise<ReturnToDraftResult> {
 const normalized=typeof phrase==="string"?phrase.trim().replace(/\s+/g," ").toUpperCase():"";
 if(normalized!==RETURN_TO_DRAFT_PHRASE) throw new ElectionError("Frasa konfirmasi tidak sesuai.",400);
 const row=await db.prepare("SELECT id,status_lock,opens_at,closes_at,closed_early_at,preview_mode FROM elections ORDER BY id LIMIT 1").first<{id:number;status_lock:ElectionStatusLock;opens_at:string|null;closes_at:string|null;closed_early_at:string|null;preview_mode:number}>();
 if(!row) throw new ElectionError("Pemilihan belum dibuat",404);
 const refusal=returnRefusal(row,now); if(refusal) throw new ElectionError(refusal,409);
 // Pemilihan terkunci selalu punya jadwal (syarat Kunci); baris rusak ditolak, bukan 500.
 if(!row.opens_at||!row.closes_at) throw new ElectionError("Jadwal pemilihan belum lengkap",409);
 const stageBefore=stage({status_lock:row.status_lock,opens_at:row.opens_at,closes_at:row.closes_at,closed_early_at:row.closed_early_at},now.toISOString()) as LockedStage;
 // Hitungan suara yang dipertahankan dibaca di jendela batch ini dan ikut ke audit.
 const kept=await db.prepare("SELECT (SELECT COUNT(*) FROM ballots WHERE election_id=? AND is_test=0) AS ballots,(SELECT COUNT(*) FROM participation WHERE election_id=? AND is_test=0) AS participation").bind(row.id,row.id).first<{ballots:number;participation:number}>();
 const keptBallots=kept?.ballots??0,keptParticipation=kept?.participation??0;
 const detail=JSON.stringify({stage_before:stageBefore,preview_mode:row.preview_mode===1,kept_ballots:keptBallots,kept_participation:keptParticipation});
 const auditEntry=await buildGuardedAuditInsert(db,{at:now.toISOString(),actor_type:"admin",actor_member_id:actor?.member_id??null,actor_name:actor?.name??"",action:"Pemilihan dikembalikan ke Draf",target:null,komsat_path:null,detail_json:detail});
 const results=await db.batch([
  db.prepare("UPDATE elections SET status_lock='draft',frozen_hak_pilih=NULL,frozen_at=NULL,closed_early_at=NULL,closing_snapshot_hash=NULL,closing_snapshot_at=NULL,abstain_counted_at=NULL,abstain_counted_count=NULL,closing_hak_pilih=NULL,closing_hak_pilih_at=NULL WHERE id=? AND status_lock='locked' AND (preview_mode=1 OR julianday(opens_at) > julianday(?))").bind(row.id,now.toISOString()),
  auditEntry,
 ]);
 if(!results[0]?.meta.changes) {
  const current=await db.prepare("SELECT status_lock,preview_mode,opens_at FROM elections WHERE id=?").bind(row.id).first<{status_lock:string;preview_mode:number;opens_at:string|null}>();
  throw new ElectionError((current&&returnRefusal(current,now))??"Pemilihan tidak dapat dikembalikan ke Draf");
 }
 return {kept_ballots:keptBallots,kept_participation:keptParticipation,stage_before:stageBefore};
}
export async function setSchedule(db:D1Database,now:Date,input:{title:string;description:string;opens_at:string;closes_at:string;preview_mode?:boolean}) {
 const e=await db.prepare("SELECT status_lock FROM elections ORDER BY id LIMIT 1").first<{status_lock:string}>(); if(e?.status_lock!=="draft") throw new ElectionError("Jadwal hanya dapat diubah saat Draf");
 // Formulir mengirim waktu dinding (datetime-local): nilai tanpa zona dibaca sebagai JST,
 // nilai ber-zona tetap dipakai apa adanya. Simpan sebagai UTC-Z agar guard konsisten.
 const opensAt=fromJstInputValue(input.opens_at); const closesAt=fromJstInputValue(input.closes_at);
 if(!opensAt||!closesAt||Date.parse(closesAt)<=Date.parse(opensAt)) throw new ElectionError("Jadwal tidak valid",400);
 const previewMode=input.preview_mode===true?1:0;
 await db.batch([db.prepare("UPDATE elections SET title=?,description=?,opens_at=?,closes_at=?,preview_mode=? WHERE status_lock='draft'").bind(input.title,input.description,opensAt,closesAt,previewMode),await audit(db,now,"Jadwal pemilihan diperbarui",null,previewMode?JSON.stringify({preview_mode:true}):null)]);
}
export async function clearSchedule(db:D1Database,now:Date) { const e=await db.prepare("SELECT status_lock FROM elections ORDER BY id LIMIT 1").first<{status_lock:string}>(); if(e?.status_lock!=="draft") throw new ElectionError("Jadwal hanya dapat diubah saat Draf"); await db.batch([db.prepare("UPDATE elections SET opens_at=NULL,closes_at=NULL WHERE status_lock='draft'"),await audit(db,now,"Jadwal pemilihan dihapus",null)]); }
const activeLocks = new WeakSet<D1Database>();
export async function lockElection(db:D1Database,cfg:ServiceApiConfig,now:Date,fetchImpl:typeof fetch=fetch) {
 if(activeLocks.has(db)) throw new ElectionError("Pemilihan sedang dikunci",409);
 activeLocks.add(db);
 try { return await lockElectionInternal(db,cfg,now,fetchImpl); } finally { activeLocks.delete(db); }
}
async function lockElectionInternal(db:D1Database,cfg:ServiceApiConfig,now:Date,fetchImpl:typeof fetch) {
 const row=await db.prepare("SELECT * FROM elections ORDER BY id LIMIT 1").first<{id:number;status_lock:string;allow_admin_voting:number;preview_mode:number;single_candidate_mode:number;live_voter_roll:number}>(); if(!row||row.status_lock!=="draft") throw new ElectionError("Pemilihan bukan Draf");
 const checks=await getReadiness(db,now); if(checks.some(c=>!c.ok)) throw new ElectionError("Kesiapan pemilihan belum terpenuhi",409,checks);
 let finalSync: { excluded: number } | null = null;
 if(!row.preview_mode) { try { finalSync=await syncPemilih(db,cfg,now,fetchImpl,{full:true}); } catch(error) { throw new ElectionError(`Sinkronisasi final gagal: ${error instanceof Error?error.message:String(error)}`,503); } }
 // Mode "Tidak Membekukan DPT": sinkronisasi final tetap dijalankan supaya view
 // portal mulai lengkap dan portal terbukti terjangkau saat Kunci, tetapi roll
 // tidak dibekukan (frozen_at/frozen_hak_pilih tetap NULL). Hitungan view awal
 // diaudit; rumusnya satu helper yang sama dengan pembekuan biasa.
 const live=row.live_voter_roll===1;
 let frozen:number; let portalViewCount:number|null=null;
 if(live) { portalViewCount=await liveHakPilih(db); frozen=portalViewCount; }
 else {
  // Hak pilih beku hanya menghitung baris roll yang boleh memilih (can_vote = 1);
  // can_vote 0/NULL tidak pernah diterima saat memilih, jadi bukan bagian denominator.
  const count=(await db.prepare("SELECT COUNT(*) AS n FROM voters WHERE can_vote = 1").first<{n:number}>())?.n??0;
  const admins=(await db.prepare("SELECT COUNT(*) AS n FROM voters v JOIN admin_voting a ON a.member_id=v.member_id WHERE v.can_vote = 1").first<{n:number}>())?.n??0;
  frozen=count-(row.allow_admin_voting===0?admins:0);
 }
 const candidates=(await db.prepare("SELECT id FROM candidates ORDER BY id").all<{id:number}>()).results;
 const colors=[...palette];
 for(let i=colors.length-1;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]!%(i+1); [colors[i],colors[j]]=[colors[j]!,colors[i]!];}
 const deletions=await db.prepare("SELECT COUNT(*) AS n FROM participation WHERE election_id=? AND is_test=1").bind(row.id).first<{n:number}>();
 const votes=deletions?.n??0;
 // Tautan Undangan Langsung dicatat terpisah dari roll beku: `frozen_hak_pilih`
 // tetap hanya suku roll, dan istilah tautan hidup di election/hakPilih.ts.
 const activeDirectLinks=await directInviteTerm(db);
 const lockAudit=await audit(db,now,"Pemilihan dikunci",String(row.id),JSON.stringify({frozen_hak_pilih:live?undefined:frozen,active_direct_links:activeDirectLinks,detail:`Data uji coba dihapus: ${votes} suara`,deleted_test_votes:votes,single_candidate_mode:row.single_candidate_mode===1,live_voter_roll:live,...(live&&portalViewCount!=null?{portal_view_count:portalViewCount}:{}),...(finalSync?.excluded?{tanpa_hak_pilih:finalSync.excluded}:{})}));
 const statements=[live
  ?db.prepare("UPDATE elections SET status_lock='locked' WHERE id=? AND status_lock='draft'").bind(row.id)
  :db.prepare("UPDATE elections SET status_lock='locked',frozen_hak_pilih=?,frozen_at=? WHERE id=? AND status_lock='draft'").bind(frozen,now.toISOString(),row.id),db.prepare("DELETE FROM participation WHERE election_id=? AND is_test=1").bind(row.id),db.prepare("DELETE FROM ballots WHERE election_id=? AND is_test=1").bind(row.id),...candidates.map((c,i)=>db.prepare("UPDATE candidates SET color=? WHERE id=?").bind(colors[i]!,c.id)),lockAudit];
 let result;
 try { result=await db.batch(statements); } catch(error) { const current=await db.prepare("SELECT status_lock FROM elections WHERE id=?").bind(row.id).first<{status_lock:string}>(); if(current?.status_lock!=="draft") throw new ElectionError("Pemilihan telah dikunci oleh permintaan lain"); throw error; }
 if(!result[0]?.meta.changes) throw new ElectionError("Pemilihan telah dikunci oleh permintaan lain");
 return live?{deleted_test_votes:votes}:{frozen_hak_pilih:frozen,deleted_test_votes:votes};
}
async function requireStage(db:D1Database,now:Date,desired:"open"|"closed") {
 const row=await db.prepare("SELECT * FROM elections ORDER BY id LIMIT 1").first<{id:number;status_lock:"draft"|"locked"|"published";opens_at:string;closes_at:string;closed_early_at:string|null}>(); if(!row||stage(row,now.toISOString())!==desired) throw new ElectionError("Tahap pemilihan tidak mengizinkan tindakan ini"); return row;
}
export async function extendClosing(db:D1Database,now:Date,newClosesAt:string,reason:string) { const row=await requireStage(db,now,"open"); const normalizedClosesAt=fromJstInputValue(newClosesAt); if(!normalizedClosesAt||Date.parse(normalizedClosesAt)<=Date.parse(row.closes_at)) throw new ElectionError("Waktu penutupan baru harus lebih akhir"); await db.batch([db.prepare("UPDATE elections SET closes_at=? WHERE status_lock='locked' AND closed_early_at IS NULL").bind(normalizedClosesAt),await audit(db,now,"Waktu penutupan diperpanjang",null,JSON.stringify({closes_at:normalizedClosesAt,reason}))]); }
export async function closeEarly(db:D1Database,now:Date,reason:string) {
 const row=await requireStage(db,now,"open");
 const at=now.toISOString();
 const detail=JSON.stringify({reason});
 const last=await db.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").first<{hash:string}>();
 const prevHash=last?.hash??AUDIT_GENESIS_HASH;
 const auditEntry={at,actor_type:"admin" as const,actor_member_id:null,actor_name:"",action:"Pemilihan ditutup lebih awal",target:null,komsat_path:null,detail_json:detail};
 const hash=await sha256Hex(prevHash+canonicalRow({...auditEntry,prev_hash:prevHash}));
 // Mode Tidak Membekukan DPT: Hak pilih akhir ditetapkan di batch penutupan ini
 // juga, dengan entri audit sistem berantai setelah entri penutupan.
 const live=(await db.prepare("SELECT live_voter_roll FROM elections WHERE id=?").bind(row.id).first<{live_voter_roll:number}>())?.live_voter_roll===1;
 const closingHakPilih=live?await liveHakPilih(db):null;
 const statements=[
  db.prepare("UPDATE elections SET closed_early_at=?, closing_snapshot_hash=?, closing_snapshot_at=?, closing_hak_pilih=COALESCE(?, closing_hak_pilih), closing_hak_pilih_at=COALESCE(?, closing_hak_pilih_at) WHERE id=? AND status_lock='locked' AND closed_early_at IS NULL AND closing_snapshot_hash IS NULL").bind(at,hash,at,closingHakPilih,live?at:null,row.id),
  db.prepare("INSERT INTO audit_log (at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash) SELECT ?,?,?,?,?,?,?,?,?,? FROM elections WHERE id=? AND closed_early_at=? AND closing_snapshot_hash=?").bind(at,"admin",null,"","Pemilihan ditutup lebih awal",null,null,detail,prevHash,hash,row.id,at,hash),
 ];
 if(live&&closingHakPilih!=null) {
  const savedEntry={at,actor_type:"system" as const,actor_member_id:null,actor_name:"",action:"Hak pilih akhir disimpan",target:String(row.id),komsat_path:null,detail_json:JSON.stringify({hak_pilih:closingHakPilih})};
  const savedHash=await sha256Hex(hash+canonicalRow({...savedEntry,prev_hash:hash}));
  statements.push(db.prepare("INSERT INTO audit_log (at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash) SELECT ?,?,?,?,?,?,?,?,?,? FROM elections WHERE id=? AND closed_early_at=? AND closing_snapshot_hash=? AND closing_hak_pilih=?").bind(at,"system",null,"","Hak pilih akhir disimpan",String(row.id),null,savedEntry.detail_json,hash,savedHash,row.id,at,hash,closingHakPilih));
 }
 const results=await db.batch(statements);
 if(!results[0]?.meta?.changes) throw new ElectionError("Pemilihan sudah ditutup");
}
/** Pesan penolakan Umumkan selama Hitung Abstain belum dijalankan (mode kandidat tunggal). */
export const ABSTAIN_NOT_COUNTED_MESSAGE="Hasil belum dapat diumumkan: jalankan Hitung Abstain terlebih dahulu agar Pemilih yang tidak memilih dihitung Abstain.";
export interface AbstainCountState {
 single_candidate_mode:boolean; stage:Stage;
 /** Sudah dijalankan; angkanya tetap dan tidak dapat dibatalkan. */
 counted:boolean; counted_at:string|null; counted_count:number|null;
 /** Hak pilih beku dikurangi partisipasi (bukan Uji Coba); hanya agregat. */
 pending_count:number;
 can_run:boolean; reason:string|null;
}
interface AbstainRow {id:number;status_lock:ElectionStatusLock;opens_at:string|null;closes_at:string|null;closed_early_at:string|null;frozen_hak_pilih:number|null;single_candidate_mode:number;abstain_counted_at:string|null;abstain_counted_count:number|null;live_voter_roll:number;closing_hak_pilih:number|null}
/** Keadaan tombol Hitung Abstain: alasan penolakan (atau null) dan angka yang akan ditambahkan. */
export async function getAbstainCount(db:D1Database,now:Date):Promise<AbstainCountState> {
 const row=await db.prepare("SELECT id,status_lock,opens_at,closes_at,closed_early_at,frozen_hak_pilih,single_candidate_mode,abstain_counted_at,abstain_counted_count,live_voter_roll,closing_hak_pilih FROM elections ORDER BY id LIMIT 1").first<AbstainRow>();
 if(!row) throw new ElectionError("Pemilihan belum dibuat",404);
 const st=stage({status_lock:row.status_lock,opens_at:row.opens_at??"",closes_at:row.closes_at??"",closed_early_at:row.closed_early_at},now.toISOString());
 const participation=(await db.prepare("SELECT COUNT(*) AS n FROM participation WHERE election_id=? AND is_test=0").bind(row.id).first<{n:number}>())?.n??0;
 // Mode Tidak Membekukan DPT: angka dasarnya Hak pilih akhir yang tersimpan
 // (penetapan dijalankan di pembacaan ini bila belum ada), bukan hitungan live.
 // Satu penyelesai yang sama dengan hasil/Dasbor, termasuk tautan Undangan
 // Langsung (election/hakPilih.ts) pada jalur roll beku maupun live.
 const eligible=(await resolveHakPilih(db,now)).hakPilih;
 const pending=Math.max(0,eligible-participation);
 const counted=row.abstain_counted_at!==null;
 const reason=row.single_candidate_mode!==1?"Hitung Abstain hanya berlaku pada mode kandidat tunggal."
  :counted?"Hitung Abstain sudah dijalankan dan tidak dapat diulang."
  :st!=="closed"?"Hitung Abstain baru tersedia setelah pemungutan suara ditutup.":null;
 return {single_candidate_mode:row.single_candidate_mode===1,stage:st,counted,counted_at:row.abstain_counted_at,counted_count:row.abstain_counted_count,pending_count:pending,can_run:reason===null,reason};
}
/**
 * Hitung Abstain (keputusan owner 2026-11-16, Q193): Pemilih yang tidak memilih
 * baru ditambahkan ke Abstain setelah Admin Voting menjalankannya, sekali dan
 * tidak dapat dibatalkan. Hanya menyimpan angka agregat (Hak pilih beku dikurangi
 * partisipasi) dan waktunya; tidak pernah per orang. UPDATE bergerbang dan entri
 * audit dalam satu D1 batch, sehingga permintaan ganda hanya berhasil sekali.
 */
export async function countAbstain(db:D1Database,now:Date,actor?:AdminActor):Promise<{counted_count:number;counted_at:string}> {
 const state=await getAbstainCount(db,now);
 if(!state.can_run) throw new ElectionError(state.reason??"Hitung Abstain tidak dapat dijalankan",409);
 const row=await db.prepare("SELECT id FROM elections ORDER BY id LIMIT 1").first<{id:number}>();
 const at=now.toISOString(),count=state.pending_count;
 const auditEntry=await buildGuardedAuditInsert(db,{at,actor_type:"admin",actor_member_id:actor?.member_id??null,actor_name:actor?.name??"",action:"Hitung Abstain dijalankan",target:null,komsat_path:null,detail_json:JSON.stringify({tidak_memilih_ditambahkan:count})});
 const results=await db.batch([
  db.prepare("UPDATE elections SET abstain_counted_at=?,abstain_counted_count=? WHERE id=? AND status_lock='locked' AND single_candidate_mode=1 AND abstain_counted_at IS NULL").bind(at,count,row!.id),
  auditEntry,
 ]);
 if(!results[0]?.meta.changes) throw new ElectionError("Hitung Abstain sudah dijalankan",409);
 return {counted_count:count,counted_at:at};
}
export async function publishResults(db:D1Database,now:Date) {
 const row=await requireStage(db,now,"closed");
 // Mode kandidat tunggal: hasil baru boleh diumumkan setelah Hitung Abstain dijalankan.
 const gate=await db.prepare("SELECT single_candidate_mode,abstain_counted_at FROM elections WHERE id=?").bind(row.id).first<{single_candidate_mode:number;abstain_counted_at:string|null}>();
 if(gate?.single_candidate_mode===1&&gate.abstain_counted_at===null) throw new ElectionError(ABSTAIN_NOT_COUNTED_MESSAGE,409);
 // Gerbang diulang di UPDATE agar tidak ada celah antara pemeriksaan dan penulisan.
 const result=await db.batch([db.prepare("UPDATE elections SET status_lock='published' WHERE status_lock='locked' AND (single_candidate_mode=0 OR abstain_counted_at IS NOT NULL)"),await audit(db,now,"Hasil pemilihan diumumkan",null)]);
 if(!result[0]?.meta.changes) throw new ElectionError("Hasil telah diumumkan");
}
export async function castTestVote(db:D1Database,now:Date,candidateId:number,adminMemberId:string,choiceInput?:unknown) {
 const row=await db.prepare("SELECT id,status_lock,single_candidate_mode FROM elections ORDER BY id LIMIT 1").first<{id:number;status_lock:string;single_candidate_mode:number}>(); if(!row||row.status_lock!=="draft") throw new ElectionError("Uji coba hanya diizinkan saat Draf");
 // Rehearsal surat suara mode kandidat tunggal: panitia memilih salah satu dari
 // tiga jawaban. Di luar mode itu bentuk suara uji tetap seperti sebelumnya.
 const requestedChoice:unknown=choiceInput??null;
 let choice:VoteChoice|null=null;
 if(row.single_candidate_mode===1){ if(!isVoteChoice(requestedChoice)) throw new ElectionError("Pilihan suara tidak valid",400); choice=requestedChoice; }
 else if(requestedChoice!==null) throw new ElectionError("Pilihan suara hanya berlaku pada mode kandidat tunggal",400);
 const voter=await db.prepare("SELECT name,komsat_path FROM voters WHERE member_id=?").bind(adminMemberId).first<{name:string;komsat_path:string}>(); if(!voter||!await db.prepare("SELECT 1 FROM admin_voting WHERE member_id=?").bind(adminMemberId).first()) throw new ElectionError("Admin Voting tidak aktif",403);
 if(!await db.prepare("SELECT 1 FROM candidates WHERE id=?").bind(candidateId).first()) throw new ElectionError("Kandidat tidak ditemukan",404);
 const receipt=crypto.randomUUID()+crypto.randomUUID(); const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(receipt)))).map(b=>b.toString(16).padStart(2,"0")).join("");
 try { await db.batch([db.prepare("INSERT INTO participation (election_id,member_id,member_name,voted_at,is_test) VALUES (?,?,?,?,1)").bind(row.id,adminMemberId,voter.name,now.toISOString()),db.prepare("INSERT INTO ballots (id,election_id,candidate_id,komsat_path,receipt_hash,is_test,choice) VALUES (?,?,?,?,?,1,?)").bind(crypto.randomUUID(),row.id,candidateId,voter.komsat_path,hash,choice),await audit(db,now,"Uji coba",String(candidateId))]); } catch(e) { if(String(e).includes("UNIQUE")||String(e).includes("constraint")) throw new ElectionError("Admin telah melakukan uji coba"); throw e; }
 return {receipt_hash:hash};
}
