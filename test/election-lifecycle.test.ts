import {beforeEach,describe,expect,it} from "vitest";
import {env,reset} from "cloudflare:test";
import base from "../migrations/0001_init.sql?raw";import units from "../migrations/0002_units.sql?raw";import lock from "../migrations/0003_election_lock.sql?raw";import snapshot from "../migrations/0005_closing_snapshot.sql?raw";import preview from "../migrations/0006_preview_mode.sql?raw";import memberNumber from "../migrations/0008_member_number.sql?raw";import categorySql from "../migrations/0009_voter_category.sql?raw";import canVoteSql from "../migrations/0010_voter_can_vote.sql?raw";
import {createCandidate} from "../src/server/election/candidates";
import intro from "../migrations/0007_candidate_short_intro.sql?raw";import singleModeSql from "../migrations/0011_single_candidate_mode.sql?raw";import ballotChoiceSql from "../migrations/0012_ballot_choice.sql?raw";
import ballotAbstainSql from "../migrations/0013_ballot_choice_abstain.sql?raw";
import abstainCountedSql from "../migrations/0014_abstain_counted.sql?raw";
import liveRollSql from "../migrations/0015_live_voter_roll.sql?raw";
import closingHakPilihSql from "../migrations/0016_closing_hak_pilih.sql?raw";
import directInvitationsSql from "../migrations/0017_direct_invitations.sql?raw";
import campaignUrlSql from "../migrations/0018_candidate_campaign_url.sql?raw";
import {ABSTAIN_NOT_COUNTED_MESSAGE,canReturnToDraft,castTestVote,closeEarly,countAbstain,getAbstainCount,extendClosing,getLiveVoterRollMode,getReadiness,getSingleCandidateMode,lockElection,publishResults,returnToDraft,setLiveVoterRollMode,setSchedule,setSingleCandidateMode} from "../src/server/election/lifecycle";
import {getPublicBoard} from "../src/server/voting/board";
import {stage} from "../src/server/lib/stage";
import {verifyChain,type AuditRow} from "../src/server/lib/audit";
import {app} from "../src/server/app";
import {sealSession} from "../src/server/auth/session";
import {createServiceApiStub} from "./lib/serviceapi-fixture";
declare module "*.sql?raw" { const sql: string; export default sql; }
const NOW=new Date("2026-10-20T00:00:00Z");const cfg={issuer:"https://fixture.invalid",clientId:"client",clientSecret:"secret",serviceApiUrl:"https://fixture.invalid"};
async function setup(allow=1){await reset();await env.DB.batch([base,units,lock,snapshot,preview,memberNumber,categorySql,canVoteSql,intro,singleModeSql,ballotChoiceSql, ballotAbstainSql, abstainCountedSql, liveRollSql, closingHakPilihSql, directInvitationsSql, campaignUrlSql].flatMap(sql=>sql.split(";").map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s))));await env.DB.prepare("INSERT INTO elections(id,allow_admin_voting) VALUES(1,?)").bind(allow).run();await env.DB.prepare("INSERT INTO admin_voting(member_id,name,created_at) VALUES('member-8','Admin','now')").run();}
async function candidates(){for(let i=1;i<=2;i++){await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,member_number) VALUES(?,?, '/u','ACTIVE','now',?)").bind(`member-${i}`,`Member ${i}`,`KARTU-00${i}`).run();await createCandidate(env.DB,NOW,{member_id:`KARTU-00${i}`,number:i,name:`Member ${i}`,nickname:`M${i}`,description:""});}}
async function ready(){await candidates();for(let i=3;i<=8;i++)await env.DB.prepare("INSERT INTO voters(member_id,name,nickname,komsat_path,status,synced_at) VALUES(?,?,?,'/u','ACTIVE','now')").bind(`member-${i}`,`Member ${i}`,`M${i}`).run();await env.DB.prepare("INSERT INTO system_config(key,value) VALUES('pemilih_last_sync','2026-10-19T00:00:00Z')").run();await setSchedule(env.DB,NOW,{title:"Election",description:"",opens_at:"2026-10-21T00:00:00Z",closes_at:"2026-10-22T00:00:00Z"});}
// Satu kandidat saja (mode kandidat tunggal) plus jadwal dan roll siap kunci.
async function readySingle(){
 await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,member_number) VALUES('member-1','Member 1','/u','ACTIVE','now','KARTU-001')").run();
 await createCandidate(env.DB,NOW,{member_id:"KARTU-001",number:1,name:"Member 1",nickname:"M1",description:""});
 for(let i=3;i<=8;i++)await env.DB.prepare("INSERT INTO voters(member_id,name,nickname,komsat_path,status,synced_at) VALUES(?,?,?,'/u','ACTIVE','now')").bind(`member-${i}`,`Member ${i}`,`M${i}`).run();
 await env.DB.prepare("INSERT INTO system_config(key,value) VALUES('pemilih_last_sync','2026-10-19T00:00:00Z')").run();
 await setSchedule(env.DB,NOW,{title:"Election",description:"",opens_at:"2026-10-21T00:00:00Z",closes_at:"2026-10-22T00:00:00Z"});
 await setSingleCandidateMode(env.DB,NOW,true);
}
async function actions(){return (await env.DB.prepare("SELECT action FROM audit_log ORDER BY seq").all<{action:string}>()).results.map(row=>row.action);}
describe("mode kandidat tunggal",()=>{
 beforeEach(()=>setup());
 it("mengaktifkan dan menonaktifkan lewat Pengaturan saat Draf dengan satu entri audit per permintaan",async()=>{
  expect(await getSingleCandidateMode(env.DB)).toEqual({enabled:false,editable:true,kept_ballots:0,reason:null});
  await setSingleCandidateMode(env.DB,NOW,true,{member_id:"member-8",name:"Admin"});
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:1});
  expect(await getSingleCandidateMode(env.DB)).toEqual({enabled:true,editable:true,kept_ballots:0,reason:null});
  expect(await actions()).toEqual(["Mode kandidat tunggal diaktifkan"]);
  await setSingleCandidateMode(env.DB,NOW,false);
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:0});
  expect(await actions()).toEqual(["Mode kandidat tunggal diaktifkan","Mode kandidat tunggal dinonaktifkan"]);
  // Entri audit mencatat pelakunya, tanpa rujukan anggota roll atau surat suara.
  const detail=await env.DB.prepare("SELECT actor_type,actor_member_id,actor_name,target,komsat_path,detail_json FROM audit_log ORDER BY seq LIMIT 1").first<Record<string,unknown>>();
  expect(detail).toEqual({actor_type:"admin",actor_member_id:"member-8",actor_name:"Admin",target:null,komsat_path:null,detail_json:JSON.stringify({single_candidate_mode:true})});
 });
 it("menolak perubahan mode setelah Kunci tanpa entri audit",async()=>{
  await env.DB.prepare("UPDATE elections SET status_lock='locked',single_candidate_mode=1").run();
  await expect(setSingleCandidateMode(env.DB,NOW,false)).rejects.toThrow("saat Draf");
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:1});
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first()).toEqual({n:0});
  // Halaman menampilkan saklar sebagai baca-saja setelah Draf.
  expect(await getSingleCandidateMode(env.DB)).toEqual({enabled:true,editable:false,kept_ballots:0,reason:"Nilai ini dibekukan setelah Kunci & Jadwalkan."});
 });
 it("menolak mengaktifkan mode saat 2 kandidat atau lebih sambil menyebut jumlahnya",async()=>{
  await candidates();
  await expect(setSingleCandidateMode(env.DB,NOW,true)).rejects.toThrow("saat ini terdaftar 2 kandidat");
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:0});
  expect(await actions()).toEqual(["Kandidat ditambahkan","Kandidat ditambahkan"]);
  // Daftar yang sudah berisi banyak kandidat bisa dikurangi dulu, lalu saklar menyala.
  await env.DB.prepare("DELETE FROM candidates WHERE id=2").run();
  await setSingleCandidateMode(env.DB,NOW,true);
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:1});
  // Menonaktifkan tetap boleh di Draf walau tetap ada satu kandidat.
  await setSingleCandidateMode(env.DB,NOW,false);
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:0});
 });
 it("membuat cek jumlah kandidat sadar-mode: tepat 1 kandidat saat mode hidup, 2-10 saat mati",async()=>{
  const check=async()=>(await getReadiness(env.DB,NOW)).find(item=>item.key==="candidate_count")!;
  expect(await check()).toMatchObject({ok:false,message:"Minimal 2 kandidat"});
  await setSingleCandidateMode(env.DB,NOW,true);
  expect(await check()).toMatchObject({ok:false});
  expect((await check()).message).toContain("tepat 1 kandidat");
  expect((await check()).message).toContain("Mode kandidat tunggal");
  await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,member_number) VALUES('member-1','Member 1','/u','ACTIVE','now','KARTU-001')").run();
  await createCandidate(env.DB,NOW,{member_id:"KARTU-001",number:1,name:"Member 1",nickname:"M1",description:""});
  expect(await check()).toMatchObject({ok:true});
  await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,member_number) VALUES('member-2','Member 2','/u','ACTIVE','now','KARTU-002')").run();
  // Kandidat kedua ditulis langsung: lewat form, mode hidup memang menolaknya.
  await env.DB.prepare("INSERT INTO candidates(id,member_id,number,name,nickname,komsat_path) VALUES(2,'member-2',2,'Member 2','M2','/u')").run();
  expect(await check()).toMatchObject({ok:false});
  await setSingleCandidateMode(env.DB,NOW,false);
  expect(await check()).toMatchObject({ok:true});
 });
 it("mengunci dengan tepat satu kandidat saat mode hidup dan mencatat nilai bekunya di audit Kunci",async()=>{
  await readySingle();
  const result=await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  expect(result.frozen_hak_pilih).toBeGreaterThan(0);
  expect(await env.DB.prepare("SELECT status_lock,single_candidate_mode FROM elections").first()).toEqual({status_lock:"locked",single_candidate_mode:1});
  const lockAudit=await env.DB.prepare("SELECT detail_json FROM audit_log WHERE action='Pemilihan dikunci'").first<{detail_json:string}>();
  expect(JSON.parse(lockAudit!.detail_json)).toMatchObject({single_candidate_mode:true});
 });
 it("tidak mengunci saat mode hidup dan kandidat bukan tepat satu",async()=>{
  await ready();
  // Nilai mode disimpan langsung: readiness tetap harus menolak Kunci walau
  // saklar tidak bisa dinyalakan lewat Pengaturan dengan dua kandidat.
  await env.DB.prepare("UPDATE elections SET single_candidate_mode=1").run();
  const before=await env.DB.prepare("SELECT status_lock FROM elections").first();
  await expect(lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl)).rejects.toMatchObject({status:409});
  expect(await env.DB.prepare("SELECT status_lock FROM elections").first()).toEqual(before);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='Pemilihan dikunci'").first()).toEqual({n:0});
 });
 it("mencatat nilai beku mode mati pada audit Kunci",async()=>{
  await ready();
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  const lockAudit=await env.DB.prepare("SELECT detail_json FROM audit_log WHERE action='Pemilihan dikunci'").first<{detail_json:string}>();
  expect(JSON.parse(lockAudit!.detail_json)).toMatchObject({single_candidate_mode:false});
 });
 it("menyimpan pilihan pada suara Uji Coba saat mode hidup dan menolak pilihan saat mode mati",async()=>{
  await readySingle();
  // Rehearsal surat suara tunggal: panitia memilih salah satu dari tiga jawaban.
  const test=await castTestVote(env.DB,NOW,1,"member-8","tidak_setuju");
  expect(test.receipt_hash).toMatch(/^[0-9a-f]{64}$/);
  const testBallot=await env.DB.prepare("SELECT candidate_id,choice,is_test FROM ballots").first();
  expect(testBallot).toEqual({candidate_id:1,choice:"tidak_setuju",is_test:1});
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM participation WHERE is_test=1").first()).toEqual({n:1});
  // Suara uji tanpa pilihan sah ditolak dan tidak menulis apa pun.
  await env.DB.prepare("DELETE FROM participation WHERE is_test=1").run();
  await env.DB.prepare("DELETE FROM ballots WHERE is_test=1").run();
  await expect(castTestVote(env.DB,NOW,1,"member-8")).rejects.toMatchObject({status:400});
  // Nilai di luar tiga jawaban ditolak dan tidak menulis apa pun.
  await expect(castTestVote(env.DB,NOW,1,"member-8","abstain-banget")).rejects.toMatchObject({status:400});
  await expect(castTestVote(env.DB,NOW,1,"member-8","setuju-banget")).rejects.toMatchObject({status:400});
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots").first()).toEqual({n:0});
  // Abstain adalah jawaban nyata (keputusan owner 2026-11-16) dan tersimpan pada suara Uji Coba.
  await castTestVote(env.DB,NOW,1,"member-8","abstain");
  expect(await env.DB.prepare("SELECT choice,is_test FROM ballots").first()).toEqual({choice:"abstain",is_test:1});
  await env.DB.prepare("DELETE FROM participation WHERE is_test=1").run();
  await env.DB.prepare("DELETE FROM ballots WHERE is_test=1").run();
  // Mode mati: bentuk suara uji tidak berubah (choice NULL) dan pilihan ditolak.
  await env.DB.prepare("UPDATE elections SET single_candidate_mode=0").run();
  await expect(castTestVote(env.DB,NOW,1,"member-8","setuju")).rejects.toMatchObject({status:400});
  await castTestVote(env.DB,NOW,1,"member-8");
  expect(await env.DB.prepare("SELECT choice FROM ballots").first()).toEqual({choice:null});
 });
});

