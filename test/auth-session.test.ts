/**
 * Uji sesi BFF One Login (tugas 3.1): redirect login ber-PKCE, callback
 * valid/state salah/state dipakai ulang, token kedaluwarsa, logout, dan
 * /api/me. One Login dipalsukan dengan pasangan kunci RSA yang dibuat lokal
 * serta fetch tiruan untuk discovery, JWKS, dan token endpoint.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createAuthRoutes, type AuthEnv, type AuthRuntime } from "../src/server/auth/routes";
import { AUTH_TX_COOKIE, SESSION_COOKIE, normalizeAuthCookies, openAuthTx, openSession } from "../src/server/auth/session";
import { codeChallenge } from "../src/server/auth/oidc";

const ISSUER = "https://sso.ppijepang.test/realms/ppij";
const CLIENT_ID = "ppij-election-uji";
const CLIENT_SECRET = "rahasia-klien-uji";
const REDIRECT_URI = "https://pemilu.test/api/auth/callback";
const AUTHORIZATION_ENDPOINT = `${ISSUER}/protocol/openid-connect/auth`;
const TOKEN_ENDPOINT = `${ISSUER}/protocol/openid-connect/token`;
const JWKS_URI = `${ISSUER}/protocol/openid-connect/certs`;
const MASTER_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const CONFIG: AuthRuntime["config"] = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUri: REDIRECT_URI,
  scope: "openid ppij-member ppij-affiliation",
};

interface CookieJar {
  [name: string]: string;
}

function setCookieLines(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const merged = res.headers.get("set-cookie");
  return merged ? merged.split(/,(?=[^;]+=[^;])/) : [];
}

async function storeCookies(res: Response, jar: CookieJar): Promise<void> {
  for (const line of setCookieLines(res)) {
    const [pair, ...attrs] = line.split("; ");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const deleted = attrs.some((a) => /^max-age=0$/i.test(a));
    if (deleted || value === "") delete jar[name];
    // Hono menyegel cookie dengan encodeURIComponent; simpan dalam bentuk asli.
    else jar[name] = decodeURIComponent(value);
  }
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function cookieLine(res: Response, name: string): string | undefined {
  return setCookieLines(res).find((line) => line.startsWith(`${name}=`));
}

/** Pasangan kunci RSA lokal: id_token ditandatangani sendiri untuk pengujian. */
async function generateSigningKey(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { ...publicJwk, kid, alg: "RS256", use: "sig" } };
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintIdToken(
  key: { kid: string; privateKey: CryptoKey },
  claims: Record<string, unknown>,
): Promise<string> {
  const encode = (obj: unknown) => b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  const head = encode({ alg: "RS256", kid: key.kid, typ: "JWT" });
  const body = encode(claims);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      key.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    ),
  );
  return `${head}.${body}.${b64urlEncode(signature)}`;
}

interface StubState {
  code: string;
  nonce: string;
  expiresIn: number;
  iatOffset: number;
  authTimeOffset: number;
  signWithSecondKey: boolean;
  tokenRequests: Record<string, string>[];
}

interface OneLoginStub {
  state: StubState;
  fetchImpl: typeof fetch;
}

