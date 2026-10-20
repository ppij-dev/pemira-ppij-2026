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
export interface AuthTxData {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Jalur relatif dalam situs untuk kembali setelah masuk. */
  returnTo: string;
  /** Nilai max_age yang diminta halaman, dalam detik. */
  maxAge: number | null;
  createdAt: number;
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

function isAuthTxData(value: unknown): value is AuthTxData {
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

export function sealSession(session: SessionData, masterKey: string): Promise<string> {
  return seal(session, masterKey);
}

export function openSession(cookie: string, masterKey: string): Promise<SessionData | null> {
  return unseal(cookie, masterKey, isSessionData);
}

export function sealAuthTx(tx: AuthTxData, masterKey: string): Promise<string> {
  return seal(tx, masterKey);
}

export function openAuthTx(cookie: string, masterKey: string): Promise<AuthTxData | null> {
  return unseal(cookie, masterKey, isAuthTxData);
}
