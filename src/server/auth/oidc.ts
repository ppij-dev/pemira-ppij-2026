/**
 * Primitif OIDC (Authorization Code Flow + PKCE) untuk PPIJ One Login.
 * Konfigurasi issuer/klien disuntikkan lewat objek `AuthConfig`; nilai aslinya
 * dibaca dari system_config oleh tugas setup (2.2). Kode verifikasi id_token
 * memakai JWKS dari discovery endpoint; token tidak pernah dicatat ke log.
 */

export const DEFAULT_SCOPE = "openid ppij-member ppij-affiliation";

/** Batas waktu tiap permintaan HTTP ke One Login (discovery/JWKS/token). */
const FETCH_TIMEOUT_MS = 10_000;

/** Toleransi detik untuk klaim iat yang sedikit di masa depan. */
const IAT_SKEW_SECONDS = 60;

export interface AuthConfig {
  /** Issuer One Login, mis. https://sso.ppijepang.app/realms/ppij */
  issuer: string;
  clientId: string;
  /** Rahasia klien untuk klien confidential; null untuk klien publik PKCE. */
  clientSecret: string | null;
  redirectUri: string;
  scope?: string;
}

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  auth_time?: number;
  nonce?: string;
  name?: string;
  preferred_username?: string;
  affiliation?: string;
  [claim: string]: unknown;
}

/** JWK kunci tanda tangan; workers-types tidak punya kolom metadata JWKS. */
export interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

/** Kegagalan OIDC dengan kode stabil; pesan ramah diterjemahkan di routes. */
export class OidcError extends Error {
  code: string;
  constructor(code: string, message = code) {
    super(message);
    this.name = "OidcError";
    this.code = code;
  }
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Token acak base64url 43 karakter (state, nonce, code_verifier PKCE). */
export function randomToken(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

/** code_verifier PKCE baru (RFC 7636, 43-128 karakter unreserved). */
export const newCodeVerifier = randomToken;

export async function codeChallenge(verifier: string): Promise<string> {
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

async function fetchJson(url: string, init: RequestInit | undefined, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new OidcError("one_login_tidak_terjangkau");
  }
  if (!res.ok) throw new OidcError("one_login_tidak_terjangkau");
  try {
    return await res.json();
  } catch {
    throw new OidcError("respons_tidak_valid");
  }
}

/** Mengambil dan memvalidasi discovery document milik issuer. */
export async function fetchDiscovery(issuer: string, fetchImpl: typeof fetch = fetch): Promise<OidcDiscovery> {
  const meta = (await fetchJson(
    `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
    undefined,
    fetchImpl,
  )) as Record<string, unknown>;
  if (meta.issuer !== issuer) throw new OidcError("issuer_tidak_cocok");
  for (const field of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (typeof meta[field] !== "string" || meta[field] === "") throw new OidcError("discovery_tidak_lengkap");
  }
  return {
    issuer,
    authorization_endpoint: meta.authorization_endpoint as string,
    token_endpoint: meta.token_endpoint as string,
    jwks_uri: meta.jwks_uri as string,
  };
}

/** Mengambil kunci publik (JWKS) untuk verifikasi tanda tangan id_token. */
export async function fetchJwks(jwksUri: string, fetchImpl: typeof fetch = fetch): Promise<Jwk[]> {
  const data = (await fetchJson(jwksUri, undefined, fetchImpl)) as Record<string, unknown>;
  if (!Array.isArray(data.keys)) throw new OidcError("jwks_tidak_valid");
  return data.keys as Jwk[];
}

export function buildAuthorizationUrl(
  discovery: OidcDiscovery,
  config: AuthConfig,
  params: { state: string; nonce: string; codeChallenge: string; maxAgeSeconds: number | null },
): string {
  const url = new URL(discovery.authorization_endpoint);
  const q = url.searchParams;
  q.set("response_type", "code");
  q.set("client_id", config.clientId);
  q.set("redirect_uri", config.redirectUri);
  q.set("scope", config.scope ?? DEFAULT_SCOPE);
  q.set("state", params.state);
  q.set("nonce", params.nonce);
  q.set("code_challenge", params.codeChallenge);
  q.set("code_challenge_method", "S256");
  if (params.maxAgeSeconds != null) q.set("max_age", String(params.maxAgeSeconds));
  return url.toString();
}

/**
 * Menukar kode otorisasi menjadi id_token di token endpoint (PKCE,
 * client_secret_post bila klien confidential). Hanya id_token yang dipakai;
 * token lain dari respons tidak disimpan dan tidak dicatat.
 */
export async function exchangeCodeForIdToken(
  discovery: OidcDiscovery,
  config: AuthConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ idToken: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);
  const data = (await fetchJson(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }, fetchImpl)) as Record<string, unknown>;
  if (typeof data.id_token !== "string" || data.id_token === "") {
    throw new OidcError("id_token_tidak_ada");
  }
  return { idToken: data.id_token };
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(segment))) as Record<string, unknown>;
  } catch {
    throw new OidcError("id_token_tidak_sah");
  }
}

/**
 * Memverifikasi id_token RS256 terhadap JWKS: tanda tangan, iss, aud, exp,
 * nonce, lalu mengembalikan klaimnya. `now` (epoch detik) bisa disuntikkan
 * untuk pengujian.
 */
export async function verifyIdToken(
  idToken: string,
  opts: {
    config: Pick<AuthConfig, "issuer" | "clientId">;
    jwks: Jwk[];
    expectedNonce?: string;
    now?: number;
  },
): Promise<IdTokenClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new OidcError("id_token_tidak_sah");
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeJsonSegment(headerB64);
  if (header.alg !== "RS256") throw new OidcError("algoritma_tidak_didukung");
  const kid = typeof header.kid === "string" ? header.kid : undefined;
  const jwk = opts.jwks.find(
    (k) => k.kty === "RSA" && (k.use === undefined || k.use === "sig") && (kid === undefined || k.kid === kid),
  );
  if (!jwk) throw new OidcError("kunci_tanda_tangan_tidak_ditemukan");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = b64urlDecode(signatureB64);
  const valid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, signed);
  if (!valid) throw new OidcError("tanda_tangan_tidak_valid");

  const claims = decodeJsonSegment(payloadB64) as unknown as IdTokenClaims;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== opts.config.issuer) throw new OidcError("issuer_tidak_cocok");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.config.clientId)) throw new OidcError("audiens_tidak_cocok");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new OidcError("token_kedaluwarsa");
  if (typeof claims.iat === "number" && claims.iat > now + IAT_SKEW_SECONDS) {
    throw new OidcError("token_dari_masa_depan");
  }
  if (opts.expectedNonce !== undefined && claims.nonce !== opts.expectedNonce) {
    throw new OidcError("nonce_tidak_cocok");
  }
  if (typeof claims.sub !== "string" || claims.sub === "") throw new OidcError("sub_tidak_ada");
  return claims;
}
