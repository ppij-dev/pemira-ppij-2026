import { beforeEach,describe,expect,it } from "vitest";
import { env,reset } from "cloudflare:test";
import base from "../migrations/0001_init.sql?raw";
import units from "../migrations/0002_units.sql?raw";
import lock from "../migrations/0003_election_lock.sql?raw";
import preview from "../migrations/0006_preview_mode.sql?raw";
import intro from "../migrations/0007_candidate_short_intro.sql?raw";
import memberNumber from "../migrations/0008_member_number.sql?raw";
import singleModeSql from "../migrations/0011_single_candidate_mode.sql?raw";
import {createCandidate,deleteCandidate,listCandidates,updateCandidate} from "../src/server/election/candidates";
import {candidateProfileHref,resolveCandidateProfile} from "../src/server/election/profile";

// Nomor kartu portal adalah referensi kandidat resmi; member_id hanya jalan
// cadangan di Mode Pratinjau untuk anggota yang belum punya nomor kartu.
const CARD_1="OKA-2026-0001",CARD_2="OKA-2026-0002",CARD_4="OKA-2026-0004";
const NO_CARD_ID="11111111-1111-1111-1111-111111111111";
const CARDED_UUID="44444444-4444-4444-4444-444444444444";
const insertVoterSql="INSERT INTO voters(member_id,name,komsat_path,status,synced_at,member_number) VALUES";
beforeEach(async()=>{
 await reset();
 await env.DB.batch([base,units,lock,preview,intro,memberNumber,singleModeSql].flatMap(sql=>sql.split(";").map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s))));
 await env.DB.prepare("INSERT INTO elections(id) VALUES(1)").run();
 await env.DB.prepare(`${insertVoterSql}('v1','Voter','/u','ACTIVE','now','${CARD_1}'),('v2','Other','/u','ACTIVE','now','${CARD_2}'),('${NO_CARD_ID}','Tanpa Kartu','/u','ACTIVE','now',NULL),('${CARDED_UUID}','Punya Kartu','/u','ACTIVE','now','${CARD_4}')`).run();
});
const now=new Date("2026-10-20T00:00:00Z");
const candidate=(member_id:string,number:number,nickname:string)=>({member_id,number,name:`Name ${number}`,nickname,description:"<b>plain</b>"});
describe("mode kandidat tunggal",()=>{
 const enableMode=()=>env.DB.prepare("UPDATE elections SET single_candidate_mode=1").run();
 const noNumber=(member_id:string,nickname:string)=>({member_id,name:"Name",nickname,description:""});
 it("menolak kandidat kedua saat mode hidup dan menyebut mode",async()=>{
  await enableMode();
  expect(await createCandidate(env.DB,now,noNumber(CARD_1,"One"))).toMatchObject({number:1});
  await expect(createCandidate(env.DB,now,noNumber(CARD_2,"Two")))
   .rejects.toThrow("Mode kandidat tunggal aktif: hanya satu kandidat yang dapat didaftarkan.");
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM candidates").first()).toEqual({n:1});
  // Penghapusan tetap boleh, sehingga daftar bisa dikurangi lalu diisi ulang.
  await deleteCandidate(env.DB,now,1);
  expect(await createCandidate(env.DB,now,noNumber(CARD_2,"Two"))).toMatchObject({number:1});
 });
 it("menyimpan nomor urut internal 1 saat mode hidup dan mengabaikan nomor dari form",async()=>{
  await enableMode();
  // Form mode kandidat tunggal tidak mengirim nomor urut sama sekali.
  expect(await createCandidate(env.DB,now,noNumber(CARD_1,"One"))).toMatchObject({number:1});
  await deleteCandidate(env.DB,now,1);
  // Nomor yang tetap terkirim tidak pernah dipakai saat mode hidup.
  expect(await createCandidate(env.DB,now,{...candidate(CARD_1,7,"One")})).toMatchObject({number:1});
  // Nomor tersimpan tidak ditulis ulang oleh pembaruan di mode hidup.
  expect(await updateCandidate(env.DB,now,1,{...candidate(CARD_1,9,"One")})).toMatchObject({number:1});
 });
 it("mempertahankan nomor urut tersimpan kandidat yang sudah terdaftar",async()=>{
  // Terdaftar saat mode mati dengan nomor 3.
  expect(await createCandidate(env.DB,now,candidate(CARD_1,3,"One"))).toMatchObject({number:3});
  await enableMode();
  // Tetap 3 walau mode hidup dan form tidak mengirim nomor urut.
  expect(await updateCandidate(env.DB,now,1,noNumber(CARD_1,"One"))).toMatchObject({number:3});
  expect((await listCandidates(env.DB))[0]).toMatchObject({number:3});
 });
 it("tidak mengubah aturan nomor urut saat mode mati",async()=>{
  // Nomor urut tetap wajib bilangan bulat positif dan unik saat mode mati.
  for(const number of [0,-1,1.5,undefined,NaN]){
   await expect(createCandidate(env.DB,now,{...candidate(CARD_1,1,"One"),number:number as number})).rejects.toMatchObject({status:400});
  }
  expect(await createCandidate(env.DB,now,candidate(CARD_1,2,"Two"))).toMatchObject({number:2});
  await expect(createCandidate(env.DB,now,candidate(CARD_2,2,"Three"))).rejects.toThrow("Nomor urut/Nickname");
 });
});

