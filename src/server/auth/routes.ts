/**
 * Rute BFF One Login: /api/auth/login, /api/auth/callback, /api/auth/logout
 * dan /api/me. Konfigurasi issuer/klien dan kunci sesi disuntikkan lewat
 * `loadRuntime` (nilai aslinya dibaca dari system_config oleh tugas 2.2);
 * hingga itu terpasang semua rute menjawab 503. Token tidak pernah dicatat.
 */
import { createAdminRoutes } from "../admin/routes";
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Bindings } from "../app";
import {
  AUTH_TX_COOKIE,
  AUTH_TX_MAX_AGE,
  AUTH_TX_PATH,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  SESSION_PATH,
  cookieOptions,
  openAuthTx,
  openSession,
  sealAuthTx,
  sealSession,
  type AuthTxData,
  type SessionData,
} from "./session";
import {
  buildAuthorizationUrl,
  codeChallenge,
  exchangeCodeForIdToken,
  fetchDiscovery,
  fetchJwks,
  newCodeVerifier,
  randomToken,
  verifyIdToken,
  OidcError,
  type AuthConfig,
  type OidcDiscovery,
} from "./oidc";

/** Konfigurasi One Login + kunci sesi untuk satu permintaan. */
export interface AuthRuntime {
  config: AuthConfig;
  /** APP_MASTER_KEY (base64 32 byte) untuk menyegel cookie. */
  masterKey: string;
}

export type AuthRuntimeLoader = (c: Context) => AuthRuntime | null | Promise<AuthRuntime | null>;

export interface AuthDeps {
  /** Sumber konfigurasi yang disuntikkan; bawaan: variabel konteks `authRuntime`. */
  loadRuntime?: AuthRuntimeLoader;
  /** Pengganti fetch untuk pengujian (discovery/JWKS/token endpoint). */
  fetchImpl?: typeof fetch;
}

/** Env sub-aplikasi auth; tugas 2.2 mengisi `authRuntime` lewat middleware. */
export type AuthEnv = {
  Bindings: Bindings;
  Variables: { authRuntime?: AuthRuntime };
};

const DEFAULT_LOAD_RUNTIME: AuthRuntimeLoader = (c) => c.get("authRuntime") ?? null;

const UNREACHABLE_MESSAGE = "Saat ini kami tidak dapat menghubungi One Login. Coba beberapa saat lagi.";

/** Hanya jalur relatif dalam situs yang boleh jadi tujuan kembali. */
function sanitizeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

function parseMaxAge(raw: string | undefined): number | null | "invalid" {
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3600) return "invalid";
  return value;
}