describe("election lifecycle",()=>{
 beforeEach(()=>setup());
 it("returns each readiness failure and all green",async()=>{let checks=await getReadiness(env.DB,NOW);expect(checks.find(c=>c.key==="schedule")?.ok).toBe(false);await candidates();checks=await getReadiness(env.DB,NOW);expect(checks.find(c=>c.key==="candidate_count")?.ok).toBe(true);expect(checks.find(c=>c.key==="roll_synced")?.ok).toBe(false);await env.DB.prepare("INSERT INTO system_config(key,value) VALUES('pemilih_last_sync','now')").run();await env.DB.prepare("INSERT INTO admin_voting(member_id,name,created_at) VALUES('member-1','Admin','now')").run();checks=await getReadiness(env.DB,NOW);expect(checks.find(c=>c.key==="admin_candidate")?.ok).toBe(false);await env.DB.prepare("DELETE FROM admin_voting WHERE member_id='member-1'").run();await setSchedule(env.DB,NOW,{title:"Election",description:"",opens_at:"2026-10-19T00:00:00Z",closes_at:"2026-10-22T00:00:00Z"});expect((await getReadiness(env.DB,NOW)).find(c=>c.key==="opens_future")?.ok).toBe(false);await setSchedule(env.DB,NOW,{title:"Election",description:"",opens_at:"2026-10-21T00:00:00Z",closes_at:"2026-10-22T00:00:00Z"});expect((await getReadiness(env.DB,NOW)).every(c=>c.ok)).toBe(true);});
 it("fails readiness with only one candidate",async()=>{await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,member_number) VALUES('member-1','Member 1','/u','ACTIVE','now','KARTU-001')").run();await createCandidate(env.DB,NOW,{member_id:"KARTU-001",number:1,name:"Member 1",nickname:"M1",description:""});expect((await getReadiness(env.DB,NOW)).find(check=>check.key==="candidate_count")?.ok).toBe(false);});
 it("runs final sync, purges test ballots, freezes count and distinct colors",async()=>{await ready();await castTestVote(env.DB,NOW,1,"member-8");const api=createServiceApiStub();const result=await lockElection(env.DB,cfg,NOW,api.fetchImpl);expect(result.frozen_hak_pilih).toBe(10);
 // Roll beku dibangun ulang dari portal: hanya Anggota Biasa ACTIVE.
 expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE can_vote IS NOT 1").first()).toEqual({n:0});
 expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE category <> 'BIASA' OR category IS NULL").first()).toEqual({n:0});
 expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE member_id IN ('member-12','member-13')").first()).toEqual({n:0});expect((await env.DB.prepare("SELECT status_lock,frozen_hak_pilih FROM elections").first()).status_lock).toBe("locked");expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots WHERE is_test=1").first()).toEqual({n:0});const colors=(await env.DB.prepare("SELECT color FROM candidates").all<{color:string}>()).results.map(x=>x.color);expect(new Set(colors).size).toBe(2);expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE detail_json LIKE '%Data uji coba dihapus: 1 suara%'").first()).toEqual({n:1});});
 it("subtracts committee members from frozen Hak pilih when disabled",async()=>{await setup(0);await ready();const api=createServiceApiStub();expect((await lockElection(env.DB,cfg,NOW,api.fetchImpl)).frozen_hak_pilih).toBe(9);});
 it("freezes only can_vote = 1 roll rows as Hak pilih, leaving can_vote 0 and NULL out",async()=>{
 // Mode pratinjau melewati sinkronisasi final, jadi roll hasil seed diuji apa adanya.
 for(let i=1;i<=2;i++){await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,member_number,can_vote) VALUES(?,?,'/u','ACTIVE','now',?,1)").bind(`member-${i}`,`Member ${i}`,`KARTU-00${i}`).run();await createCandidate(env.DB,NOW,{member_id:`KARTU-00${i}`,number:i,name:`Member ${i}`,nickname:`M${i}`,description:""});}
 await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,can_vote) VALUES('member-3','Member 3','/u','ACTIVE','now',1)").run();
 await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,can_vote) VALUES('member-4','Member 4','/u','ACTIVE','now',0)").run();
 await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,can_vote) VALUES('member-5','Member 5','/u','ACTIVE','now',NULL)").run();
 await env.DB.prepare("INSERT INTO system_config(key,value) VALUES('pemilih_last_sync','2026-10-19T00:00:00Z')").run();
 await setSchedule(env.DB,NOW,{title:"Election",description:"",opens_at:"2026-10-21T00:00:00Z",closes_at:"2026-10-22T00:00:00Z",preview_mode:true});
 const result=await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
 expect(result.frozen_hak_pilih).toBe(3);
 expect(await env.DB.prepare("SELECT frozen_hak_pilih FROM elections").first()).toEqual({frozen_hak_pilih:3});
 });
 it("subtracts committee members from frozen Hak pilih only while they are on the eligible roll",async()=>{
 await setup(0);
 // Dua kandidat + satu pemilih berhak; member-6 admin yang berhak, member-8 admin can_vote 0.
 for(let i=1;i<=2;i++){await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,member_number,can_vote) VALUES(?,?,'/u','ACTIVE','now',?,1)").bind(`member-${i}`,`Member ${i}`,`KARTU-00${i}`).run();await createCandidate(env.DB,NOW,{member_id:`KARTU-00${i}`,number:i,name:`Member ${i}`,nickname:`M${i}`,description:""});}
 await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,can_vote) VALUES('member-3','Member 3','/u','ACTIVE','now',1)").run();
 await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,can_vote) VALUES('member-6','Member 6','/u','ACTIVE','now',1)").run();
 await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at,can_vote) VALUES('member-8','Member 8','/u','ACTIVE','now',0)").run();
 await env.DB.prepare("INSERT INTO admin_voting(member_id,name,created_at) VALUES('member-6','Admin 6','now')").run();
 await env.DB.prepare("INSERT INTO system_config(key,value) VALUES('pemilih_last_sync','2026-10-19T00:00:00Z')").run();
 await setSchedule(env.DB,NOW,{title:"Election",description:"",opens_at:"2026-10-21T00:00:00Z",closes_at:"2026-10-22T00:00:00Z",preview_mode:true});
 // 4 baris berhak (member-1,2,3,6) dikurangi satu admin berhak (member-6); member-8 (can_vote 0) tidak pernah dihitung.
 expect((await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl)).frozen_hak_pilih).toBe(3);
 });
 it("failed final sync leaves draft and candidate data untouched",async()=>{await ready();const api=createServiceApiStub({mode:"fail_page_n",failPage:0});await expect(lockElection(env.DB,cfg,NOW,api.fetchImpl)).rejects.toThrow("Sinkronisasi final gagal");expect((await env.DB.prepare("SELECT status_lock FROM elections").first()).status_lock).toBe("draft");expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM voters").first()).n).toBe(8);expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM candidates WHERE color IS NOT NULL").first()).n).toBe(0);});
 it("supports extending, early closing and irreversible publication",async()=>{await ready();const api=createServiceApiStub();await lockElection(env.DB,cfg,NOW,api.fetchImpl);const openNow=new Date("2026-10-21T01:00:00Z");await expect(extendClosing(env.DB,openNow,"2026-10-21T23:00:00Z","earlier")).rejects.toThrow();await extendClosing(env.DB,openNow,"2026-10-23T00:00:00Z","incident");await closeEarly(env.DB,openNow,"incident");await expect(extendClosing(env.DB,openNow,"2026-10-24T00:00:00Z","late")).rejects.toThrow();await publishResults(env.DB,openNow);await expect(publishResults(env.DB,openNow)).rejects.toThrow();await expect(closeEarly(env.DB,openNow,"again")).rejects.toThrow();});
 it("removes test participation and refuses edits or test votes after lock",async()=>{await ready();await castTestVote(env.DB,NOW,1,"member-8");const api=createServiceApiStub();await lockElection(env.DB,cfg,NOW,api.fetchImpl);expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM participation WHERE is_test=1").first()).toEqual({n:0});await expect(castTestVote(env.DB,NOW,1,"member-8")).rejects.toThrow();await expect(setSchedule(env.DB,NOW,{title:"Changed",description:"",opens_at:"2026-10-21T00:00:00Z",closes_at:"2026-10-22T00:00:00Z"})).rejects.toThrow();});
 it("allows exactly one concurrent Kunci",async()=>{await ready();const api=createServiceApiStub();const results=await Promise.allSettled([lockElection(env.DB,cfg,NOW,api.fetchImpl),lockElection(env.DB,cfg,NOW,api.fetchImpl)]);expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);const rejected=results.find(x=>x.status==="rejected");expect(rejected?.status==="rejected"&&rejected.reason.status).toBe(409);});
});

