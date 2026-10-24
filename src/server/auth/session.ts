/**
 * Sesi tanpa state server: payload JSON (member_id, nama, affiliation,
 * auth_time) disegel dengan AES-256-GCM memakai APP_MASTER_KEY lalu disimpan
 * sebagai cookie HttpOnly, Secure, SameSite=Lax. Cookie sementara flow
 * login (state, nonce, code_verifier PKCE) disegel dengan cara yang sama.
 */
import { decryptSecret, encryptSecret } from "../lib/secrets";

export interface SessionData {
  /** Klaim `sub` dari id_token; satu-satunya pengenal orang yang dipakai. */
  member_id: string;
  name: string;
  affiliation: string | string[] | null;
  portal_admin_unit?: string;
  /** Epoch detik saat anggota masuk lewat One Login (klaim `auth_time`). */
  auth_time: number;
}

/** Isi cookie sementara selama redirect login/callback (PKCE). */
export interface AuthTxEntry {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Jalur relatif dalam situs untuk kembali setelah masuk. */
  returnTo: string;
  /** Nilai max_age yang diminta halaman, dalam detik. */
  maxAge: number | null;
  createdAt: number;
}

export interface AuthTxData extends AuthTxEntry {
  /** Transaksi login sebelumnya yang masih aktif (mencegah gagal saat klik ganda/prefetch). */
  prev?: AuthTxEntry[];
}

export const SESSION_COOKIE = "ppij_session";
export const AUTH_TX_COOKIE = "ppij_auth_tx";
export const SESSION_PATH = "/";
export const AUTH_TX_PATH = "/api/auth";
/** Sesi admin aktif berhari-hari; keamanan pemilihan dijaga oleh auth_time (3.2). */
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
/** Umur cookie sementara = batas waktu menyelesaikan redirect login. */
export const AUTH_TX_MAX_AGE = 600;

export function cookieOptions(path: string, maxAge: number) {
  return { path, maxAge, httpOnly: true, secure: true, sameSite: "Lax" as const };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionData(value: unknown): value is SessionData {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.member_id === "string" &&
    value.member_id !== "" &&
    typeof value.name === "string" &&
    (value.affiliation === null || typeof value.affiliation === "string" || (Array.isArray(value.affiliation) && value.affiliation.every((item) => typeof item === "string"))) &&
    (value.portal_admin_unit === undefined || typeof value.portal_admin_unit === "string") &&
    typeof value.auth_time === "number" &&
    Number.isFinite(value.auth_time)
  );
}

function isAuthTxEntry(value: unknown): value is AuthTxEntry {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.state === "string" &&
    value.state !== "" &&
    typeof value.nonce === "string" &&
    value.nonce !== "" &&
    typeof value.codeVerifier === "string" &&
    value.codeVerifier !== "" &&
    typeof value.returnTo === "string" &&
    (value.maxAge === null || typeof value.maxAge === "number") &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt)
  );
}

function isAuthTxData(value: unknown): value is AuthTxData {
  if (!isAuthTxEntry(value)) return false;
  const prev = (value as { prev?: unknown }).prev;
  return prev === undefined || (Array.isArray(prev) && prev.every(isAuthTxEntry));
}

async function seal(value: unknown, masterKey: string): Promise<string> {
  return encryptSecret(masterKey, JSON.stringify(value));
}