describe("URL profil kandidat",()=>{
 it("memakai /kandidat/<nickname> hanya saat mode hidup",()=>{
  expect(candidateProfileHref({number:3,nickname:"Budi Santoso"},true)).toBe("/kandidat/Budi%20Santoso");
  expect(candidateProfileHref({number:3,nickname:"Budi Santoso"},false)).toBe("/kandidat/3-Budi%20Santoso");
 });
 it("mencari profil lewat nickname saat mode hidup dan lewat nomor-nickname saat mode mati",async()=>{
  for(const number of [1,2]) await createCandidate(env.DB,now,candidate(number===1?CARD_1:CARD_2,number,number===1?"Budi":"Sari"));
  expect((await resolveCandidateProfile(env.DB,"2-Sari",false))?.nickname).toBe("Sari");
  expect(await resolveCandidateProfile(env.DB,"Sari",false)).toBeNull();
  expect(await resolveCandidateProfile(env.DB,"2-Sari",false)).toMatchObject({number:2,komsat_path:"/u"});
  // Mode hidup: tanpa segmen nomor, pencarian lewat nickname (tanpa peduli huruf besar/kecil).
  await env.DB.prepare("DELETE FROM candidates WHERE number=2").run();
  await env.DB.prepare("UPDATE elections SET single_candidate_mode=1").run();
  expect(await resolveCandidateProfile(env.DB,"1-Budi",true)).toBeNull();
  expect(await resolveCandidateProfile(env.DB,"budi",true)).toMatchObject({number:1,name:"Name 1",description:"<b>plain</b>"});
 });
});

