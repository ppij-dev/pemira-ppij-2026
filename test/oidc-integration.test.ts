import { beforeAll, describe, expect, it } from "vitest";
import { fetchDiscovery, fetchJwks, OidcError, verifyIdToken, type AuthConfig, type IdTokenClaims, type OidcDiscovery, type Jwk } from "../src/server/auth/oidc";

const issuer = process.env.OIDC_TEST_ISSUER ?? "http://127.0.0.1:38180/realms/election-test";
const clientId = process.env.OIDC_TEST_DIRECT_CLIENT_ID ?? "election-test-direct";
const username = process.env.OIDC_TEST_USERNAME ?? "election-active";
const password = process.env.OIDC_TEST_PASSWORD ?? "test-password";
const staleAge = Number(process.env.OIDC_TEST_MAX_AUTH_AGE_SECONDS ?? "300");
const config: Pick<AuthConfig, "issuer" | "clientId"> = { issuer, clientId };
let skipReason: string | undefined;
let discovery: OidcDiscovery;
let jwks: Jwk[];
let claims: IdTokenClaims;

async function getToken(user: string, pass: string): Promise<string> {
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: clientId, username: user, password: pass, scope: "openid" }),
  });
  if (!response.ok) throw new Error(`Direct Access Grant failed: HTTP ${response.status} ${await response.text()}`);
  const data = await response.json() as { id_token?: string };
  if (!data.id_token) throw new Error("Keycloak response omitted id_token");
  return data.id_token;
}

beforeAll(async () => {
  try {
    discovery = await fetchDiscovery(issuer);
    jwks = await fetchJwks(discovery.jwks_uri);
    const token = await getToken(username, password);
    claims = await verifyIdToken(token, { config, jwks });
  } catch (error) {
    if (error instanceof TypeError || (error instanceof OidcError && error.code === "one_login_tidak_terjangkau") || (error instanceof Error && /fetch failed|ECONNREFUSED|ETIMEDOUT/i.test(error.message))) {
      skipReason = `Warm Keycloak unavailable at ${issuer}; provision with scripts/provision-election-test.mjs (${String(error)})`;
      return;
    }
    throw error;
  }
});

describe("warm Keycloak OIDC", () => {
  it("fetches issuer discovery and JWKS, then verifies a real signed id_token", ({ skip }) => {
    if (skipReason) return skip(skipReason);
    expect(discovery.issuer).toBe(issuer);
    expect(jwks.length).toBeGreaterThan(0);
    expect(claims.iss).toBe(issuer);
    expect(claims.member_id).toBe("test-active");
    expect(claims.affiliation).toEqual(["/ppij/okayama"]);
  });

  it("classifies fresh and stale auth_time values", ({ skip }) => {
    if (skipReason) return skip(skipReason);
    const authTime = claims.auth_time ?? claims.iat;
    expect(typeof authTime).toBe("number");
    const now = Math.floor(Date.now() / 1000);
    expect(now - authTime <= staleAge).toBe(true);
    expect(now - (authTime - staleAge - 1) <= staleAge).toBe(false);
  });

  it.each([
    ["election-suspended", "test-suspended", undefined],
    ["election-out-of-scope", "test-out-of-scope", "/ppij/kyodai"],
  ])("receives expected identity claims for %s", async (user, memberId, affiliation) => {
    if (skipReason) return;
    const token = await getToken(user, password);
    const userClaims = await verifyIdToken(token, { config, jwks });
    expect(userClaims.member_id).toBe(memberId);
    expect(userClaims.affiliation).toEqual(affiliation === undefined ? undefined : [affiliation]);
  });
});
