#!/usr/bin/env node
/**
 * Provision the isolated election-test realm in an existing warm Keycloak.
 * Usage: KC_URL=http://127.0.0.1:38180 KC_ADMIN_USER=admin KC_ADMIN_PASSWORD=admin-test APP_CLIENT_SECRET=<secret> node scripts/provision-election-test.mjs
 * Flags: --kc-url URL, --admin-user USER, --admin-password PASSWORD, --app-client-secret SECRET.
 * This script deletes/recreates only election-test; it never touches ppij or containers.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const flags = new Map();
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) throw new Error(`Unexpected argument: ${args[i]}`);
  if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value for ${args[i]}`);
  flags.set(args[i].slice(2), args[++i]);
}
const setting = (flag, env, fallback) => flags.get(flag) ?? process.env[env] ?? fallback;
const base = setting("kc-url", "KC_URL", "http://127.0.0.1:38180").replace(/\/$/, "");
const adminUser = setting("admin-user", "KC_ADMIN_USER", "admin");
const adminPassword = setting("admin-password", "KC_ADMIN_PASSWORD", "admin-test");
const secret = setting("app-client-secret", "APP_CLIENT_SECRET", "election-test-app-secret");
const tokenResponse = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: adminUser, password: adminPassword }),
});
if (!tokenResponse.ok) throw new Error(`Keycloak admin login failed: HTTP ${tokenResponse.status}`);
const token = (await tokenResponse.json()).access_token;
const api = async (url, init = {}) => {
  const response = await fetch(`${base}${url}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  if (!response.ok && response.status !== 404) throw new Error(`Keycloak Admin API ${init.method ?? "GET"} ${url}: HTTP ${response.status} ${await response.text()}`);
  return response;
};
const fixturePath = fileURLToPath(new URL("../test/fixtures/election-test-realm.json", import.meta.url));
const realm = JSON.parse(await readFile(fixturePath, "utf8"));
realm.clients[0].secret = secret;
await api("/admin/realms/election-test", { method: "DELETE" });
const created = await api("/admin/realms", { method: "POST", body: JSON.stringify(realm) });
if (created.status !== 201) throw new Error(`Realm create returned HTTP ${created.status}`);
for (const username of ["election-active", "election-suspended", "election-out-of-scope"]) {
  const users = await api(`/admin/realms/election-test/users?username=${encodeURIComponent(username)}`);
  const matches = await users.json();
  if (matches.length !== 1) throw new Error(`Expected exactly one ${username} user, found ${matches.length}`);
  await api(`/admin/realms/election-test/users/${matches[0].id}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({ type: "password", value: "test-password", temporary: false }),
  });
}
console.log(`Provisioned ${base}/realms/election-test; app client secret configured from environment/flag.`);
