import { beforeEach,describe,expect,it } from "vitest";
import { env,reset } from "cloudflare:test";
import base from "../migrations/0001_init.sql?raw";
import units from "../migrations/0002_units.sql?raw";
import lock from "../migrations/0003_election_lock.sql?raw";
import intro from "../migrations/0007_candidate_short_intro.sql?raw";
import {createCandidate,deleteCandidate,listCandidates,updateCandidate} from "../src/server/election/candidates";

beforeEach(async()=>{await reset();await env.DB.batch([base,units,lock,intro].flatMap(sql=>sql.split(";").map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s))));await env.DB.prepare("INSERT INTO elections(id) VALUES(1)").run();await env.DB.prepare("INSERT INTO voters(member_id,name,komsat_path,status,synced_at) VALUES('v1','Voter','/u','ACTIVE','now'),('v2','Other','/u','ACTIVE','now')").run();});
const now=new Date("2026-10-20T00:00:00Z");
const candidate=(member_id:string,number:number,nickname:string)=>({member_id,number,name:`Name ${number}`,nickname,description:"<b>plain</b>"});
describe("candidate Draf CRUD",()=>{
 it("keeps the card introduction separate and preserves it when omitted from an update",async()=>{
  const input={...candidate("v1",1,"One"),short_intro:"  Layanan anggota\nlebih dekat.  "};
  expect(await createCandidate(env.DB,now,input)).toMatchObject({short_intro:"Layanan anggota lebih dekat.",description:"<b>plain</b>"});
  await updateCandidate(env.DB,now,1,{...candidate("v1",1,"One"),description:"Artikel lengkap"});
  expect((await listCandidates(env.DB))[0]).toMatchObject({short_intro:"Layanan anggota lebih dekat.",description:"Artikel lengkap"});
  expect(await updateCandidate(env.DB,now,1,{...input,short_intro:""})).toMatchObject({short_intro:""});
 });
 it("accepts 100 characters as literal text and rejects invalid introductions before writing",async()=>{
  for(const short_intro of ["a".repeat(101),null,23]){
   await expect(createCandidate(env.DB,now,{...candidate("v1",1,"One"),short_intro:short_intro as string})).rejects.toMatchObject({status:400});
  }
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM candidates").first()).toEqual({n:0});
  const input={...candidate("v1",1,"One"),short_intro:"界".repeat(100)};
  expect(await createCandidate(env.DB,now,input)).toMatchObject({short_intro:input.short_intro});
  await expect(updateCandidate(env.DB,now,1,{...input,short_intro:"x".repeat(101)})).rejects.toMatchObject({status:400});
  expect((await listCandidates(env.DB))[0]).toMatchObject({short_intro:input.short_intro});
  expect(await updateCandidate(env.DB,now,1,{...input,short_intro:"<b>Intro</b>"})).toMatchObject({short_intro:"<b>Intro</b>"});
 });
 it("copies the roll, stores description literally, and permits updates/deletes",async()=>{const made=await createCandidate(env.DB,now,candidate("v1",1,"One"));expect(made).toMatchObject({description:"<b>plain</b>",komsat_path:"/u"});await updateCandidate(env.DB,now,1,{number:1,name:"Changed",nickname:"changed",description:"text"});expect(await env.DB.prepare("SELECT description FROM candidates WHERE id=1").first()).toEqual({description:"text"});await deleteCandidate(env.DB,now,1);expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM candidates").first()).toEqual({n:0});});
 it("rejects duplicate number/nickname, admin candidates, and non-roll members",async()=>{await createCandidate(env.DB,now,candidate("v1",1,"One"));await expect(createCandidate(env.DB,now,candidate("v2",1,"Two"))).rejects.toThrow("Nomor urut/Nickname");await expect(createCandidate(env.DB,now,candidate("v2",2,"oNE"))).rejects.toThrow("Nomor urut/Nickname");await env.DB.prepare("INSERT INTO admin_voting(member_id,name,created_at) VALUES('v2','Admin','now')").run();await expect(createCandidate(env.DB,now,candidate("v2",2,"Two"))).rejects.toThrow("Admin Voting tidak dapat menjadi kandidat");await expect(createCandidate(env.DB,now,candidate("missing",2,"Two"))).rejects.toThrow("tidak ada di daftar");});
 it("rejects create, update, and delete after lock",async()=>{const made=await createCandidate(env.DB,now,candidate("v1",1,"One"));await env.DB.prepare("UPDATE elections SET status_lock='locked'").run();await expect(createCandidate(env.DB,now,candidate("v2",2,"Two"))).rejects.toThrow();await expect(updateCandidate(env.DB,now,Number(made!.id),candidate("v1",1,"Changed"))).rejects.toThrow();await expect(deleteCandidate(env.DB,now,Number(made!.id))).rejects.toThrow();});
});
