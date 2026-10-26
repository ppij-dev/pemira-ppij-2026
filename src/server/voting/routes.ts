/**
 * Rute API pemungutan suara (vote). Dipasang parent di /api SEBELUM
 * middleware admin wildcard. Mendukung dua gaya mount: app.route("/", …)
 * (path /votes…) dan app.route("/votes", …) (path bare). Tidak pernah
 * mencatat body permintaan, pilihan kandidat, atau kode bukti.
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { Bindings } from "../app";
import { openSession, SESSION_COOKIE, type SessionData } from "../auth/session";
import { castVote, getEligibility, getVoteMe, VoteError } from "./vote";

type Env = {
  Bindings: Bindings;
  Variables: { authRuntime?: { masterKey?: string } };
};

export const voteRoutes = new Hono<Env>();

function jsonError(c: Context<Env>, error: string, status: 400 | 401 | 403 | 404 | 409 | 429 | 500) {
  return c.json({ error }, status);
}

/** Sesi dari cookie tersegel; null bila tidak ada/tidak sah. */
async function sessionOf(c: Context<Env>): Promise<SessionData | null> {
  const key = c.get("authRuntime")?.masterKey ?? c.env.APP_MASTER_KEY;
  const cookie = c.req.header("cookie") ?? getCookie(c, SESSION_COOKIE);
  if (!key || !cookie) return null;
  return openSession(cookie, key);
}

/**
 * Mutasi hanya dari origin yang sama: tolak Sec-Fetch-Site cross-site,
 * atau Origin/Referer yang origin-nya bukan origin permintaan atau
 * site_base_url yang dikonfigurasi. Body permintaan tidak pernah dicatat.
 */
async function assertSameOrigin(c: Context<Env>): Promise<Response | null> {
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite === "cross-site") return jsonError(c, "origin_tidak_diizinkan", 403);
  const source = c.req.header("origin") ?? c.req.header("referer");
  if (!source) return jsonError(c, "origin_tidak_diizinkan", 403);
  let sourceOrigin: string;
  try {
    sourceOrigin = new URL(source).origin;
  } catch {
    return jsonError(c, "origin_tidak_diizinkan", 403);
  }
  let allowed = sourceOrigin === new URL(c.req.url).origin;
  const base = await c.env.DB.prepare("SELECT value FROM system_config WHERE key = 'site_base_url'").first<{ value: string }>();
  if (!allowed && base?.value) {
    try {
      allowed = sourceOrigin === new URL(base.value).origin;
    } catch {
      // site_base_url tidak valid diabaikan
    }
  }
  if (!allowed) return jsonError(c, "origin_tidak_diizinkan", 403);
  return null;
}

async function handleVote(c: Context<Env>) {
  const rejected = await assertSameOrigin(c);
  if (rejected) return rejected;
  const session = await sessionOf(c);
  if (!session) return jsonError(c, "belum_masuk", 401);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "body_tidak_valid", 400);
  }
  try {
    return c.json(await castVote(c.env.DB, session, body), 201);
  } catch (error) {
    if (error instanceof VoteError) return jsonError(c, error.reason, error.status);
    return jsonError(c, "terjadi_kesalahan", 500);
  }
}

async function handleMe(c: Context<Env>) {
  const session = await sessionOf(c);
  if (!session) return jsonError(c, "belum_masuk", 401);
  return c.json(await getVoteMe(c.env.DB, session));
}

async function handleEligibility(c: Context<Env>) {
  const session = await sessionOf(c);
  const result = await getEligibility(c.env.DB, session);
  return c.json({ ...result, freshLoginNeeded: result.fresh_login_needed });
}

// Gaya mount app.route("/", voteRoutes) → path /votes…
voteRoutes.post("/votes", handleVote);
voteRoutes.get("/votes/me", handleMe);
voteRoutes.get("/votes/eligibility", handleEligibility);
// Gaya mount app.route("/votes", voteRoutes) → path bare
voteRoutes.post("/", handleVote);
voteRoutes.get("/me", handleMe);
voteRoutes.get("/eligibility", handleEligibility);
