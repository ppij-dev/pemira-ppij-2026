import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../migrations/0001_init.sql?raw";
import { recoveryInvitationSql } from "../scripts/recovery-invite.mjs";
import { app } from "../src/server/app";
import { sealSession } from "../src/server/auth/session";
import { affiliationInScope } from "../src/server/admin/routes";
import { canonicalRow, verifyChain, type AuditEntry, type AuditRow } from "../src/server/lib/audit";

declare module "*.sql?raw" { const sql: string; export default sql; }
declare module "*.mjs" { export function recoveryInvitationSql(input: { memberId: string; tokenHash: string; createdAt: string; expiresAt: string; previousHash: string; auditHash: string }): string; }
const MASTER_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const SCOPE = "/ppij/okayama";
const bindings = { DB: env.DB, MEDIA: {} as never, APP_MASTER_KEY: MASTER_KEY };

async function sessionCookie(memberId: string, affiliation: string | string[] | null = SCOPE, portal_admin_unit?: string) {
  const value = await sealSession({ member_id: memberId, name: memberId, affiliation, portal_admin_unit, auth_time: Math.floor(Date.now() / 1000) }, MASTER_KEY);
  return `ppij_session=${value}`;
}
async function request(path: string, memberId: string, init: RequestInit = {}, affiliation: string | string[] | null = SCOPE, portal_admin_unit?: string) {
  const headers = new Headers(init.headers);
  headers.set("cookie", await sessionCookie(memberId, affiliation, portal_admin_unit));
  return app.request(path, { ...init, headers }, bindings);
}
async function createInvitation(memberId: string, actor = "admin-1") {
  return request("/api/admin/invitations", actor, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ member_id: memberId }) });
}
async function inviteToken(response: Response) {
  const body = await response.json() as { invitation_url: string };
  const url = new URL(body.invitation_url);
  return decodeURIComponent(url.pathname.split("/").at(-2)!);
}
async function accept(token: string, memberId: string, affiliation: string | string[] | null = SCOPE) {
  return request(`/api/admin/invitations/${encodeURIComponent(token)}/accept`, memberId, { method: "POST" }, affiliation);
}
async function seedVoter(memberId: string, path = `${SCOPE}/komsat`) {
  await env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at) VALUES (?,?,?,'ACTIVE',?)").bind(memberId, memberId, path, new Date().toISOString()).run();
}
async function auditActions() {
  const { results } = await env.DB.prepare("SELECT seq,at,actor_type,actor_member_id,actor_name,action,target,komsat_path,detail_json,prev_hash,hash FROM audit_log ORDER BY seq").all<AuditRow>();
  expect(await verifyChain(results)).toBeNull();
  return results.map((row) => row.action);
}
async function digestHex(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
beforeEach(async () => {
  await reset();
  const statements = initSql.split(";").map((statement) => statement.trim()).filter(Boolean);
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO system_config (key,value) VALUES ('initialized','1'),('site_scope',?),('site_base_url','https://election.test')").bind(SCOPE),
    env.DB.prepare("INSERT INTO admin_voting (member_id,name,is_technical,created_at) VALUES ('admin-1','Admin 1',1,?)").bind(new Date().toISOString()),
    env.DB.prepare("INSERT INTO voters (member_id,name,komsat_path,status,synced_at) VALUES ('admin-1','Admin 1',?,'ACTIVE',?)").bind(SCOPE, new Date().toISOString()),
  ]);
});

describe("affiliationInScope", () => {
  it("accepts string and array claims within scope, including national scope", () => {
    expect(affiliationInScope(SCOPE, SCOPE)).toBe(true);
    expect(affiliationInScope(`${SCOPE}/komsat`, SCOPE)).toBe(true);
    expect(affiliationInScope(["/ppij/tokyo", `${SCOPE}/komsat`], SCOPE)).toBe(true);
    expect(affiliationInScope([SCOPE], "/ppij")).toBe(true);
  });
  it("rejects lookalikes and malformed claims", () => {
    expect(affiliationInScope("/ppij/okayama-other", SCOPE)).toBe(false);
    expect(affiliationInScope([null, 1] as unknown as string[], "/ppij")).toBe(false);
    expect(affiliationInScope(null, "/ppij")).toBe(false);
  });
});

