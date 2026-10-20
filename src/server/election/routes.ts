// Parent mounts under the 2.3 requireAdmin guard at integration.
import { Hono } from "hono";
import type { Bindings } from "../app";
import { createCandidate, deleteCandidate, ElectionError, listCandidates, updateCandidate } from "./candidates";
import { castTestVote, clearSchedule, closeEarly, extendClosing, getReadiness, lockElection, publishResults, setSchedule } from "./lifecycle";
import type { ServiceApiConfig } from "../serviceapi/client";

type Env={Bindings:Bindings & Partial<ServiceApiConfig>;Variables:{adminAuth?:{admin:{member_id:string}}}};
export const electionRoutes=new Hono<Env>();
function now(_context?:unknown) { return new Date(); }
function fail(c:any,error:unknown) { if(error instanceof ElectionError) return c.json({error:error.message,...(error.checks?{checks:error.checks}:{})},error.status as 400|403|404|409|503); return c.json({error:"Terjadi kesalahan"},500); }
function serviceConfig(env:Env["Bindings"]):ServiceApiConfig { return {issuer:env.issuer??"",clientId:env.clientId??"",clientSecret:env.clientSecret??"",serviceApiUrl:env.serviceApiUrl??""}; }
electionRoutes.get("/election/candidates",async c=>c.json({results:await listCandidates(c.env.DB)}));
electionRoutes.post("/election/candidates",async c=>{try{return c.json(await createCandidate(c.env.DB,now(),await c.req.json()),201);}catch(e){return fail(c,e);}});
electionRoutes.put("/election/candidates/:id",async c=>{try{return c.json(await updateCandidate(c.env.DB,now(),Number(c.req.param("id")),await c.req.json()));}catch(e){return fail(c,e);}});
electionRoutes.delete("/election/candidates/:id",async c=>{try{await deleteCandidate(c.env.DB,now(c),Number(c.req.param("id")));return c.body(null,204);}catch(e){return fail(c,e);}});
electionRoutes.get("/election/readiness",async c=>c.json({checks:await getReadiness(c.env.DB,now(c))}));
electionRoutes.put("/election/schedule",async c=>{try{await setSchedule(c.env.DB,now(c),await c.req.json());return c.json({ok:true});}catch(e){return fail(c,e);}});
electionRoutes.delete("/election/schedule",async c=>{try{await clearSchedule(c.env.DB,now(c));return c.json({ok:true});}catch(e){return fail(c,e);}});
electionRoutes.post("/election/lock",async c=>{try{return c.json(await lockElection(c.env.DB,serviceConfig(c.env),now(c)));}catch(e){return fail(c,e);}});
electionRoutes.post("/election/extend",async c=>{try{const body=await c.req.json();await extendClosing(c.env.DB,now(c),body.closes_at,body.reason);return c.json({ok:true});}catch(e){return fail(c,e);}});
electionRoutes.post("/election/close",async c=>{try{const body=await c.req.json();await closeEarly(c.env.DB,now(c),body.reason);return c.json({ok:true});}catch(e){return fail(c,e);}});
electionRoutes.post("/election/publish",async c=>{try{await publishResults(c.env.DB,now(c));return c.json({ok:true});}catch(e){return fail(c,e);}});
electionRoutes.post("/election/test-vote",async c=>{try{const body=await c.req.json();const memberId=c.get("adminAuth")?.admin.member_id;if(!memberId) throw new ElectionError("Admin tidak terautentikasi",403);return c.json(await castTestVote(c.env.DB,now(c),body.candidate_id,memberId),201);}catch(e){return fail(c,e);}});
