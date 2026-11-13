import {beforeEach,describe,expect,it} from "vitest";
import {env,reset} from "cloudflare:test";
import base from "../migrations/0001_init.sql?raw";import units from "../migrations/0002_units.sql?raw";import lock from "../migrations/0003_election_lock.sql?raw";import snapshot from "../migrations/0005_closing_snapshot.sql?raw";import preview from "../migrations/0006_preview_mode.sql?raw";import memberNumber from "../migrations/0008_member_number.sql?raw";import categorySql from "../migrations/0009_voter_category.sql?raw";import canVoteSql from "../migrations/0010_voter_can_vote.sql?raw";
import {createCandidate} from "../src/server/election/candidates";
import intro from "../migrations/0007_candidate_short_intro.sql?raw";import singleModeSql from "../migrations/0011_single_candidate_mode.sql?raw";import ballotChoiceSql from "../migrations/0012_ballot_choice.sql?raw";
import {castTestVote,closeEarly,extendClosing,getReadiness,getSingleCandidateMode,lockElection,publishResults,setSchedule,setSingleCandidateMode} from "../src/server/election/lifecycle";
import {createServiceApiStub} from "./lib/serviceapi-fixture";
const NOW=new Date("2026-10-20T00:00:00Z");const cfg={issuer:"https://fixture.invalid",clientId:"client",clientSecret:"secret",serviceApiUrl:"https://fixture.invalid"};
async function setup(allow=1){await reset();await env.DB.batch([base,units,lock,snapshot,preview,memberNumber,categorySql,canVoteSql,intro,singleModeSql,ballotChoiceSql].flatMap(sql=>sql.split(";").map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s))));await env.DB.prepare("INSERT INTO elections(id,allow_admin_voting) VALUES(1,?)").bind(allow).run();await env.DB.prepare("INSERT INTO admin_voting(member_id,name,created_at) VALUES('member-8','Admin','now')").run();}
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
  expect(await getSingleCandidateMode(env.DB)).toEqual({enabled:false,editable:true});
  await setSingleCandidateMode(env.DB,NOW,true);
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:1});
  expect(await getSingleCandidateMode(env.DB)).toEqual({enabled:true,editable:true});
  expect(await actions()).toEqual(["Mode kandidat tunggal diaktifkan"]);
  await setSingleCandidateMode(env.DB,NOW,false);
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:0});
  expect(await actions()).toEqual(["Mode kandidat tunggal diaktifkan","Mode kandidat tunggal dinonaktifkan"]);
  // Entri audit hanya mencatat tindakan panitia, tanpa anggota atau surat suara.
  const detail=await env.DB.prepare("SELECT actor_type,target,komsat_path,detail_json FROM audit_log ORDER BY seq LIMIT 1").first<Record<string,unknown>>();
  expect(detail).toEqual({actor_type:"admin",target:null,komsat_path:null,detail_json:JSON.stringify({single_candidate_mode:true})});
 });
 it("menolak perubahan mode setelah Kunci tanpa entri audit",async()=>{
  await env.DB.prepare("UPDATE elections SET status_lock='locked',single_candidate_mode=1").run();
  await expect(setSingleCandidateMode(env.DB,NOW,false)).rejects.toThrow("saat Draf");
  expect(await env.DB.prepare("SELECT single_candidate_mode FROM elections").first()).toEqual({single_candidate_mode:1});
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first()).toEqual({n:0});
  // Halaman menampilkan saklar sebagai baca-saja setelah Draf.
  expect(await getSingleCandidateMode(env.DB)).toEqual({enabled:true,editable:false});
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
  // Rehearsal surat suara tunggal: panitia memilih salah satu jawaban.
  const test=await castTestVote(env.DB,NOW,1,"member-8","abstain");
  expect(test.receipt_hash).toMatch(/^[0-9a-f]{64}$/);
  const testBallot=await env.DB.prepare("SELECT candidate_id,choice,is_test FROM ballots").first();
  expect(testBallot).toEqual({candidate_id:1,choice:"abstain",is_test:1});
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM participation WHERE is_test=1").first()).toEqual({n:1});
  // Suara uji tanpa pilihan sah ditolak dan tidak menulis apa pun.
  await env.DB.prepare("DELETE FROM participation WHERE is_test=1").run();
  await env.DB.prepare("DELETE FROM ballots WHERE is_test=1").run();
  await expect(castTestVote(env.DB,NOW,1,"member-8")).rejects.toMatchObject({status:400});
  await expect(castTestVote(env.DB,NOW,1,"member-8","setuju-banget")).rejects.toMatchObject({status:400});
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots").first()).toEqual({n:0});
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