// Kembali ke Draf (openspec/changes/add-return-to-draft): tahap dihitung dari jam
// yang dikirim, bukan jam sistem, jadi setiap skenario bisa memakai waktunya sendiri.
const PHRASE="KEMBALI KE DRAF",ACTOR={member_id:"member-8",name:"Admin"};
const MASTER_KEY=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const BINDINGS={DB:env.DB,APP_MASTER_KEY:MASTER_KEY};
const OPEN_AT="2026-10-21T00:00:00Z",CLOSE_AT="2026-10-22T00:00:00Z";
const OPEN_NOW=new Date("2026-10-21T01:00:00Z"),CLOSED_NOW=new Date("2026-10-22T01:00:00Z");
async function lockPreview(){
 await ready();
 await setSchedule(env.DB,NOW,{title:"Election",description:"",opens_at:OPEN_AT,closes_at:CLOSE_AT,preview_mode:true});
 await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
}
async function lockReal(){
 await ready();
 await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
}
async function electionRow(){return env.DB.prepare("SELECT * FROM elections ORDER BY id LIMIT 1").first<Record<string,unknown>>();}
async function auditTip(){return (await env.DB.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").first<{hash:string}>())?.hash??null;}
async function auditCount(){return (await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{n:number}>())!.n;}
describe("kembali ke draf",()=>{
 beforeEach(()=>setup());
 it("mengembalikan pemilihan Mode Pratinjau dari Terjadwal, Dibuka dan Ditutup ke Draf",async()=>{
  for(const at of [NOW,OPEN_NOW,CLOSED_NOW]){
   await setup();
   await lockPreview();
   expect(await returnToDraft(env.DB,at,PHRASE,ACTOR)).toMatchObject({kept_ballots:0,kept_participation:0});
   const row=await electionRow();
   expect(row.status_lock).toBe("draft");
   expect(row.frozen_hak_pilih).toBeNull();
   expect(row.frozen_at).toBeNull();
  }
 });
 it("mengembalikan Tutup Sekarang ke Draf dan membuang penutupan lebih awal beserta snapshotnya",async()=>{
  await lockPreview();
  await closeEarly(env.DB,OPEN_NOW,"rapat panitia");
  expect((await electionRow()).closing_snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
  const result=await returnToDraft(env.DB,OPEN_NOW,PHRASE,ACTOR);
  expect(result.stage_before).toBe("closed");
  const row=await electionRow();
  expect(row).toMatchObject({status_lock:"draft",closed_early_at:null,closing_snapshot_hash:null,closing_snapshot_at:null,opens_at:"2026-10-21T00:00:00.000Z",closes_at:"2026-10-22T00:00:00.000Z"});
  // Kunci ulang tidak mewarisi penutupan yang dibatalkan: tahapnya ikut jam.
  await lockElection(env.DB,cfg,OPEN_NOW,createServiceApiStub().fetchImpl);
  const relocked=await electionRow();
  expect(relocked.status_lock).toBe("locked");
  expect(relocked.closed_early_at).toBeNull();
  expect(stage(relocked as never,OPEN_NOW)).toBe("open");
 });
 it("mengembalikan pemilihan riil yang belum dibuka lalu menolak setelah pemungutan suara dibuka",async()=>{
  await lockReal();
  expect(await returnToDraft(env.DB,NOW,PHRASE,ACTOR)).toMatchObject({stage_before:"scheduled",kept_ballots:0});
  expect((await electionRow()).status_lock).toBe("draft");
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  for(const at of [OPEN_NOW,CLOSED_NOW]){
   const before=await electionRow(),tip=await auditTip();
   await expect(returnToDraft(env.DB,at,PHRASE,ACTOR)).rejects.toMatchObject({status:409,message:"Kembali ke Draf hanya tersedia sebelum pemungutan suara dibuka."});
   expect(await electionRow()).toEqual(before);
   expect(await auditTip()).toBe(tip);
  }
 });
 it("menolak kembali ke Draf setelah hasil diumumkan pada kedua mode",async()=>{
  for(const lock of [lockPreview,lockReal]){
   await setup();
   await lock();
   await publishResults(env.DB,CLOSED_NOW);
   const before=await electionRow(),tip=await auditTip();
   await expect(returnToDraft(env.DB,CLOSED_NOW,PHRASE,ACTOR)).rejects.toMatchObject({status:409,message:"Hasil sudah diumumkan; pemilihan tidak dapat kembali ke Draf."});
   expect(await electionRow()).toEqual(before);
   expect(await auditTip()).toBe(tip);
  }
 });
 it("menolak permintaan saat pemilihan sudah Draf",async()=>{
  const before=await electionRow();
  await expect(returnToDraft(env.DB,NOW,PHRASE,ACTOR)).rejects.toMatchObject({status:409,message:"Pemilihan sudah berada di Draf."});
  expect(await electionRow()).toEqual(before);
  expect(await auditCount()).toBe(0);
 });
 it("menolak frasa yang salah atau kosong tanpa mengubah baris pemilihan",async()=>{
  await lockPreview();
  const before=await electionRow(),tip=await auditTip();
  for(const phrase of ["","   ","kembali","KEMBALI KE DRAF!","kem bali ke draf",null,undefined,42]){
   await expect(returnToDraft(env.DB,NOW,phrase as unknown,ACTOR)).rejects.toMatchObject({status:400,message:"Frasa konfirmasi tidak sesuai."});
  }
  expect(await electionRow()).toEqual(before);
  expect(await auditTip()).toBe(tip);
 });
 it("menerima varian huruf besar/kecil dan spasi pada frasa",async()=>{
  for(const phrase of ["KEMBALI KE DRAF","kembali ke draf","  Kembali   ke\tDraf  "]){
   await setup();
   await lockPreview();
   await returnToDraft(env.DB,NOW,phrase,ACTOR);
   expect((await electionRow()).status_lock).toBe("draft");
  }
 });
 it("mempertahankan jadwal, pengaturan dan daftar Pemilih saat data tahap dibersihkan",async()=>{
  await lockPreview();
  await env.DB.prepare("UPDATE elections SET allow_admin_voting=0").run();
  await env.DB.prepare("INSERT INTO system_config(key,value) VALUES('pemilih_last_sync','2026-10-19T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  const lockRow=await electionRow();
  expect(lockRow.frozen_at).toBe(NOW.toISOString());
  const votersBefore=(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters").first<{n:number}>())!.n;
  await returnToDraft(env.DB,CLOSED_NOW,PHRASE,ACTOR);
  const row=await electionRow();
  expect(row).toMatchObject({status_lock:"draft",frozen_hak_pilih:null,frozen_at:null,closed_early_at:null,closing_snapshot_hash:null,closing_snapshot_at:null,preview_mode:1,allow_admin_voting:0,single_candidate_mode:0,title:"Election"});
  expect(row.opens_at).toBe("2026-10-21T00:00:00.000Z");
  expect(row.closes_at).toBe("2026-10-22T00:00:00.000Z");
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM voters").first<{n:number}>())!.n).toBe(votersBefore);
  expect(await env.DB.prepare("SELECT value FROM system_config WHERE key='pemilih_last_sync'").first()).toBeTruthy();
  // Pengaturan kembali dapat diubah dan kesiapan dihitung ulang dari baris pemilihan.
  await setSchedule(env.DB,NOW,{title:"Election baru",description:"",opens_at:OPEN_AT,closes_at:CLOSE_AT,preview_mode:true});
  expect((await getReadiness(env.DB,NOW)).every(check=>check.ok)).toBe(true);
 });
});

describe("POST /api/election/return-to-draft",()=>{
 beforeEach(()=>setup());
 async function post(memberId:string,body:unknown,sessionName=memberId){
  const cookie=await sealSession({member_id:memberId,name:sessionName,affiliation:"/ppij/test",auth_time:Math.floor(Date.now()/1000)},MASTER_KEY);
  return app.request("/api/election/return-to-draft",{method:"POST",headers:{cookie:`ppij_session=${cookie}`,"content-type":"application/json"},body:JSON.stringify(body)},BINDINGS);
 }
 async function readyRoute(){
  await env.DB.prepare("INSERT OR REPLACE INTO system_config(key,value) VALUES('initialized','1'),('site_scope','/ppij/test')").run();
 }
 it("menolak sesi non-Admin Voting tanpa mencatat apa pun",async()=>{
  await lockPreview();
  await readyRoute();
  const tip=await auditTip();
  // member-1 bukan Admin Voting, dan guard yang sama melindungi setiap rute panitia.
  expect((await post("member-1",{phrase:PHRASE})).status).toBe(403);
  expect((await electionRow()).status_lock).toBe("locked");
  expect(await auditTip()).toBe(tip);
 });
 it("meneruskan pelaku Admin Voting ke audit dan memetakan galat ke status HTTP",async()=>{
  await lockPreview();
  await readyRoute();
  const wrong=await post("member-8",{phrase:"salah"});
  expect(wrong.status).toBe(400);
  expect(await wrong.json()).toEqual({error:"Frasa konfirmasi tidak sesuai."});
  // Sesi produksi membawa UUID sebagai klaim nama; audit memakai nama tampilan roll.
  const memberUuid="8f14e45f-ceea-467a-9f3f-0d1c2b3a4c5d";
  const ok=await post("member-8",{phrase:PHRASE},memberUuid);
  expect(ok.status).toBe(200);
  // Rute memakai jam sistem; jadwal contoh sudah lewat, jadi tahap yang ditinggalkan Ditutup.
  expect(await ok.json()).toMatchObject({ok:true,kept_ballots:0,kept_participation:0,stage_before:"closed"});
  const entry=await env.DB.prepare("SELECT actor_type,actor_member_id,actor_name,action,target,detail_json FROM audit_log WHERE action='Pemilihan dikembalikan ke Draf'").first<Record<string,unknown>>();
  expect(entry).toMatchObject({actor_type:"admin",actor_member_id:"member-8",actor_name:"Member 8",action:"Pemilihan dikembalikan ke Draf",target:null});
  expect(JSON.stringify(entry)).not.toContain(memberUuid);
  expect(JSON.parse(String(entry!.detail_json))).toMatchObject({stage_before:"closed",kept_ballots:0,kept_participation:0});
  // Permintaan kedua ditolak sebagai 409 karena pemilihan sudah Draf.
  expect((await post("member-8",{phrase:PHRASE})).status).toBe(409);
 });
 it("tidak pernah menulis UUID sebagai nama pelaku saat roll belum punya nama",async()=>{
  await lockPreview();
  await readyRoute();
  // Admin tanpa baris roll dan klaim nama sesi berisi UUID: audit memakai label netral.
  await env.DB.prepare("DELETE FROM voters WHERE member_id='member-8'").run();
  const memberUuid="8f14e45f-ceea-467a-9f3f-0d1c2b3a4c5d";
  expect((await post("member-8",{phrase:PHRASE},memberUuid)).status).toBe(200);
  const entry=await env.DB.prepare("SELECT actor_member_id,actor_name FROM audit_log WHERE action='Pemilihan dikembalikan ke Draf'").first<{actor_member_id:string;actor_name:string}>();
  expect(entry).toEqual({actor_member_id:"member-8",actor_name:"Admin Voting"});
  expect(entry!.actor_name).not.toBe(memberUuid);
 });
});

describe("suara yang dipertahankan melewati Kunci berikutnya",()=>{
 beforeEach(()=>setup());
 it("membekukan Hak pilih baru, menyisakan suara lama, dan hanya menghapus data Uji Coba",async()=>{
  await ready();
  await env.DB.prepare("UPDATE voters SET can_vote=1").run();
  await setSchedule(env.DB,NOW,{title:"Election",description:"",opens_at:OPEN_AT,closes_at:CLOSE_AT,preview_mode:true});
  expect((await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl)).frozen_hak_pilih).toBe(8);
  // Suara nyata pembukaan sebelumnya: partisipasi dan surat suara tanpa penghubung.
  await env.DB.prepare("INSERT INTO participation(election_id,member_id,member_name,voted_at,is_test) VALUES(1,'member-1','Member 1','2026-10-21T01:00:00Z',0),(1,'member-2','Member 2','2026-10-21T01:05:00Z',0)").run();
  await env.DB.prepare("INSERT INTO ballots(id,election_id,candidate_id,komsat_path,receipt_hash,is_test) VALUES('kept-1',1,1,'/u','hash-1',0),('kept-2',1,2,'/u','hash-2',0)").run();
  const keptBallots=(await env.DB.prepare("SELECT * FROM ballots ORDER BY id").all()).results;
  const keptParticipation=(await env.DB.prepare("SELECT * FROM participation ORDER BY member_id").all()).results;
  expect(await returnToDraft(env.DB,OPEN_NOW,PHRASE,ACTOR)).toMatchObject({kept_ballots:2,kept_participation:2,stage_before:"open"});
  // Uji Coba setelah kembali adalah data uji, bukan suara nyata.
  await castTestVote(env.DB,NOW,1,"member-8");
  // Roll berubah sebelum Kunci berikutnya: satu pemilih yang sudah memilih hilang, satu anggota baru masuk.
  await env.DB.prepare("DELETE FROM voters WHERE member_id='member-2'").run();
  await env.DB.prepare("INSERT INTO voters(member_id,name,nickname,komsat_path,status,synced_at,member_number,can_vote) VALUES('member-9','Member 9','M9','/u','ACTIVE','now','KARTU-009',1)").run();
  const second=await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  // Hak pilih dibekukan ulang dari roll baru; hanya baris uji yang dibuang.
  expect(second).toEqual({frozen_hak_pilih:8,deleted_test_votes:1});
  expect(await env.DB.prepare("SELECT status_lock,frozen_hak_pilih,frozen_at FROM elections").first()).toEqual({status_lock:"locked",frozen_hak_pilih:8,frozen_at:NOW.toISOString()});
  expect((await env.DB.prepare("SELECT * FROM ballots ORDER BY id").all()).results).toEqual(keptBallots);
  expect((await env.DB.prepare("SELECT * FROM participation ORDER BY member_id").all()).results).toEqual(keptParticipation);
  const lockAudit=await env.DB.prepare("SELECT detail_json FROM audit_log WHERE action='Pemilihan dikunci' ORDER BY seq DESC LIMIT 1").first<{detail_json:string}>();
  expect(JSON.parse(lockAudit!.detail_json)).toMatchObject({frozen_hak_pilih:8,deleted_test_votes:1});
  // Anggota yang hilang dari roll baru tetap punya partisipasi tersimpan.
  expect((await env.DB.prepare("SELECT member_id FROM participation ORDER BY member_id").all<{member_id:string}>()).results).toEqual([{member_id:"member-1"},{member_id:"member-2"}]);
 });
});

// Mode kandidat tunggal beku selama ada suara tersimpan: makna surat suara
// ditentukan saat dicoblos dan tidak dapat ditulis ulang tanpa memautkannya ke
// pemilih. Data Uji Coba tidak pernah mengunci saklar.
describe("saklar mode kandidat tunggal dan suara tersimpan",()=>{
 beforeEach(()=>setup());
 const keptMessage=(n:number)=>`Mode kandidat tunggal tidak dapat diubah: ${n} suara tersimpan harus tetap dihitung dengan aturan yang sama.`;
 async function oneCandidate(){await env.DB.prepare("INSERT INTO candidates(id,member_id,number,name,nickname,komsat_path) VALUES(1,'member-1',1,'Member 1','M1','/u')").run();}
 async function keptBallots(count:number,isTest=0){for(let i=1;i<=count;i++)await env.DB.prepare("INSERT INTO ballots(id,election_id,candidate_id,komsat_path,receipt_hash,is_test) VALUES(?,1,1,'/u',?,?)").bind(`b-${isTest}-${i}`,`h-${isTest}-${i}`,isTest).run();}
 it("menolak menonaktifkan dan mengaktifkan saklar selama suara tersimpan ada",async()=>{
  await oneCandidate();
  await env.DB.prepare("UPDATE elections SET single_candidate_mode=1").run();
  await keptBallots(2);
  expect(await getSingleCandidateMode(env.DB)).toEqual({enabled:true,editable:false,kept_ballots:2,reason:keptMessage(2)});
  await expect(setSingleCandidateMode(env.DB,NOW,false,ACTOR)).rejects.toMatchObject({status:409,message:keptMessage(2)});
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:1});
  expect(await auditCount()).toBe(0);
  // Arah sebaliknya juga ditolak: surat suara pilihan-kandidat tidak boleh masuk hitungan Setuju/Tidak Setuju.
  await env.DB.prepare("UPDATE elections SET single_candidate_mode=0").run();
  await expect(setSingleCandidateMode(env.DB,NOW,true,ACTOR)).rejects.toMatchObject({status:409,message:keptMessage(2)});
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:0});
  expect(await auditCount()).toBe(0);
 });
 it("tetap dapat diubah saat hanya ada data Uji Coba, dan Uji Coba setelah kembali dibersihkan Kunci berikutnya",async()=>{
  await lockPreview();
  await returnToDraft(env.DB,OPEN_NOW,PHRASE,ACTOR);
  await castTestVote(env.DB,NOW,1,"member-8");
  expect(await getSingleCandidateMode(env.DB)).toEqual({enabled:false,editable:true,kept_ballots:0,reason:null});
  await setSingleCandidateMode(env.DB,NOW,false,ACTOR);
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:0});
  // Kunci berikutnya membuang data uji coba seperti biasa.
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots WHERE is_test=1").first()).toEqual({n:0});
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots").first()).toEqual({n:0});
 });
});