export function createAuthRoutes(deps: AuthDeps = {}): Hono<AuthEnv> {
  const loadRuntime = deps.loadRuntime ?? DEFAULT_LOAD_RUNTIME;
  const doFetch = deps.fetchImpl ?? fetch.bind(globalThis);
  const routes = new Hono<AuthEnv>();

  const notConfigured = (c: Context<AuthEnv>) =>
    c.json(
      {
        error: "one_login_belum_dikonfigurasi",
        message: "One Login belum dikonfigurasi. Selesaikan pengaturan situs terlebih dahulu.",
      },
      503,
    );

  const unreachable = (c: Context<AuthEnv>, code: string) =>
    c.json({ error: code, message: UNREACHABLE_MESSAGE }, 502);

  const badRequest = (c: Context<AuthEnv>, error: string, message: string) => c.json({ error, message }, 400);

  // Memulai sign-in: buat PKCE, simpan cookie sementara, lalu arahkan ke One Login.
  routes.get("/auth/login", async (c) => {
    const runtime = await loadRuntime(c);
    if (!runtime) return notConfigured(c);

    const maxAge = parseMaxAge(c.req.query("max_age"));
    if (maxAge === "invalid") {
      return badRequest(c, "max_age_tidak_valid", "Nilai max_age harus bilangan bulat 1 sampai 3600 detik.");
    }
    const returnTo = sanitizeReturnTo(c.req.query("return_to"));

    let discovery: OidcDiscovery;
    try {
      discovery = await fetchDiscovery(runtime.config.issuer, doFetch);
    } catch (err) {
      return unreachable(c, err instanceof OidcError ? err.code : "one_login_tidak_terjangkau");
    }

    const tx: AuthTxData = {
      state: randomToken(),
      nonce: randomToken(),
      codeVerifier: newCodeVerifier(),
      returnTo,
      maxAge,
      createdAt: Math.floor(Date.now() / 1000),
    };
    setCookie(c, AUTH_TX_COOKIE, await sealAuthTx(tx, runtime.masterKey), cookieOptions(AUTH_TX_PATH, AUTH_TX_MAX_AGE));
    return c.redirect(
      buildAuthorizationUrl(discovery, runtime.config, {
        state: tx.state,
        nonce: tx.nonce,
        codeChallenge: await codeChallenge(tx.codeVerifier),
        maxAgeSeconds: maxAge,
      }),
    );
  });

  // Balasan dari One Login: cocokkan state, tukar kode, verifikasi id_token,
  // lalu segel sesi dan hapus cookie sementara (mencegah pemakaian ulang).
  routes.get("/auth/callback", async (c) => {
    const runtime = await loadRuntime(c);
    if (!runtime) return notConfigured(c);

    const opError = c.req.query("error");
    if (opError) {
      return badRequest(
        c,
        "masuk_dibatalkan",
        "Proses masuk di One Login tidak selesai. Silakan coba masuk kembali.",
      );
    }

    const rawTx = getCookie(c, AUTH_TX_COOKIE);
    const tx = rawTx ? await openAuthTx(rawTx, runtime.masterKey) : null;
    const state = c.req.query("state") ?? "";
    const now = Math.floor(Date.now() / 1000);
    if (!tx || !state || state !== tx.state || now - tx.createdAt > AUTH_TX_MAX_AGE) {
      deleteCookie(c, AUTH_TX_COOKIE, { path: AUTH_TX_PATH });
      return badRequest(
        c,
        "state_tidak_valid",
        "Permintaan balasan tidak cocok dengan permintaan masuk Anda, atau sudah kedaluwarsa. Silakan coba masuk lagi.",
      );
    }
    const code = c.req.query("code");
    if (!code) {
      return badRequest(c, "kode_tidak_ada", "Kode otorisasi dari One Login tidak ditemukan. Silakan coba masuk lagi.");
    }

    let discovery: OidcDiscovery;
    try {
      discovery = await fetchDiscovery(runtime.config.issuer, doFetch);
    } catch (err) {
      return unreachable(c, err instanceof OidcError ? err.code : "one_login_tidak_terjangkau");
    }

    let session: SessionData;
    try {
      const { idToken } = await exchangeCodeForIdToken(discovery, runtime.config, code, tx.codeVerifier, doFetch);
      const jwks = await fetchJwks(discovery.jwks_uri, doFetch);
      const claims = await verifyIdToken(idToken, {
        config: runtime.config,
        jwks,
        expectedNonce: tx.nonce,
        now,
      });
      session = {
        member_id: claims.sub,
        name: claims.name ?? claims.preferred_username ?? "",
        affiliation: typeof claims.affiliation === "string" || Array.isArray(claims.affiliation) ? claims.affiliation as string | string[] : null,
        auth_time: typeof claims.auth_time === "number" ? claims.auth_time : claims.iat,
      };
    } catch {
      return badRequest(
        c,
        "verifikasi_gagal",
        "Kami tidak dapat memverifikasi tanda masuk Anda dari One Login. Silakan coba masuk lagi.",
      );
    }

    setCookie(c, SESSION_COOKIE, await sealSession(session, runtime.masterKey), cookieOptions(SESSION_PATH, SESSION_MAX_AGE));
    deleteCookie(c, AUTH_TX_COOKIE, { path: AUTH_TX_PATH });
    return c.redirect(tx.returnTo);
  });

  // Keluar: cukup hapus cookie sesi. Cookie sementara flow login memang berumur pendek.
  routes.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: SESSION_PATH });
    return c.json({ ok: true, message: "Anda sudah keluar. Sampai jumpa kembali." });
  });

  routes.get("/me", async (c) => {
    const runtime = await loadRuntime(c);
    const raw = getCookie(c, SESSION_COOKIE);
    const session = runtime && raw ? await openSession(raw, runtime.masterKey) : null;
    if (!session) {
      return c.json(
        { error: "belum_masuk", message: "Anda belum masuk. Silakan masuk dengan PPIJ One Login." },
        401,
      );
    }
    return c.json({
      member_id: session.member_id,
      name: session.name,
      affiliation: session.affiliation,
      auth_time: session.auth_time,
    });
  });

  routes.route("/", createAdminRoutes());
  return routes;
}