describe("candidate Draf CRUD",()=>{
 it("keeps the card introduction separate and preserves it when omitted from an update",async()=>{
  const input={...candidate(CARD_1,1,"One"),short_intro:"  Layanan anggota\nlebih dekat.  "};
  expect(await createCandidate(env.DB,now,input)).toMatchObject({short_intro:"Layanan anggota lebih dekat.",description:"<b>plain</b>"});
  await updateCandidate(env.DB,now,1,{...candidate(CARD_1,1,"One"),description:"Artikel lengkap"});
  expect((await listCandidates(env.DB))[0]).toMatchObject({short_intro:"Layanan anggota lebih dekat.",description:"Artikel lengkap"});
  expect(await updateCandidate(env.DB,now,1,{...input,short_intro:""})).toMatchObject({short_intro:""});
 });
 it("accepts 100 characters as literal text and rejects invalid introductions before writing",async()=>{
  for(const short_intro of ["a".repeat(101),null,23]){
   await expect(createCandidate(env.DB,now,{...candidate(CARD_1,1,"One"),short_intro:short_intro as string})).rejects.toMatchObject({status:400});
  }
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM candidates").first()).toEqual({n:0});
  const input={...candidate(CARD_1,1,"One"),short_intro:"界".repeat(100)};
  expect(await createCandidate(env.DB,now,input)).toMatchObject({short_intro:input.short_intro});
  await expect(updateCandidate(env.DB,now,1,{...input,short_intro:"x".repeat(101)})).rejects.toMatchObject({status:400});
  expect((await listCandidates(env.DB))[0]).toMatchObject({short_intro:input.short_intro});
  expect(await updateCandidate(env.DB,now,1,{...input,short_intro:"<b>Intro</b>"})).toMatchObject({short_intro:"<b>Intro</b>"});
 });
 it("copies the roll, stores description literally, and permits updates/deletes",async()=>{const made=await createCandidate(env.DB,now,candidate(CARD_1,1,"One"));expect(made).toMatchObject({description:"<b>plain</b>",komsat_path:"/u",member_id:"v1"});await updateCandidate(env.DB,now,1,{number:1,name:"Changed",nickname:"changed",description:"text"});expect(await env.DB.prepare("SELECT description FROM candidates WHERE id=1").first()).toEqual({description:"text"});await deleteCandidate(env.DB,now,1);expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM candidates").first()).toEqual({n:0});});
 it("resolves the candidate by the portal card number and exposes it in the list",async()=>{const made=await createCandidate(env.DB,now,candidate(CARD_1,1,"One"));expect(made).toMatchObject({member_id:"v1"});expect((await listCandidates(env.DB))[0]).toMatchObject({member_number:CARD_1});expect(await updateCandidate(env.DB,now,Number(made!.id),{...candidate(CARD_2,2,"Two")})).toMatchObject({member_id:"v2"});});
 it("rejects duplicate number/nickname, admin candidates, and non-roll members",async()=>{await createCandidate(env.DB,now,candidate(CARD_1,1,"One"));await expect(createCandidate(env.DB,now,candidate(CARD_2,1,"Two"))).rejects.toThrow("Nomor urut/Nickname");await expect(createCandidate(env.DB,now,candidate(CARD_2,2,"oNE"))).rejects.toThrow("Nomor urut/Nickname");await env.DB.prepare("INSERT INTO admin_voting(member_id,name,created_at) VALUES('v2','Admin','now')").run();await expect(createCandidate(env.DB,now,candidate(CARD_2,2,"Two"))).rejects.toThrow("Admin Voting tidak dapat menjadi kandidat");await expect(createCandidate(env.DB,now,candidate("missing",2,"Two"))).rejects.toThrow("tidak ada di daftar");});
 it("accepts a member id only in preview mode and only when the roll row has no card number",async()=>{
  // Di luar Mode Pratinjau: hanya nomor kartu. Pesannya sama untuk id yang ada
  // maupun yang tidak ada, jadi tidak membocorkan keanggotaan.
  await expect(createCandidate(env.DB,now,candidate(NO_CARD_ID,1,"One"))).rejects.toThrow("Gunakan nomor kartu anggota");
  await expect(createCandidate(env.DB,now,candidate("99999999-9999-9999-9999-999999999999",1,"One"))).rejects.toThrow("Gunakan nomor kartu anggota");
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM candidates").first()).toEqual({n:0});
  await env.DB.prepare("UPDATE elections SET preview_mode=1").run();
  expect(await createCandidate(env.DB,now,candidate(NO_CARD_ID,1,"One"))).toMatchObject({member_id:NO_CARD_ID,komsat_path:"/u"});
  // Baris yang sudah punya nomor kartu tetap harus memakai nomor kartunya.
  await expect(createCandidate(env.DB,now,candidate(CARDED_UUID,2,"Two"))).rejects.toThrow("Gunakan nomor kartu anggota");
  expect(await createCandidate(env.DB,now,candidate(CARD_2,2,"Two"))).toMatchObject({member_id:"v2"});
 });
 it("rejects create, update, and delete after lock",async()=>{const made=await createCandidate(env.DB,now,candidate(CARD_1,1,"One"));await env.DB.prepare("UPDATE elections SET status_lock='locked'").run();await expect(createCandidate(env.DB,now,candidate(CARD_2,2,"Two"))).rejects.toThrow();await expect(updateCandidate(env.DB,now,Number(made!.id),candidate(CARD_1,1,"Changed"))).rejects.toThrow();await expect(deleteCandidate(env.DB,now,Number(made!.id))).rejects.toThrow();});
});