// Audit (design.md D7): satu entri berantai per tindakan diterima, tanpa entri
// untuk percobaan yang ditolak. Rantai hash diperiksa dari baris aslinya.
describe("audit Kembali ke Draf",()=>{
 beforeEach(()=>setup());
 async function rows(){return (await env.DB.prepare("SELECT seq,at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash FROM audit_log ORDER BY seq").all<AuditRow>()).results;}
 it("mencatat satu entri berantai dengan tahap yang ditinggalkan dan suara yang dipertahankan",async()=>{
  await lockPreview();
  await env.DB.prepare("INSERT INTO participation(election_id,member_id,member_name,voted_at,is_test) VALUES(1,'member-1','Member 1','2026-10-21T01:00:00Z',0),(1,'member-2','Member 2','2026-10-21T01:05:00Z',0)").run();
  await env.DB.prepare("INSERT INTO ballots(id,election_id,candidate_id,komsat_path,receipt_hash,is_test) VALUES('kept-1',1,1,'/u','hash-1',0),('kept-2',1,2,'/u','hash-2',0)").run();
  const tipBefore=(await rows()).at(-1)!.hash;
  await returnToDraft(env.DB,OPEN_NOW,PHRASE,ACTOR);
  const all=await rows();
  const entries=all.filter(row=>row.action==="Pemilihan dikembalikan ke Draf");
  expect(entries).toHaveLength(1);
  const entry=entries[0]!;
  expect(entry).toMatchObject({actor_type:"admin",actor_member_id:"member-8",actor_name:"Admin",target:null,komsat_path:null,prev_hash:tipBefore});
  expect(JSON.parse(entry.detail_json!)).toEqual({stage_before:"open",preview_mode:true,kept_ballots:2,kept_participation:2});
  expect(all.at(-1)).toEqual(entry);
  expect(await verifyChain(all)).toBeNull();
 });
 it("tidak menambah entri dan tidak menggeser ujung rantai untuk percobaan yang ditolak",async()=>{
  await lockReal();
  const before=await rows(),tip=before.at(-1)!.hash;
  await expect(returnToDraft(env.DB,OPEN_NOW,PHRASE,ACTOR)).rejects.toMatchObject({status:409});
  await expect(returnToDraft(env.DB,NOW,"salah",ACTOR)).rejects.toMatchObject({status:400});
  const after=await rows();
  expect(after).toHaveLength(before.length);
  expect(after.at(-1)!.hash).toBe(tip);
  expect(await verifyChain(after)).toBeNull();
 });
});