async function createOneLoginStub(): Promise<OneLoginStub> {
  const primaryKey = await generateSigningKey("kunci-uji-1");
  const secondKey = await generateSigningKey("kunci-uji-2");
  const state: StubState = {
    code: "kode-otorisasi-1",
    nonce: "",
    expiresIn: 300,
    iatOffset: 0,
    authTimeOffset: 0,
    signWithSecondKey: false,
    tokenRequests: [],
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return json({
        issuer: ISSUER,
        authorization_endpoint: AUTHORIZATION_ENDPOINT,
        token_endpoint: TOKEN_ENDPOINT,
        jwks_uri: JWKS_URI,
      });
    }
    if (url === JWKS_URI) return json({ keys: [primaryKey.jwk] });
    if (url === TOKEN_ENDPOINT) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      state.tokenRequests.push(Object.fromEntries(body));
      if (body.get("code") !== state.code) {
        return json({ error: "invalid_grant" }, 400);
      }
      const now = Math.floor(Date.now() / 1000);
      const idToken = await mintIdToken(state.signWithSecondKey ? secondKey : primaryKey, {
        iss: ISSUER,
        aud: CLIENT_ID,
        sub: "oidc-subject-not-member-id",
        member_id: "member-001",
        name: "Budi Santoso",
        affiliation: "/ppij/ppi-okayama",
        iat: now - state.iatOffset,
        auth_time: now - state.authTimeOffset,
        exp: now + state.expiresIn,
        nonce: state.nonce,
      });
      return json({ access_token: `at-${now}`, token_type: "Bearer", expires_in: state.expiresIn, id_token: idToken });
    }
    return new Response("endpoint tidak dikenal", { status: 500 });
  };
  return { state, fetchImpl };
}

