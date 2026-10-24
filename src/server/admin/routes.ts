import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { Bindings } from "../app";
import { SESSION_COOKIE, openSession, type SessionData } from "../auth/session";
import { buildAuditInsert } from "../lib/audit";

type Env = { Bindings: Bindings & { APP_MASTER_KEY?: string }; Variables: { authRuntime?: { masterKey: string }; adminAuth?: { session: SessionData; admin: { member_id: string; name: string; is_technical: number } } } };
type AffiliationClaim = string | string[] | null;

export function affiliationInScope(claim: AffiliationClaim, scope: string): boolean {
  const values = typeof claim === "string" ? [claim] : Array.isArray(claim) ? claim : [];
  const normalize = (value: string) => value.replace(/\/+$/, "");
  const wanted = normalize(scope);
  return values.some((value) => {
    if (typeof value !== "string") return false;
    const path = normalize(value);
    return path === wanted || (wanted === "/ppij" ? path.startsWith("/ppij/") : path.startsWith(`${wanted}/`));
  });
}

function jsonError(c: Context<Env>, error: string, status: 400 | 401 | 403 | 404 | 409 | 503) {
  return c.json({ error }, status);
}
const authenticate = async (c: Context<Env>) => {
  const key = c.get("authRuntime")?.masterKey ?? c.env.APP_MASTER_KEY;
  const cookie = c.req.header("cookie") ?? getCookie(c, SESSION_COOKIE);
  if (!key || !cookie) return null;
  const session = await openSession(cookie, key);
  if (!session) return null;
  const admin = await c.env.DB.prepare("SELECT member_id, name, is_technical FROM admin_voting WHERE member_id = ?").bind(session.member_id).first<{member_id:string;name:string;is_technical:number}>();
  if (!admin) return null;
  const config = await c.env.DB.prepare("SELECT value FROM system_config WHERE key = 'site_scope'").first<{value:string}>();
  if (!config || !affiliationInScope(session.affiliation, config.value)) return null;
  return { session, admin };
};
/** Dipakai juga oleh parent untuk memasang rute election/sync di bawah guard yang sama. */
export const requireAdmin = async (c: Context<Env>, next: () => Promise<void>) => {
  if (/\/admin\/invitations\/[^/]+\/accept$/.test(c.req.path)) return next();
  const auth = await authenticate(c);
  if (!auth) return jsonError(c, "admin_voting_tidak_aktif_atau_tidak_dalam_cakupan", 403);
  c.set("adminAuth", auth);
  await next();
};
export function createAdminRoutes() {
  const routes = new Hono<Env>();
  routes.use("*", async (c, next) => {
    const initialized = await c.env.DB.prepare("SELECT value FROM system_config WHERE key='initialized'").first<{value:string}>();
    if (initialized?.value !== "1") return jsonError(c, "situs_belum_dikonfigurasi", 503);
    await next();
  });
  routes.use("*", requireAdmin);
  routes.get("/admin", async (c) => {
    const admins = await c.env.DB.prepare("SELECT member_id, name, is_technical, created_at FROM admin_voting ORDER BY created_at").all();
    const portalUnit = c.get("adminAuth")!.session.portal_admin_unit ?? null;
    return c.json({ ...admins, results: admins.results.map((admin) => ({ ...admin, portal_admin_unit: admin.member_id === c.get("adminAuth")!.session.member_id ? portalUnit : null })) });
  });
  routes.get("/admin/invitations", async (c) => {
    const now = new Date().toISOString();
    const invitations = await c.env.DB.prepare(
      "SELECT i.token_hash AS id, i.member_id, v.name AS member_name, i.created_at, i.expires_at, i.accepted_at, i.cancelled_at FROM invitations i LEFT JOIN voters v ON v.member_id = i.member_id ORDER BY i.created_at DESC",
    ).all<{ id: string; member_id: string; member_name: string | null; created_at: string; expires_at: string; accepted_at: string | null; cancelled_at: string | null }>();
    return c.json({
      ...invitations,
      results: invitations.results.map((invitation) => ({
        ...invitation,
        state: invitation.accepted_at ? "accepted" : invitation.cancelled_at ? "cancelled" : invitation.expires_at <= now ? "expired" : "pending",
        portal_admin_unit: c.get("adminAuth")!.session.portal_admin_unit ?? null,
      })),
    });
  });
  routes.post("/admin/invitations", async (c) => {
    const body = await c.req.json<{member_id?:string}>().catch(() => ({} as {member_id?:string}));
    const memberId = body.member_id?.trim();
    if (!memberId) return jsonError(c,"member_id_wajib",400);
    const voter = await c.env.DB.prepare("SELECT member_id, name, status, komsat_path FROM voters WHERE member_id = ?").bind(memberId).first<{member_id:string;name:string;status:string;komsat_path:string}>();
    const scope = await c.env.DB.prepare("SELECT value FROM system_config WHERE key='site_scope'").first<{value:string}>();
    const candidate = await c.env.DB.prepare("SELECT 1 FROM candidates WHERE member_id = ?").bind(memberId).first();
    if (!scope || !voter || voter.status.toUpperCase() !== "ACTIVE" || !affiliationInScope(voter.komsat_path, scope.value)) return jsonError(c,"anggota_tidak_aktif_atau_tidak_ditemukan_atau_di_luar_cakupan",409);
    if (candidate) return jsonError(c,"kandidat_tidak_dapat_menjadi_admin_voting",409);
    const exists = await c.env.DB.prepare("SELECT 1 FROM admin_voting WHERE member_id = ?").bind(memberId).first();
    if (exists) return jsonError(c,"sudah_admin_voting",409);
    const actor = c.get("adminAuth")!;
    const token = crypto.randomUUID() + crypto.randomUUID();
    const hash = await digest(token);
    const now = new Date(); const expires = new Date(now.getTime() + 72 * 60 * 60 * 1000);
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO invitations (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(hash, memberId, now.toISOString(), expires.toISOString()),
      await buildAuditInsert(c.env.DB, { at: now.toISOString(), actor_type:"admin", actor_member_id:actor.session.member_id, actor_name:actor.session.name, action:"admin_invitation_created", target:memberId, komsat_path:null, detail_json:null }),
    ]);
    const base = await c.env.DB.prepare("SELECT value FROM system_config WHERE key='site_base_url'").first<{value:string}>();
    return c.json({ invitation_url: `${base?.value ?? ""}/api/admin/invitations/${encodeURIComponent(token)}/accept`, expires_at: expires.toISOString() }, 201);
  });
  routes.get("/admin/invitations/:token/accept", async (c) => {
    const token = c.req.param("token");
    if (!token || token.length > 256) return jsonError(c, "undangan_tidak_valid", 400);
    const key = c.get("authRuntime")?.masterKey ?? c.env.APP_MASTER_KEY;
    const cookie = getCookie(c, SESSION_COOKIE);
    if (!key || !cookie || !(await openSession(cookie, key))) {
      const target = `/api/admin/invitations/${encodeURIComponent(token)}/accept`;
      return c.redirect(`/api/auth/login?return_to=${encodeURIComponent(target)}`);
    }
    return c.html(`<main><h1>Terima undangan Admin Voting</h1><form method="post" action="/api/admin/invitations/${encodeURIComponent(token)}/accept"><button type="submit">Terima undangan</button></form></main>`);
  });
  routes.post("/admin/invitations/:token/accept", async (c) => {
    const key = c.get("authRuntime")?.masterKey ?? c.env.APP_MASTER_KEY;
    const cookie = getCookie(c, SESSION_COOKIE);
    const session = key && cookie ? await openSession(cookie, key) : null;
    if (!session || !affiliationInScope(session.affiliation, (await c.env.DB.prepare("SELECT value FROM system_config WHERE key='site_scope'").first<{value:string}>())?.value ?? "")) return jsonError(c, "undangan_tidak_valid", 403);
    const token = c.req.param("token");
    if (!token || token.length > 256) return jsonError(c, "undangan_tidak_valid", 400);
    const row = await c.env.DB.prepare("SELECT member_id, expires_at FROM invitations WHERE token_hash=? AND accepted_at IS NULL AND cancelled_at IS NULL").bind(await digest(token)).first<{member_id:string;expires_at:string}>();
    if (!row || Date.parse(row.expires_at) <= Date.now()) return jsonError(c, "undangan_tidak_valid_atau_kedaluwarsa", 409);
    if (session.member_id !== row.member_id) return jsonError(c, "undangan_untuk_anggota_lain", 403);
    const now = new Date().toISOString();
    const update = await c.env.DB.prepare("UPDATE invitations SET accepted_at=? WHERE token_hash=? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at > ?").bind(now,await digest(token),now).run();
    if (!update.meta.changes) return jsonError(c, "undangan_sudah_digunakan", 409);
    const prepared = await buildAuditInsert(c.env.DB,{at:now,actor_type:"admin",actor_member_id:session.member_id,actor_name:session.name,action:"admin_invitation_accepted",target:row.member_id,komsat_path:null,detail_json:null});
    await c.env.DB.batch([c.env.DB.prepare("INSERT INTO admin_voting (member_id,name,is_technical,created_at) VALUES (?,?,0,?) ON CONFLICT(member_id) DO NOTHING").bind(row.member_id, session.name, now), prepared]);
    return c.json({ok:true});
  });
  routes.delete("/admin/:memberId", async (c) => {
    const memberId=c.req.param("memberId"); const row=await c.env.DB.prepare("SELECT member_id FROM admin_voting WHERE member_id=?").bind(memberId).first();
    if (!row) return jsonError(c,"admin_tidak_ditemukan",404);
    const count=await c.env.DB.prepare("SELECT count(*) AS n FROM admin_voting").first<{n:number}>();
    if ((count?.n ?? 0) <= 1) return jsonError(c,"harus_ada_minimal_1_admin_voting",409);
    const actor = c.get("adminAuth")!;
    const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM admin_voting WHERE member_id=?").bind(memberId),
      await buildAuditInsert(c.env.DB,{at:now,actor_type:"admin",actor_member_id:actor.session.member_id,actor_name:actor.session.name,action:"admin_voting_removed",target:memberId,komsat_path:null,detail_json:null}),
    ]);
    return c.json({ok:true});
  });
  routes.delete("/admin/invitations/:id", async (c) => {
    const id = c.req.param("id");
    const now = new Date().toISOString();
    const actor = c.get("adminAuth")!;
    const invitation = await c.env.DB.prepare("SELECT member_id FROM invitations WHERE token_hash=? AND accepted_at IS NULL AND cancelled_at IS NULL").bind(id).first<{ member_id: string }>();
    if (!invitation) return jsonError(c, "undangan_tidak_ditemukan", 404);
    const result = await c.env.DB.prepare("UPDATE invitations SET cancelled_at=? WHERE token_hash=? AND accepted_at IS NULL AND cancelled_at IS NULL").bind(now, id).run();
    if (!result.meta.changes) return jsonError(c, "undangan_tidak_ditemukan", 404);
    const audit = await buildAuditInsert(c.env.DB,{at:now,actor_type:"admin",actor_member_id:actor.session.member_id,actor_name:actor.session.name,action:"admin_invitation_cancelled",target:invitation.member_id,komsat_path:null,detail_json:null});
    await c.env.DB.batch([audit]);
    return c.json({ok:true});
  });
  return routes;
}
async function digest(value:string):Promise<string>{const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,"0")).join("");}
