/**
 * Rute publik Undangan Langsung: klaim formulir tamu dan surat suara tamu.
 * Dipasang parent di /api SEBELUM rute auth/admin. Body permintaan tidak pernah
 * dicatat; kode tautan dan kode bukti tidak pernah masuk log.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Bindings } from "../app";
import { cookieOptions, extractCookieValues } from "../auth/session";
import { linkTokenHash, normalizeLinkCode } from "./code";
import {
  DirectInviteError,
} from "./create";
import { allowAttempt } from "./limit";
import {
  INVITE_SESSION_COOKIE,
  INVITE_SESSION_MAX_AGE,
  INVITE_SESSION_PATH,
  claimDirectInvitation,
  openInviteSession,
} from "./claim";
import { InviteVoteError, castInviteVote } from "./vote";

type Env = { Bindings: Bindings & { APP_MASTER_KEY?: string }; Variables: { authRuntime?: { masterKey: string } } };

export const directRoutes = new Hono<Env>();

const ERROR_STATUS = [400, 401, 403, 404, 409, 429, 503] as const;

function jsonError(c: Context<Env>, error: string, status: (typeof ERROR_STATUS)[number]) {
  return c.json({ error }, status);
}

/** Mutasi hanya dari origin yang sama; body tidak pernah dicatat. */
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
  if (!allowed) {
    const base = await c.env.DB.prepare("SELECT value FROM system_config WHERE key = 'site_base_url'").first<{ value: string }>();
    if (base?.value) {
      try {
        allowed = sourceOrigin === new URL(base.value).origin;
      } catch {
        allowed = false;
      }
    }
  }
  return allowed ? null : jsonError(c, "origin_tidak_diizinkan", 403);
}

function masterKey(c: Context<Env>): string | undefined {
  return c.get("authRuntime")?.masterKey ?? c.env.APP_MASTER_KEY;
}

/** Nilai cookie sesi undangan dari header Cookie mentah atau cookie terurai. */
function inviteCookie(c: Context<Env>): string | undefined {
  const header = c.req.header("cookie");
  const values = header ? extractCookieValues(header, INVITE_SESSION_COOKIE) : [];
  return values.at(-1) ?? getCookie(c, INVITE_SESSION_COOKIE);
}

/** POST /api/undangan/klaim — simpan Nama, Email dan Korda/Komsat, set sesi undangan. */
directRoutes.post("/undangan/klaim", async (c) => {
  const rejected = await assertSameOrigin(c);
  if (rejected) return rejected;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "body_tidak_valid", 400);
  }
  if (typeof body !== "object" || body === null) return jsonError(c, "body_tidak_valid", 400);
  const input = body as { kode?: unknown; nama?: unknown; email?: unknown; komsat_path?: unknown };
  const code = typeof input.kode === "string" ? normalizeLinkCode(input.kode) : null;
  if (!code) return jsonError(c, "invite_not_found", 404);
  const key = masterKey(c);
  if (!key) return jsonError(c, "situs_belum_dikonfigurasi", 503);
  const digest = await linkTokenHash(code);
  if (!(await allowAttempt(c.env.DB, `undangan:klaim:${digest.slice(0, 16)}`, 10, 60))) {
    return jsonError(c, "rate_limited", 429);
  }
  const scopeRow = await c.env.DB.prepare("SELECT value FROM system_config WHERE key = 'site_scope'").first<{ value: string }>();
  const cookie = inviteCookie(c);
  const current = cookie ? await openInviteSession(cookie, key) : null;
  try {
    const result = await claimDirectInvitation(
      c.env.DB,
      new Date(),
      {
        kode: code,
        nama: typeof input.nama === "string" ? input.nama : "",
        email: typeof input.email === "string" ? input.email : "",
        komsat_path: typeof input.komsat_path === "string" ? input.komsat_path : "",
      },
      current?.claim_id ?? null,
      { masterKey: key, scope: scopeRow?.value ?? "" },
    );
    setCookie(c, INVITE_SESSION_COOKIE, result.cookie, cookieOptions(INVITE_SESSION_PATH, INVITE_SESSION_MAX_AGE));
    return c.json({ ok: true, redirect: `/undangan/${code}/surat-suara` }, 200);
  } catch (error) {
    if (error instanceof DirectInviteError) return jsonError(c, error.reason, error.status as (typeof ERROR_STATUS)[number]);
    throw error;
  }
});

/** POST /api/undangan/suara — surat suara tamu, satu kali pakai per tautan. */
directRoutes.post("/undangan/suara", async (c) => {
  const rejected = await assertSameOrigin(c);
  if (rejected) return rejected;
  const key = masterKey(c);
  const cookie = inviteCookie(c);
  if (!key || !cookie) return jsonError(c, "undangan_tidak_aktif", 401);
  const session = await openInviteSession(cookie, key);
  if (!session) return jsonError(c, "undangan_tidak_aktif", 401);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "body_tidak_valid", 400);
  }
  try {
    const result = await castInviteVote(c.env.DB, session, body);
    deleteCookie(c, INVITE_SESSION_COOKIE, { path: INVITE_SESSION_PATH });
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof InviteVoteError) return jsonError(c, error.reason, error.status);
    throw error;
  }
});

export {};