describe("Admin Voting invitation routes", () => {
  it("creates and accepts an invitation, records audit, and consumes it once", async () => {
    await seedVoter("member-2");
    const created = await createInvitation("member-2");
    expect(created.status).toBe(201);
    const token = await inviteToken(created);
    expect(await env.DB.prepare("SELECT token_hash FROM invitations").first()).toMatchObject({ token_hash: expect.any(String) });
    expect((await accept(token, "member-2")).status).toBe(200);
    expect(await env.DB.prepare("SELECT member_id,is_technical FROM admin_voting WHERE member_id='member-2'").first()).toEqual({ member_id: "member-2", is_technical: 0 });
    expect(await env.DB.prepare("SELECT accepted_at FROM invitations").first()).toMatchObject({ accepted_at: expect.any(String) });
    expect(await auditActions()).toEqual(["admin_invitation_created", "admin_invitation_accepted"]);
    expect((await accept(token, "member-2")).status).toBe(409);
  });
  it("refuses a forwarded invitation without consuming it", async () => {
    await seedVoter("member-2");
    const token = await inviteToken(await createInvitation("member-2"));
    expect((await accept(token, "member-3")).status).toBe(403);
    expect(await env.DB.prepare("SELECT accepted_at FROM invitations").first()).toEqual({ accepted_at: null });
    expect(await auditActions()).toEqual(["admin_invitation_created"]);
  });
  it("refuses candidate invitations", async () => {
    await seedVoter("candidate");
    await env.DB.prepare("INSERT INTO candidates (member_id,number,name,nickname,komsat_path) VALUES ('candidate',1,'Candidate','candidate',?)").bind(SCOPE).run();
    const response = await createInvitation("candidate");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "kandidat_tidak_dapat_menjadi_admin_voting" });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM invitations").first()).toEqual({ n: 0 });
  });
  it.each(["expired", "cancelled"] as const)("refuses a %s invitation", async (state) => {
    await seedVoter("member-2");
    const token = crypto.randomUUID();
    const tokenHash = await digestHex(token);
    const old = new Date(Date.now() - 1000).toISOString();
    await env.DB.prepare("INSERT INTO invitations (token_hash,member_id,created_at,expires_at,cancelled_at) VALUES (?,?,?,?,?)").bind(tokenHash, "member-2", old, state === "expired" ? old : new Date(Date.now() + 60_000).toISOString(), state === "cancelled" ? old : null).run();
    expect((await accept(token, "member-2")).status).toBe(409);
    expect(await env.DB.prepare("SELECT accepted_at FROM invitations").first()).toEqual({ accepted_at: null });
  });
  it("cancels invitations, refuses later acceptance, and audits the cancellation", async () => {
    await seedVoter("member-2");
    const token = await inviteToken(await createInvitation("member-2"));
    const tokenHash = await digestHex(token);
    expect((await request(`/api/admin/invitations/${tokenHash}`, "admin-1", { method: "DELETE" })).status).toBe(200);
    expect((await accept(token, "member-2")).status).toBe(409);
    expect(await env.DB.prepare("SELECT cancelled_at,accepted_at FROM invitations").first()).toMatchObject({ cancelled_at: expect.any(String), accepted_at: null });
    expect(await auditActions()).toEqual(["admin_invitation_created", "admin_invitation_cancelled"]);
  });
  it("creates a recovery invitation through the operator SQL path and accepts it with a valid audit chain", async () => {
    await seedVoter("member-recovery");
    const token = `recovery-${crypto.randomUUID()}`;
    const tokenHash = await digestHex(token);
    const at = new Date().toISOString();
    const previousHash = "0".repeat(64);
    const entry: AuditEntry = { at, actor_type: "system", actor_member_id: null, actor_name: "Cloudflare operator", action: "admin_invitation_recovery", target: "member-recovery", komsat_path: null, detail_json: null };
    const auditHash = await digestHex(previousHash + canonicalRow({ ...entry, prev_hash: previousHash }));
    const sql = recoveryInvitationSql({ memberId: "member-recovery", tokenHash, createdAt: at, expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), previousHash, auditHash });
    await env.DB.batch(sql.split(";").map((statement) => statement.trim()).filter(Boolean).map((statement) => env.DB.prepare(statement)));
    expect((await accept(token, "member-recovery")).status).toBe(200);
    expect(await env.DB.prepare("SELECT member_id FROM admin_voting WHERE member_id='member-recovery'").first()).toEqual({ member_id: "member-recovery" });
    expect(await auditActions()).toEqual(["admin_invitation_recovery", "admin_invitation_accepted"]);
  });
});

describe("Admin Voting authorization and equality", () => {
  it.each([["/ppij/tokyo"], [null]] as const)("denies an inactive affiliation %s but preserves its committee row", async (affiliation) => {
    expect((await request("/api/admin", "admin-1", {}, affiliation)).status).toBe(403);
    expect(await env.DB.prepare("SELECT member_id FROM admin_voting WHERE member_id='admin-1'").first()).toEqual({ member_id: "admin-1" });
  });
  it("allows a non-technical admin to invite and remove another admin", async () => {
    await env.DB.prepare("INSERT INTO admin_voting (member_id,name,is_technical,created_at) VALUES ('admin-2','Admin 2',0,?)").bind(new Date().toISOString()).run();
    await seedVoter("member-2");
    expect((await createInvitation("member-2", "admin-2")).status).toBe(201);
    expect((await request("/api/admin/admin-1", "admin-2", { method: "DELETE" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT member_id FROM admin_voting WHERE member_id='admin-1'").first()).toBeNull();
    expect(await auditActions()).toEqual(["admin_invitation_created", "admin_voting_removed"]);
  });
  it("prevents removing the final Admin Voting", async () => {
    const response = await request("/api/admin/admin-1", "admin-1", { method: "DELETE" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "harus_ada_minimal_1_admin_voting" });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_voting").first()).toEqual({ n: 1 });
  });
  it("includes the optional Admin Portal unit in the committee list", async () => {
    const response = await request("/api/admin", "admin-1", {}, SCOPE, "PPI Okayama");
    expect((await response.json() as { results: Array<{ portal_admin_unit: string | null }> }).results[0].portal_admin_unit).toBe("PPI Okayama");
  });
});