describe("Autentikasi One Login (BFF)", () => {
  let stub: OneLoginStub;
  let jar: CookieJar;
  let app: Hono<AuthEnv>;

  const req = (path: string, init?: RequestInit) =>
    app.request(path, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie: cookieHeader(jar) } });

  const reqStoring = async (path: string, init?: RequestInit) => {
    const res = await req(path, init);
    await storeCookies(res, jar);
    return res;
  };

  /** Memulai /auth/login; menyiapkan nonce tiruan dan mengambil state. */
  const startLogin = async () => {
    const res = await reqStoring("/auth/login?return_to=/pilih");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") as string);
    stub.state.nonce = loc.searchParams.get("nonce") as string;
    return { res, loc, state: loc.searchParams.get("state") as string };
  };

  const callbackUrl = (state: string) =>
    `/auth/callback?code=${encodeURIComponent(stub.state.code)}&state=${encodeURIComponent(state)}`;

  beforeEach(async () => {
    stub = await createOneLoginStub();
    jar = {};
    app = createAuthRoutes({
      loadRuntime: async () => ({ config: CONFIG, masterKey: MASTER_KEY }),
      fetchImpl: stub.fetchImpl,
    });
  });

  it("login mengarahkan ke One Login dengan PKCE, state, nonce, dan max_age", async () => {
    const res = await reqStoring("/auth/login?max_age=600&return_to=/pilih");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") as string);
    expect(loc.origin + loc.pathname).toBe(AUTHORIZATION_ENDPOINT);
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(loc.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(loc.searchParams.get("scope")).toBe("openid ppij-member ppij-affiliation");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    const challenge = loc.searchParams.get("code_challenge") as string;
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const state = loc.searchParams.get("state");
    const nonce = loc.searchParams.get("nonce");
    expect(state).toBeTruthy();
    expect(nonce).toBeTruthy();
    expect(loc.searchParams.get("max_age")).toBe("600");
    // Cookie sementara memuat verifier PKCE dan nonce yang sama.
    const tx = await openAuthTx(jar[AUTH_TX_COOKIE] as string, MASTER_KEY);
    expect(await codeChallenge(tx?.codeVerifier as string)).toBe(challenge);
    expect(tx?.nonce).toBe(nonce);
    expect(tx?.returnTo).toBe("/pilih?masuk=ulang");
    const line = cookieLine(res, AUTH_TX_COOKIE) ?? "";
    expect(line).toContain("HttpOnly");
    expect(line).toContain("Secure");
    expect(line).toContain("SameSite=Lax");
    expect(line).toContain("Max-Age=600");
    expect(line).toContain("Path=/api/auth");
  });

  it("login tanpa max_age tidak mengirim parameter max_age", async () => {
    const res = await reqStoring("/auth/login");
    const loc = new URL(res.headers.get("location") as string);
    expect(loc.searchParams.has("max_age")).toBe(false);
  });

  it("callback valid menukar kode dengan verifier PKCE lalu menyegel sesi", async () => {
    const { loc, state } = await startLogin();
    const res = await reqStoring(callbackUrl(state));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/pilih?masuk=ulang");
    // Token endpoint menerima kode dan code_verifier yang cocok dengan challenge.
    const tokenReq = stub.state.tokenRequests.at(-1) as Record<string, string>;
    expect(tokenReq.grant_type).toBe("authorization_code");
    expect(tokenReq.code).toBe(stub.state.code);
    expect(tokenReq.redirect_uri).toBe(REDIRECT_URI);
    expect(tokenReq.client_id).toBe(CLIENT_ID);
    expect(tokenReq.client_secret).toBe(CLIENT_SECRET);
    expect(await codeChallenge(tokenReq.code_verifier)).toBe(loc.searchParams.get("code_challenge"));
    // Sesi tersimpan tersegel: member_id, nama, affiliation, auth_time.
    const session = await openSession(jar[SESSION_COOKIE] as string, MASTER_KEY);
    expect(session).toMatchObject({
      member_id: "member-001",
      name: "Budi Santoso",
      affiliation: "/ppij/ppi-okayama",
    });
    expect(session?.auth_time).toBeTypeOf("number");
    const line = cookieLine(res, SESSION_COOKIE) ?? "";
    expect(line).toContain("HttpOnly");
    expect(line).toContain("Secure");
    expect(line).toContain("SameSite=Lax");
    expect(line).toContain("Path=/");
    // Cookie sementara dihapus sehingga callback yang sama tidak bisa dipakai ulang.
    expect(jar[AUTH_TX_COOKIE]).toBeUndefined();
  });

  it("/api/me mengembalikan sesi yang sedang masuk", async () => {
    const { state } = await startLogin();
    await reqStoring(callbackUrl(state));
    const res = await reqStoring("/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      member_id: "member-001",
      name: "Budi Santoso",
      affiliation: "/ppij/ppi-okayama",
      auth_time: expect.any(Number),
    });
  });

  it("/api/me menjawab 401 untuk pengunjung anonim", async () => {
    const res = await reqStoring("/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "belum_masuk" });
  });

  it("callback dengan state yang tidak cocok ditolak", async () => {
    await startLogin();
    const res = await reqStoring(`/auth/callback?code=${encodeURIComponent(stub.state.code)}&state=state-palsu`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "state_tidak_valid" });
    expect(jar[SESSION_COOKIE]).toBeUndefined();
    expect(jar[AUTH_TX_COOKIE]).toBeUndefined();
  });

  it("callback yang diputar ulang ditolak karena cookie sementara sudah habis", async () => {
    const { state } = await startLogin();
    const url = callbackUrl(state);
    const first = await reqStoring(url);
    expect(first.status).toBe(302);
    stub.state.code = "kode-otorisasi-2"; // token endpoint selain kode baru menolak.
    const replay = await reqStoring(url);
    expect(replay.status).toBe(400);
    // Pemutar ulang tidak mendapatkan sesi baru.
    expect(cookieLine(replay, SESSION_COOKIE)).toBeUndefined();
  });

  it("id_token kedaluwarsa ditolak dan tidak ada sesi yang dibuat", async () => {
    stub.state.expiresIn = -120;
    stub.state.iatOffset = 700;
    stub.state.authTimeOffset = 700;
    const { state } = await startLogin();
    const res = await reqStoring(callbackUrl(state));
    expect(res.status).toBe(400);
    expect(jar[SESSION_COOKIE]).toBeUndefined();
  });

  it("id_token dengan tanda tangan yang salah ditolak", async () => {
    stub.state.signWithSecondKey = true;
    const { state } = await startLogin();
    const res = await reqStoring(callbackUrl(state));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "verifikasi_gagal" });
    expect(jar[SESSION_COOKIE]).toBeUndefined();
  });

  it("logout menghapus cookie sesi", async () => {
    const { state } = await startLogin();
    await reqStoring(callbackUrl(state));
    expect(jar[SESSION_COOKIE]).toBeTruthy();
    const res = await reqStoring("/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(jar[SESSION_COOKIE]).toBeUndefined();
    const line = cookieLine(res, SESSION_COOKIE) ?? "";
    expect(line).toMatch(/Max-Age=0/);
    const after = await reqStoring("/me");
    expect(after.status).toBe(401);
  });

  it("menjawab 503 ketika One Login belum dikonfigurasi", async () => {
    const bare = createAuthRoutes({ loadRuntime: () => null, fetchImpl: stub.fetchImpl });
    const res = await bare.request("/auth/login");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "one_login_belum_dikonfigurasi" });
  });

  it("login dengan prompt=login meneruskan parameter prompt ke One Login", async () => {
    const res = await reqStoring("/auth/login?prompt=login&return_to=/pilih-suara");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") as string);
    expect(loc.searchParams.get("prompt")).toBe("login");
  });

  it("permintaan login kedua (klik ganda/prefetch Chrome) tidak membatalkan transaksi pertama", async () => {
    const first = await reqStoring("/auth/login?return_to=/pilih");
    const firstLoc = new URL(first.headers.get("location") as string);
    const firstState = firstLoc.searchParams.get("state") as string;
    const firstNonce = firstLoc.searchParams.get("nonce") as string;

    // Permintaan kedua (mis. prefetch/tab lain) menimpa cookie ppij_auth_tx,
    // tetapi transaksi pertama tetap tersimpan di prev.
    await reqStoring("/auth/login?return_to=/akun");
    stub.state.nonce = firstNonce;

    const res = await reqStoring(callbackUrl(firstState));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/pilih?masuk=ulang");
    expect(jar[SESSION_COOKIE]).toBeTruthy();
  });

  it("mengabaikan cookie ppij_session lama yang membayangi cookie sesi baru (RFC 6265)", async () => {
    const { state } = await startLogin();
    await reqStoring(callbackUrl(state));
    const validCookie = encodeURIComponent(jar[SESSION_COOKIE] as string);
    const shadowedHeader = `ppij_session=v1%3Aiv-lama%3Acipher-rusak; ${SESSION_COOKIE}=${validCookie}`;

    const meRes = await app.request("/me", { headers: { cookie: shadowedHeader } });
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toMatchObject({ member_id: "member-001" });

    const normalizedReq = await normalizeAuthCookies(
      new Request("https://pemilu.test/pilih-suara", { headers: { cookie: shadowedHeader } }),
      MASTER_KEY,
    );
    expect(normalizedReq.headers.get("cookie")).toBe(`${SESSION_COOKIE}=${validCookie}`);
  });

  it("memangkas auth_time yang sedikit di masa depan akibat selisih jam server", async () => {
    stub.state.iatOffset = -30;
    stub.state.authTimeOffset = -30;
    const { state } = await startLogin();
    const res = await reqStoring(callbackUrl(state));
    expect(res.status).toBe(302);
    const session = await openSession(jar[SESSION_COOKIE] as string, MASTER_KEY);
    expect(session).toBeTruthy();
    expect(session!.auth_time).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it("navigasi peramban (Accept: text/html) pada callback gagal dialihkan ke /akun atau tujuan bila sudah masuk", async () => {
    const failedHtml = await app.request("/auth/callback?code=x&state=kadaluarsa", {
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    expect(failedHtml.status).toBe(302);
    expect(failedHtml.headers.get("location")).toBe("/akun?masuk=ulang");

    const { state } = await startLogin();
    await reqStoring(callbackUrl(state));
    const replayHtml = await req("/auth/callback?code=x&state=kadaluarsa", {
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    expect(replayHtml.status).toBe(302);
    expect(replayHtml.headers.get("location")).toBe("/");
  });
});