// Matriks desain D2 dipakai Pengaturan untuk menampilkan tombol; server tetap
// memeriksa ulang, jadi keduanya harus menjawab sama.
describe("matriks tampil tombol Kembali ke Draf",()=>{
 it("menawarkan tindakan hanya saat terkunci, dan pada pemilihan riil hanya sebelum dibuka",()=>{
  const opens="2026-10-21T00:00:00Z";
  const cases:[string,number,"scheduled"|"open"|"closed"|"published",boolean][]=[
   ["draft",0,"scheduled",false],["draft",1,"scheduled",false],
   ["locked",0,"scheduled",true],["locked",0,"open",false],["locked",0,"closed",false],
   ["locked",1,"scheduled",true],["locked",1,"open",true],["locked",1,"closed",true],
   ["published",0,"closed",false],["published",1,"closed",false],
  ];
  const when:{[stage:string]:Date}={scheduled:NOW,open:OPEN_NOW,closed:CLOSED_NOW};
  for(const [status_lock,preview_mode,left,expected] of cases){
   expect(canReturnToDraft({status_lock,preview_mode,opens_at:opens},when[left]!)).toBe(expected);
  }
 });
});

// Hitung Abstain (keputusan owner 2026-11-16, Q193): non-voters join Abstain only
// after Admin Voting runs the action by hand, once, after voting has closed.
async function lockSingle(preview=false){
 await readySingle();
 if(preview) await setSchedule(env.DB,NOW,{title:"Election",description:"",opens_at:OPEN_AT,closes_at:CLOSE_AT,preview_mode:true});
 await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
}
/** Dua suara nyata (satu Setuju, satu Abstain) tanpa menyentuh Hak pilih beku. */
async function castTwoReal(){
 for(const [member,choice] of [["member-3","setuju"],["member-4","abstain"]] as const){
  await env.DB.batch([
   env.DB.prepare("INSERT INTO participation(election_id,member_id,member_name,voted_at,is_test) VALUES(1,?,?,?,0)").bind(member,member,OPEN_NOW.toISOString()),
   env.DB.prepare("INSERT INTO ballots(id,election_id,candidate_id,komsat_path,receipt_hash,is_test,choice) VALUES(?,1,1,'/u',?,0,?)").bind(crypto.randomUUID(),`h-${member}`,choice),
  ]);
 }
}
describe("Hitung Abstain",()=>{
 beforeEach(()=>setup());
 it("menolak sebelum pemungutan suara ditutup tanpa mengubah baris atau menulis audit",async()=>{
  await lockSingle();
  const tip=await auditTip();
  for(const at of [NOW,OPEN_NOW]){
   await expect(countAbstain(env.DB,at,ACTOR)).rejects.toMatchObject({status:409,message:"Hitung Abstain baru tersedia setelah pemungutan suara ditutup."});
  }
  expect(await electionRow()).toMatchObject({abstain_counted_at:null,abstain_counted_count:null});
  expect(await auditTip()).toBe(tip);
  expect(await getAbstainCount(env.DB,OPEN_NOW)).toMatchObject({can_run:false,counted:false,stage:"open"});
 });
 it("menolak di luar mode kandidat tunggal",async()=>{
  await lockReal();
  await expect(countAbstain(env.DB,CLOSED_NOW,ACTOR)).rejects.toMatchObject({status:409,message:"Hitung Abstain hanya berlaku pada mode kandidat tunggal."});
  expect(await electionRow()).toMatchObject({abstain_counted_at:null,abstain_counted_count:null});
  expect(await actions()).not.toContain("Hitung Abstain dijalankan");
 });
 it("menyimpan angka agregat dan waktunya sekali, dengan satu entri audit yang menyebut angkanya",async()=>{
  await lockSingle();
  await castTwoReal();
  const frozen=(await electionRow())!.frozen_hak_pilih as number;
  const before=await getAbstainCount(env.DB,CLOSED_NOW);
  expect(before).toMatchObject({can_run:true,counted:false,pending_count:frozen-2,reason:null});
  const result=await countAbstain(env.DB,CLOSED_NOW,ACTOR);
  expect(result).toEqual({counted_count:frozen-2,counted_at:CLOSED_NOW.toISOString()});
  expect(await electionRow()).toMatchObject({abstain_counted_at:CLOSED_NOW.toISOString(),abstain_counted_count:frozen-2});
  const entry=await env.DB.prepare("SELECT actor_type,actor_member_id,actor_name,action,target,detail_json FROM audit_log WHERE action='Hitung Abstain dijalankan'").all<Record<string,unknown>>();
  expect(entry.results).toHaveLength(1);
  expect(entry.results[0]).toMatchObject({actor_type:"admin",actor_member_id:"member-8",actor_name:"Admin",target:null});
  expect(JSON.parse(String(entry.results[0]!.detail_json))).toEqual({tidak_memilih_ditambahkan:frozen-2});
  // Aggregate only: no member id, ballot reference or choice in the audit entry.
  expect(String(entry.results[0]!.detail_json)).not.toMatch(/member|ballot|setuju|abstain"/i);
  expect(await verifyChain((await env.DB.prepare("SELECT * FROM audit_log ORDER BY seq").all<AuditRow>()).results)).toBeNull();
 });
 it("hanya berjalan sekali: percobaan kedua ditolak tanpa mengubah angka atau audit",async()=>{
  await lockSingle();
  await castTwoReal();
  await countAbstain(env.DB,CLOSED_NOW,ACTOR);
  const tip=await auditTip(),row=await electionRow();
  await expect(countAbstain(env.DB,new Date(CLOSED_NOW.getTime()+60e3),ACTOR)).rejects.toMatchObject({status:409,message:"Hitung Abstain sudah dijalankan dan tidak dapat diulang."});
  expect(await electionRow()).toEqual(row);
  expect(await auditTip()).toBe(tip);
  expect(await getAbstainCount(env.DB,CLOSED_NOW)).toMatchObject({can_run:false,counted:true});
  // Permintaan serentak: tepat satu yang berhasil.
  await env.DB.prepare("UPDATE elections SET abstain_counted_at=NULL,abstain_counted_count=NULL").run();
  const results=await Promise.allSettled([countAbstain(env.DB,CLOSED_NOW,ACTOR),countAbstain(env.DB,CLOSED_NOW,ACTOR)]);
  expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);
 });
 it("berlaku juga setelah Tutup Sekarang",async()=>{
  await lockSingle();
  await closeEarly(env.DB,OPEN_NOW,"rapat panitia");
  await expect(countAbstain(env.DB,OPEN_NOW,ACTOR)).resolves.toMatchObject({counted_count:(await electionRow())!.frozen_hak_pilih});
 });
 it("menolak Umumkan di mode kandidat tunggal sebelum Hitung Abstain, lalu mengizinkannya sesudahnya",async()=>{
  await lockSingle();
  await castTwoReal();
  const tip=await auditTip();
  await expect(publishResults(env.DB,CLOSED_NOW)).rejects.toMatchObject({status:409,message:ABSTAIN_NOT_COUNTED_MESSAGE});
  expect((await electionRow())!.status_lock).toBe("locked");
  expect(await auditTip()).toBe(tip);
  await countAbstain(env.DB,CLOSED_NOW,ACTOR);
  await publishResults(env.DB,CLOSED_NOW);
  expect((await electionRow())!.status_lock).toBe("published");
  // Setelah diumumkan Hitung Abstain tidak dapat dijalankan lagi.
  await expect(countAbstain(env.DB,CLOSED_NOW,ACTOR)).rejects.toMatchObject({status:409});
 });
 it("tidak menggerbangi Umumkan di luar mode kandidat tunggal",async()=>{
  await lockReal();
  await publishResults(env.DB,CLOSED_NOW);
  expect((await electionRow())!.status_lock).toBe("published");
 });
 it("Kembali ke Draf (Pratinjau) mengosongkan angka dan waktu Hitung Abstain",async()=>{
  await lockSingle(true);
  await countAbstain(env.DB,CLOSED_NOW,ACTOR);
  expect((await electionRow())!.abstain_counted_at).not.toBeNull();
  await returnToDraft(env.DB,CLOSED_NOW,PHRASE,ACTOR);
  expect(await electionRow()).toMatchObject({status_lock:"draft",abstain_counted_at:null,abstain_counted_count:null});
  // Kunci berikutnya dapat dihitung lagi dari awal.
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  await expect(countAbstain(env.DB,CLOSED_NOW,ACTOR)).resolves.toMatchObject({counted_at:CLOSED_NOW.toISOString()});
 });
 describe("rute /api/election/abstain-count",()=>{
  async function call(method:"GET"|"POST",memberId:string){
   const cookie=await sealSession({member_id:memberId,name:memberId,affiliation:"/ppij/test",auth_time:Math.floor(Date.now()/1000)},MASTER_KEY);
   await env.DB.prepare("INSERT OR REPLACE INTO system_config(key,value) VALUES('initialized','1'),('site_scope','/ppij/test')").run();
   return app.request("/api/election/abstain-count",{method,headers:{cookie:`ppij_session=${cookie}`}},BINDINGS);
  }
  it("menolak sesi non-Admin Voting dan meneruskan pelaku Admin Voting ke audit",async()=>{
   await lockSingle();
   await castTwoReal();
   expect((await call("POST","member-1")).status).toBe(403);
   expect((await electionRow())!.abstain_counted_at).toBeNull();
   const state=await call("GET","member-8");
   expect(state.status).toBe(200);
   // Jadwal contoh sudah lewat menurut jam sistem, jadi tahap Ditutup.
   const frozen=(await electionRow())!.frozen_hak_pilih as number;
   expect(await state.json()).toMatchObject({stage:"closed",can_run:true,pending_count:frozen-2});
   const ok=await call("POST","member-8");
   expect(ok.status).toBe(200);
   expect(await ok.json()).toMatchObject({ok:true,counted_count:frozen-2});
   const entry=await env.DB.prepare("SELECT actor_member_id,actor_name FROM audit_log WHERE action='Hitung Abstain dijalankan'").first();
   expect(entry).toMatchObject({actor_member_id:"member-8",actor_name:"Member 8"});
   expect((await call("POST","member-8")).status).toBe(409);
  });
 });
});
describe("Tidak Membekukan DPT",()=>{
 beforeEach(()=>setup());
 it("mengaktifkan dan menonaktifkan saklar saat Draf dengan satu entri audit per permintaan",async()=>{
  expect(await getLiveVoterRollMode(env.DB)).toMatchObject({enabled:false,editable:true,reason:null});
  await setLiveVoterRollMode(env.DB,NOW,true,{member_id:"member-8",name:"Admin"});
  expect(await env.DB.prepare("SELECT live_voter_roll FROM elections").first()).toEqual({live_voter_roll:1});
  expect(await getLiveVoterRollMode(env.DB)).toMatchObject({enabled:true,editable:true});
  const entry=await env.DB.prepare("SELECT actor_type,actor_member_id,actor_name,target,detail_json FROM audit_log ORDER BY seq LIMIT 1").first<Record<string,unknown>>();
  expect(entry).toEqual({actor_type:"admin",actor_member_id:"member-8",actor_name:"Admin",target:null,detail_json:JSON.stringify({live_voter_roll:true})});
  await setLiveVoterRollMode(env.DB,NOW,false);
  expect(await env.DB.prepare("SELECT live_voter_roll FROM elections").first()).toEqual({live_voter_roll:0});
  const actions=await env.DB.prepare("SELECT action FROM audit_log ORDER BY seq").all<{action:string}>();
  expect(actions.results.map(row=>row.action)).toEqual(["Tidak Membekukan DPT diaktifkan","Tidak Membekukan DPT dinonaktifkan"]);
  expect((await env.DB.prepare("SELECT detail_json FROM audit_log ORDER BY seq").all<{detail_json:string}>()).results[1]!.detail_json).toBe(JSON.stringify({live_voter_roll:false}));
 });
 it("menolak perubahan saklar setelah Kunci tanpa entri audit",async()=>{
  await env.DB.prepare("UPDATE elections SET status_lock='locked',live_voter_roll=1").run();
  await expect(setLiveVoterRollMode(env.DB,NOW,false)).rejects.toThrow("saat Draf");
  expect(await env.DB.prepare("SELECT live_voter_roll FROM elections").first()).toEqual({live_voter_roll:1});
  expect(await auditCount()).toBe(0);
  expect(await getLiveVoterRollMode(env.DB)).toMatchObject({enabled:true,editable:false,reason:"Nilai ini dibekukan setelah Kunci & Jadwalkan."});
 });
 it("mengunci tanpa membekukan roll saat saklar menyala dan mencatat nilai beku plus jumlah view di audit Kunci",async()=>{
  await readySingle();
  await setLiveVoterRollMode(env.DB,NOW,true);
  const result=await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  expect(result.frozen_hak_pilih).toBeUndefined();
  const row=await electionRow();
  expect(row).toMatchObject({status_lock:"locked",live_voter_roll:1,frozen_at:null,frozen_hak_pilih:null});
  // Suara uji coba tetap dibuang dan warna tetap dibagi saat saklar menyala.
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots WHERE is_test=1").first()).toEqual({n:0});
  const lockAudit=await env.DB.prepare("SELECT detail_json FROM audit_log WHERE action='Pemilihan dikunci'").first<{detail_json:string}>();
  const detail=JSON.parse(lockAudit!.detail_json);
  expect(detail).toMatchObject({live_voter_roll:true,single_candidate_mode:true});
  expect(detail.portal_view_count).toBeGreaterThan(0);
  expect(detail.frozen_hak_pilih).toBeUndefined();
 });
 it("Kunci gagal saat sinkronisasi final gagal meski saklar menyala",async()=>{
  await readySingle();
  await setLiveVoterRollMode(env.DB,NOW,true);
  await expect(lockElection(env.DB,cfg,NOW,createServiceApiStub({mode:"fail_page_n"}).fetchImpl)).rejects.toMatchObject({status:503});
  expect(await electionRow()).toMatchObject({status_lock:"draft"});
  // Hanya entri audit saklar dari persiapan; tidak ada entri Kunci.
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='Pemilihan dikunci'").first<{n:number}>())!.n).toBe(0);
 });
 it("mencatat live_voter_roll false pada audit Kunci saat saklar mati",async()=>{
  await ready();
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  const lockAudit=await env.DB.prepare("SELECT detail_json FROM audit_log WHERE action='Pemilihan dikunci'").first<{detail_json:string}>();
  expect(JSON.parse(lockAudit!.detail_json)).toMatchObject({live_voter_roll:false});
  expect((await electionRow()).frozen_hak_pilih).toBeGreaterThan(0);
 });
 it("menetapkan Hak pilih akhir pada pembacaan pertama setelah Ditutup, sekali, dengan satu entri audit",async()=>{
  await readySingle();
  await setLiveVoterRollMode(env.DB,NOW,true);
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  const viewCount=(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE can_vote=1").first<{n:number}>())!.n;
  await env.DB.prepare("UPDATE elections SET closes_at=?").bind(NOW.toISOString()).run();
  expect(await env.DB.prepare("SELECT closing_hak_pilih FROM elections").first()).toEqual({closing_hak_pilih:null});
  const board=await getPublicBoard(env.DB,CLOSED_NOW);
  expect(board).not.toBeNull();
  expect(await env.DB.prepare("SELECT closing_hak_pilih,closing_hak_pilih_at FROM elections").first()).toEqual({closing_hak_pilih:viewCount,closing_hak_pilih_at:CLOSED_NOW.toISOString()});
  const entries=await env.DB.prepare("SELECT action,detail_json FROM audit_log WHERE action='Hak pilih akhir disimpan'").all<{action:string;detail_json:string}>();
  expect(entries.results).toEqual([{action:"Hak pilih akhir disimpan",detail_json:JSON.stringify({hak_pilih:viewCount})}]);
  // Pembacaan berikutnya tidak menulis apa pun lagi.
  await getPublicBoard(env.DB,CLOSED_NOW);
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='Hak pilih akhir disimpan'").first<{n:number}>())!.n).toBe(1);
 });
 it("tidak pernah menulis Hak pilih akhir saat saklar mati",async()=>{
  await readySingle();
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  await env.DB.prepare("UPDATE elections SET closes_at=?").bind(NOW.toISOString()).run();
  const board=await getPublicBoard(env.DB,CLOSED_NOW);
  expect(board).not.toBeNull();
  expect(await env.DB.prepare("SELECT closing_hak_pilih,closing_hak_pilih_at FROM elections").first()).toEqual({closing_hak_pilih:null,closing_hak_pilih_at:null});
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='Hak pilih akhir disimpan'").first<{n:number}>())!.n).toBe(0);
 });
 it("menyimpan Hak pilih akhir dalam batch Tutup Sekarang saat saklar menyala, dengan dua entri audit berantai",async()=>{
  await readySingle();
  await setLiveVoterRollMode(env.DB,NOW,true);
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  await env.DB.prepare("UPDATE elections SET closes_at=?").bind(CLOSE_AT).run();
  const tipBefore=await auditTip();
  await closeEarly(env.DB,OPEN_NOW,"rapat panitia");
  const row=await electionRow();
  expect(row.closed_early_at).toBe(OPEN_NOW.toISOString());
  expect(row.closing_hak_pilih).toBe((await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE can_vote=1").first<{n:number}>())!.n);
  expect(row.closing_hak_pilih_at).toBe(OPEN_NOW.toISOString());
  const entries=await env.DB.prepare("SELECT action,prev_hash,hash FROM audit_log ORDER BY seq").all<{action:string;prev_hash:string;hash:string}>();
  const closed=entries.results.find(entry=>entry.action==="Pemilihan ditutup lebih awal")!;
  const saved=entries.results.find(entry=>entry.action==="Hak pilih akhir disimpan")!;
  expect(closed.prev_hash).toBe(tipBefore);
  expect(saved.prev_hash).toBe(closed.hash);
  // Pembacaan pertama setelahnya tidak menulis ulang.
  await getPublicBoard(env.DB,CLOSED_NOW);
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='Hak pilih akhir disimpan'").first<{n:number}>())!.n).toBe(1);
 });
 it("Tutup Sekarang saat saklar mati tidak menyentuh kolom Hak pilih akhir",async()=>{
  await readySingle();
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  await env.DB.prepare("UPDATE elections SET closes_at=?").bind(CLOSE_AT).run();
  await closeEarly(env.DB,OPEN_NOW,"rapat panitia");
  const row=await electionRow();
  expect(row.closed_early_at).toBe(OPEN_NOW.toISOString());
  expect(row.closing_hak_pilih).toBeNull();
  expect(row.closing_hak_pilih_at).toBeNull();
  const actions=await env.DB.prepare("SELECT action FROM audit_log ORDER BY seq").all<{action:string}>();
  expect(actions.results.map(entry=>entry.action)).not.toContain("Hak pilih akhir disimpan");
 });
 it("Hitung Abstain memakai Hak pilih akhir yang tersimpan, bukan hitungan live",async()=>{
  await readySingle();
  await setLiveVoterRollMode(env.DB,NOW,true);
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  await castTwoReal();
  await env.DB.prepare("UPDATE elections SET closes_at=?").bind(NOW.toISOString()).run();
  const saved=(await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE can_vote=1").first<{n:number}>())!.n;
  const state=await getAbstainCount(env.DB,CLOSED_NOW);
  expect(state.pending_count).toBe(saved-2);
  expect((await electionRow()).closing_hak_pilih).toBe(saved);
  // Roll live berubah setelah penutupan tidak menggerakkan angka yang tersimpan.
  await env.DB.prepare("DELETE FROM voters WHERE member_id='member-5'").run();
  expect((await getAbstainCount(env.DB,CLOSED_NOW)).pending_count).toBe(saved-2);
  const result=await countAbstain(env.DB,CLOSED_NOW,ACTOR);
  expect(result.counted_count).toBe(saved-2);
 });
 it("Kembali ke Draf mengosongkan Hak pilih akhir tetapi menyimpan nilai saklar",async()=>{
  await readySingle();
  await setLiveVoterRollMode(env.DB,NOW,true);
  await setSchedule(env.DB,NOW,{title:"Election",description:"",opens_at:OPEN_AT,closes_at:CLOSE_AT,preview_mode:true});
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  await env.DB.prepare("UPDATE elections SET closes_at=?").bind(NOW.toISOString()).run();
  await getAbstainCount(env.DB,CLOSED_NOW);
  expect((await electionRow()).closing_hak_pilih).not.toBeNull();
  await returnToDraft(env.DB,CLOSED_NOW,PHRASE,ACTOR);
  expect(await electionRow()).toMatchObject({status_lock:"draft",closing_hak_pilih:null,closing_hak_pilih_at:null,live_voter_roll:1});
 });
});


// Undangan Langsung di siklus pemilihan: tautan tidak pernah masuk angka beku,
// dicatat terpisah di audit Kunci, dan bertahan melewati Kembali ke Draf.
describe("Undangan Langsung dalam siklus pemilihan",()=>{
 beforeEach(()=>setup());
 async function invite(reference:string,extra:{used?:boolean;cancelled?:boolean}={}){
  await env.DB.prepare("INSERT INTO direct_invitations(reference,token_hash,token_enc,created_at,created_by,created_by_name,used_at,cancelled_at) VALUES(?,?,?,?, 'member-8','Admin',?,?)")
   .bind(reference,`hash-${reference}`,"v1:sealed:sealed",NOW.toISOString(),extra.used?NOW.toISOString():null,extra.cancelled?NOW.toISOString():null).run();
 }
 it("mencatat tautan aktif terpisah dari roll beku di audit Kunci",async()=>{
  await ready();
  await invite("INV001");
  await invite("INV002");
  const result=await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  const roll=await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE can_vote=1").first<{n:number}>();
  // Nilai beku tetap hanya suku roll; tautan tidak pernah dibekukan ke dalamnya.
  expect(result.frozen_hak_pilih).toBe(roll!.n);
  expect(await env.DB.prepare("SELECT frozen_hak_pilih FROM elections").first()).toEqual({frozen_hak_pilih:roll!.n});
  const lockAudit=await env.DB.prepare("SELECT detail_json FROM audit_log WHERE action='Pemilihan dikunci'").first<{detail_json:string}>();
  expect(JSON.parse(lockAudit!.detail_json)).toMatchObject({active_direct_links:2});
 });
 it("menjaga status tautan melewati Kembali ke Draf dan Kunci berikutnya",async()=>{
  await ready();
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  await invite("INV001");
  await invite("INV002",{used:true});
  await invite("INV003",{cancelled:true});
  await returnToDraft(env.DB,NOW,"KEMBALI KE DRAF",{member_id:"member-8",name:"Admin"});
  const afterReturn=await env.DB.prepare("SELECT reference,used_at,cancelled_at FROM direct_invitations ORDER BY reference").all<{reference:string;used_at:string|null;cancelled_at:string|null}>();
  expect(afterReturn.results.map(r=>[r.reference,Boolean(r.used_at),Boolean(r.cancelled_at)])).toEqual([["INV001",false,false],["INV002",true,false],["INV003",false,true]]);
  expect(await env.DB.prepare("SELECT status_lock FROM elections").first()).toEqual({status_lock:"draft"});
  await lockElection(env.DB,cfg,NOW,createServiceApiStub().fetchImpl);
  const afterLock=await env.DB.prepare("SELECT reference,used_at,cancelled_at FROM direct_invitations ORDER BY reference").all<{reference:string;used_at:string|null;cancelled_at:string|null}>();
  expect(afterLock.results).toEqual(afterReturn.results);
 });
});
