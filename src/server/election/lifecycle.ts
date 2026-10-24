import type { D1Database } from "@cloudflare/workers-types";
import { AUDIT_GENESIS_HASH, buildAuditInsert, canonicalRow, sha256Hex } from "../lib/audit";
import { stage } from "../lib/stage";
import { syncPemilih } from "../serviceapi/sync";
import type { ServiceApiConfig } from "../serviceapi/client";
import { ElectionError, type ReadinessCheck } from "./candidates";
const palette=['#B91C1C','#1D4ED8','#15803D','#C2410C','#7E22CE','#BE185D','#0F766E','#4338CA','#92400E','#155E75'];
async function audit(db:D1Database,now:Date,action:string,target:string|null,detail:string|null=null) { return buildAuditInsert(db,{at:now.toISOString(),actor_type:"admin",actor_member_id:null,actor_name:"",action,target,komsat_path:null,detail_json:detail}); }
export async function getReadiness(db:D1Database,now:Date):Promise<ReadinessCheck[]> {
 const e=await db.prepare("SELECT * FROM elections ORDER BY id LIMIT 1").first<{opens_at:string|null;closes_at:string|null;preview_mode:number}>();
 const candidates=await db.prepare("SELECT COUNT(*) AS n FROM candidates").first<{n:number}>();
 const duplicate=await db.prepare("SELECT nickname FROM candidates GROUP BY nickname COLLATE NOCASE HAVING COUNT(*)>1 LIMIT 1").first();
 const sync=await db.prepare("SELECT value FROM system_config WHERE key='pemilih_last_sync'").first(); const voters=await db.prepare("SELECT COUNT(*) AS n FROM voters").first<{n:number}>();
 const adminCandidate=await db.prepare("SELECT 1 FROM candidates c JOIN admin_voting a ON a.member_id=c.member_id LIMIT 1").first();
 const time= e?.opens_at ? Date.parse(e.opens_at) : NaN;
 const preview= e?.preview_mode===1;
 return [
  {key:"schedule",ok:!!e?.opens_at&&!!e.closes_at&&Date.parse(e.closes_at)>time,message:"Jadwal harus diatur dengan waktu yang valid"},
  {key:"opens_future",ok:Number.isFinite(time)&&(preview?true:time>now.getTime()),message:preview?"Mode pratinjau: pemilihan dapat dibuka sekarang":"Waktu mulai harus di masa depan"},
  {key:"candidate_count",ok:(candidates?.n??0)>=2&&(candidates?.n??0)<=10,message:(candidates?.n??0)<2?"Minimal 2 kandidat":"Maksimal 10 kandidat"},
  {key:"nicknames",ok:!duplicate,message:"Nickname kandidat harus unik"},
  {key:"roll_synced",ok:preview|| (!!sync&&(voters?.n??0)>0),message:preview?"Mode pratinjau: pemilih terdaftar otomatis saat masuk":"Daftar Pemilih belum disinkronkan"},
  {key:"admin_candidate",ok:!adminCandidate,message:"Admin Voting tidak dapat menjadi kandidat"},
 ];
}
export async function setSchedule(db:D1Database,now:Date,input:{title:string;description:string;opens_at:string;closes_at:string;preview_mode?:boolean}) {
 const e=await db.prepare("SELECT status_lock FROM elections ORDER BY id LIMIT 1").first<{status_lock:string}>(); if(e?.status_lock!=="draft") throw new ElectionError("Jadwal hanya dapat diubah saat Draf");
 if(!Number.isFinite(Date.parse(input.opens_at))||!Number.isFinite(Date.parse(input.closes_at))||Date.parse(input.closes_at)<=Date.parse(input.opens_at)) throw new ElectionError("Jadwal tidak valid",400);
 // Simpan sebagai UTC-Z agar perbandingan waktu konsisten di seluruh guard.
 const opensAt=new Date(input.opens_at).toISOString(); const closesAt=new Date(input.closes_at).toISOString();
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
 const row=await db.prepare("SELECT * FROM elections ORDER BY id LIMIT 1").first<{id:number;status_lock:string;allow_admin_voting:number;preview_mode:number}>(); if(!row||row.status_lock!=="draft") throw new ElectionError("Pemilihan bukan Draf");
 const checks=await getReadiness(db,now); if(checks.some(c=>!c.ok)) throw new ElectionError("Kesiapan pemilihan belum terpenuhi",409,checks);
 if(!row.preview_mode) { try { await syncPemilih(db,cfg,now,fetchImpl); } catch(error) { throw new ElectionError(`Sinkronisasi final gagal: ${error instanceof Error?error.message:String(error)}`,503); } }
 const count=(await db.prepare("SELECT COUNT(*) AS n FROM voters").first<{n:number}>())?.n??0;
 const admins=(await db.prepare("SELECT COUNT(*) AS n FROM voters v JOIN admin_voting a ON a.member_id=v.member_id").first<{n:number}>())?.n??0;
 const frozen=count-(row.allow_admin_voting===0?admins:0);
 const candidates=(await db.prepare("SELECT id FROM candidates ORDER BY id").all<{id:number}>()).results;
 const colors=[...palette];
 for(let i=colors.length-1;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]!%(i+1); [colors[i],colors[j]]=[colors[j]!,colors[i]!];}
 const deletions=await db.prepare("SELECT COUNT(*) AS n FROM participation WHERE election_id=? AND is_test=1").bind(row.id).first<{n:number}>();
 const votes=deletions?.n??0;
 const lockAudit=await audit(db,now,"Pemilihan dikunci",String(row.id),JSON.stringify({frozen_hak_pilih:frozen,detail:`Data uji coba dihapus: ${votes} suara`,deleted_test_votes:votes}));
 const statements=[db.prepare("UPDATE elections SET status_lock='locked',frozen_hak_pilih=?,frozen_at=? WHERE id=? AND status_lock='draft'").bind(frozen,now.toISOString(),row.id),db.prepare("DELETE FROM participation WHERE election_id=? AND is_test=1").bind(row.id),db.prepare("DELETE FROM ballots WHERE election_id=? AND is_test=1").bind(row.id),...candidates.map((c,i)=>db.prepare("UPDATE candidates SET color=? WHERE id=?").bind(colors[i]!,c.id)),lockAudit];
 let result;
 try { result=await db.batch(statements); } catch(error) { const current=await db.prepare("SELECT status_lock FROM elections WHERE id=?").bind(row.id).first<{status_lock:string}>(); if(current?.status_lock!=="draft") throw new ElectionError("Pemilihan telah dikunci oleh permintaan lain"); throw error; }
 if(!result[0]?.meta.changes) throw new ElectionError("Pemilihan telah dikunci oleh permintaan lain");
 return {frozen_hak_pilih:frozen,deleted_test_votes:votes};
}
async function requireStage(db:D1Database,now:Date,desired:"open"|"closed") {
 const row=await db.prepare("SELECT * FROM elections ORDER BY id LIMIT 1").first<{id:number;status_lock:"draft"|"locked"|"published";opens_at:string;closes_at:string;closed_early_at:string|null}>(); if(!row||stage(row,now.toISOString())!==desired) throw new ElectionError("Tahap pemilihan tidak mengizinkan tindakan ini"); return row;
}
export async function extendClosing(db:D1Database,now:Date,newClosesAt:string,reason:string) { const row=await requireStage(db,now,"open"); if(!Number.isFinite(Date.parse(newClosesAt))||Date.parse(newClosesAt)<=Date.parse(row.closes_at)) throw new ElectionError("Waktu penutupan baru harus lebih akhir"); const normalizedClosesAt=new Date(newClosesAt).toISOString(); await db.batch([db.prepare("UPDATE elections SET closes_at=? WHERE status_lock='locked' AND closed_early_at IS NULL").bind(normalizedClosesAt),await audit(db,now,"Waktu penutupan diperpanjang",null,JSON.stringify({closes_at:normalizedClosesAt,reason}))]); }
export async function closeEarly(db:D1Database,now:Date,reason:string) {
 const row=await requireStage(db,now,"open");
 const at=now.toISOString();
 const detail=JSON.stringify({reason});
 const last=await db.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").first<{hash:string}>();
 const prevHash=last?.hash??AUDIT_GENESIS_HASH;
 const auditEntry={at,actor_type:"admin" as const,actor_member_id:null,actor_name:"",action:"Pemilihan ditutup lebih awal",target:null,komsat_path:null,detail_json:detail};
 const hash=await sha256Hex(prevHash+canonicalRow({...auditEntry,prev_hash:prevHash}));
 const results=await db.batch([
  db.prepare("UPDATE elections SET closed_early_at=?, closing_snapshot_hash=?, closing_snapshot_at=? WHERE id=? AND status_lock='locked' AND closed_early_at IS NULL AND closing_snapshot_hash IS NULL").bind(at,hash,at,row.id),
  db.prepare("INSERT INTO audit_log (at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash) SELECT ?,?,?,?,?,?,?,?,?,? FROM elections WHERE id=? AND closed_early_at=? AND closing_snapshot_hash=?").bind(at,"admin",null,"","Pemilihan ditutup lebih awal",null,null,detail,prevHash,hash,row.id,at,hash),
 ]);
 if(!results[0]?.meta?.changes) throw new ElectionError("Pemilihan sudah ditutup");
}
export async function publishResults(db:D1Database,now:Date) { await requireStage(db,now,"closed"); const result=await db.batch([db.prepare("UPDATE elections SET status_lock='published' WHERE status_lock='locked'"),await audit(db,now,"Hasil pemilihan diumumkan",null)]); if(!result[0]?.meta.changes) throw new ElectionError("Hasil telah diumumkan"); }
export async function castTestVote(db:D1Database,now:Date,candidateId:number,adminMemberId:string) {
 const row=await db.prepare("SELECT id,status_lock FROM elections ORDER BY id LIMIT 1").first<{id:number;status_lock:string}>(); if(!row||row.status_lock!=="draft") throw new ElectionError("Uji coba hanya diizinkan saat Draf");
 const voter=await db.prepare("SELECT name,komsat_path FROM voters WHERE member_id=?").bind(adminMemberId).first<{name:string;komsat_path:string}>(); if(!voter||!await db.prepare("SELECT 1 FROM admin_voting WHERE member_id=?").bind(adminMemberId).first()) throw new ElectionError("Admin Voting tidak aktif",403);
 if(!await db.prepare("SELECT 1 FROM candidates WHERE id=?").bind(candidateId).first()) throw new ElectionError("Kandidat tidak ditemukan",404);
 const receipt=crypto.randomUUID()+crypto.randomUUID(); const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(receipt)))).map(b=>b.toString(16).padStart(2,"0")).join("");
 try { await db.batch([db.prepare("INSERT INTO participation (election_id,member_id,member_name,voted_at,is_test) VALUES (?,?,?,?,1)").bind(row.id,adminMemberId,voter.name,now.toISOString()),db.prepare("INSERT INTO ballots (id,election_id,candidate_id,komsat_path,receipt_hash,is_test) VALUES (?,?,?,?,?,1)").bind(crypto.randomUUID(),row.id,candidateId,voter.komsat_path,hash),await audit(db,now,"Uji coba",String(candidateId))]); } catch(e) { if(String(e).includes("UNIQUE")||String(e).includes("constraint")) throw new ElectionError("Admin telah melakukan uji coba"); throw e; }
 return {receipt_hash:hash};
}