async function unseal<T>(cookie: string, masterKey: string, guard: (v: unknown) => v is T): Promise<T | null> {
  let raw: string;
  try {
    raw = await decryptSecret(masterKey, cookie);
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Ambil semua nilai cookie bernama `name` dari header Cookie mentah. */
export function extractCookieValues(cookieHeader: string | undefined, name: string): string[] {
  if (!cookieHeader || !cookieHeader.includes(name)) return [];
  const results: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    let val = part.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    try {
      results.push(decodeURIComponent(val));
    } catch {
      results.push(val);
    }
  }
  return results;
}

export function sealSession(session: SessionData, masterKey: string): Promise<string> {
  return seal(session, masterKey);
}

export async function openSession(cookie: string, masterKey: string): Promise<SessionData | null> {
  const direct = await unseal(cookie, masterKey, isSessionData);
  if (direct) return direct;
  if (cookie.includes(";") || cookie.includes(`${SESSION_COOKIE}=`)) {
    return openSessionFromHeader(cookie, masterKey);
  }
  return null;
}

/**
 * Baca sesi dari header Cookie yang mungkin memuat lebih dari satu cookie
 * `ppij_session` (mis. cookie lama di domain induk/path lain yang mendahului
 * cookie baru menurut RFC 6265). Pilih sesi sah dengan `auth_time` terbaru.
 */
export async function openSessionFromHeader(
  cookieHeader: string | undefined,
  masterKey: string,
): Promise<SessionData | null> {
  const values = extractCookieValues(cookieHeader, SESSION_COOKIE);
  let best: SessionData | null = null;
  for (const val of values) {
    const session = await unseal(val, masterKey, isSessionData);
    if (session && (!best || session.auth_time >= best.auth_time)) {
      best = session;
    }
  }
  return best;
}

export function sealAuthTx(tx: AuthTxData, masterKey: string): Promise<string> {
  return seal(tx, masterKey);
}

export function openAuthTx(cookie: string, masterKey: string): Promise<AuthTxData | null> {
  return unseal(cookie, masterKey, isAuthTxData);
}

/** Kumpulkan transaksi login yang belum kedaluwarsa untuk disimpan pada `prev`. */
export async function collectActiveAuthTx(
  cookieHeader: string | undefined,
  singleCookie: string | undefined,
  masterKey: string,
  nowSec: number,
  maxEntries = 4,
): Promise<AuthTxEntry[]> {
  const candidates = extractCookieValues(cookieHeader, AUTH_TX_COOKIE);
  if (singleCookie && !candidates.includes(singleCookie)) candidates.unshift(singleCookie);
  const seen = new Set<string>();
  const active: AuthTxEntry[] = [];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const tx = await openAuthTx(candidates[i], masterKey);
    if (!tx) continue;
    const { prev, ...head } = tx;
    for (const entry of [head, ...(prev ?? [])]) {
      if (nowSec - entry.createdAt <= AUTH_TX_MAX_AGE && !seen.has(entry.state)) {
        seen.add(entry.state);
        active.push(entry);
        if (active.length >= maxEntries) return active;
      }
    }
  }
  return active;
}

/** Cari transaksi login yang cocok dengan `state` dari semua cookie `ppij_auth_tx`. */
export async function openAuthTxByState(
  cookieHeader: string | undefined,
  singleCookie: string | undefined,
  masterKey: string,
  state: string,
  nowSec: number,
): Promise<AuthTxEntry | null> {
  if (!state) return null;
  const active = await collectActiveAuthTx(cookieHeader, singleCookie, masterKey, nowSec, 16);
  return active.find((entry) => entry.state === state) ?? null;
}

/**
 * Bila permintaan membawa lebih dari satu cookie `ppij_session` (cookie lama
 * membayangi cookie baru), saring header Cookie agar pembaca hilir
 * (`Astro.cookies.get`, `getCookie`) selalu mendapatkan cookie sesi yang sah.
 */
export async function normalizeAuthCookies(request: Request, masterKey: string | undefined): Promise<Request> {
  if (!masterKey) return request;
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return request;
  const sessionValues = extractCookieValues(cookieHeader, SESSION_COOKIE);
  if (sessionValues.length <= 1) return request;

  let bestRaw: string | null = null;
  let bestAuthTime = -Infinity;
  for (const val of sessionValues) {
    const session = await unseal(val, masterKey, isSessionData);
    if (session && session.auth_time >= bestAuthTime) {
      bestAuthTime = session.auth_time;
      bestRaw = encodeURIComponent(val);
    }
  }
  const otherParts = cookieHeader.split(";").filter((part) => {
    const eq = part.indexOf("=");
    return eq === -1 || part.slice(0, eq).trim() !== SESSION_COOKIE;
  });
  if (bestRaw) otherParts.push(`${SESSION_COOKIE}=${bestRaw}`);
  const headers = new Headers(request.headers);
  if (otherParts.length > 0) headers.set("cookie", otherParts.join("; "));
  else headers.delete("cookie");
  const nextReq = new Request(request, { headers });
  for (const sym of Object.getOwnPropertySymbols(request)) {
    Reflect.set(nextReq, sym, Reflect.get(request, sym));
  }
  return nextReq;
}
