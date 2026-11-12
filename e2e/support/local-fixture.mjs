/**
 * Fixture e2e: samakan kunci sesi, terapkan migrasi D1 lokal, lalu isi satu
 * pemilihan draf dengan satu Admin Voting. Dijalankan sebelum build/preview
 * (lihat playwright.config.ts) dan dipakai spec untuk membuat cookie sesi yang
 * disegel dengan kunci yang sama seperti server.
 *
 * `.dev.vars` dibuat acak bila belum ada supaya mesin baru bisa menjalankan
 * e2e tanpa menyiapkan rahasia lebih dulu; berkas itu tidak pernah di-commit.
 */
import { execFileSync } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEV_VARS = ".dev.vars";
export const ADMIN_MEMBER_ID = "admin-e2e";
const SCOPE = "/ppij/okayama";

const SEED_SQL = `
INSERT INTO elections (title, status_lock) SELECT 'Pemilihan PPI Jepang', 'draft' WHERE NOT EXISTS (SELECT 1 FROM elections);
INSERT OR REPLACE INTO admin_voting (member_id, name, is_technical, created_at) VALUES ('${ADMIN_MEMBER_ID}', 'Admin E2E', 1, '2026-01-01T00:00:00Z');
INSERT OR REPLACE INTO system_config (key, value) VALUES ('site_scope','${SCOPE}'),('site_base_url','http://localhost:4321'),('site_name','Pemilihan PPI Jepang'),('site_logo_path','/ppij-logo.png'),('initialized','1');
INSERT OR REPLACE INTO voters (member_id,name,member_number,category,can_vote,komsat_path,status,synced_at) VALUES ('member-e2e','Budi Santoso','OKA-2026-0001','BIASA',1,'${SCOPE}/komsat-okayama','ACTIVE','2026-01-01T00:00:00Z');
INSERT OR REPLACE INTO voters (member_id,name,member_number,category,can_vote,komsat_path,status,synced_at) VALUES ('member-e2e-2','Siti Aminah','OKA-2026-0002','BIASA',0,'${SCOPE}/komsat-okayama','ACTIVE','2026-01-01T00:00:00Z');
`;

/** Kunci AES-256-GCM (base64) yang juga dipakai server; `.dev.vars` dibuat bila perlu. */
export function masterKey() {
  if (existsSync(DEV_VARS)) {
    const match = readFileSync(DEV_VARS, "utf8").match(/^APP_MASTER_KEY=(.+)$/m);
    if (match) return match[1].trim();
  }
  const key = randomBytes(32).toString("base64");
  writeFileSync(DEV_VARS, `APP_MASTER_KEY=${key}\nONELOGIN_CLIENT_SECRET=e2e\nSERVICE_API_CLIENT_SECRET=e2e\n`);
  return key;
}

/** Format cookie sesi: `v1:<iv base64>:<ciphertext+tag base64>` (lihat src/server/auth/session.ts). */
export function sealSession(session, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64")}`;
}

/** Cookie `ppij_session` milik Admin Voting fixture untuk domain localhost. */
export function sessionCookie() {
  return sealSession({ member_id: ADMIN_MEMBER_ID, name: "Admin E2E", affiliation: SCOPE, auth_time: Math.floor(Date.now() / 1000) }, masterKey());
}

function wrangler(args) {
  return execFileSync("npx", ["wrangler", "d1", ...args, "--local"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Terapkan migrasi dan isi data fixture (aman diulang). */
export function seedLocalDatabase() {
  masterKey();
  wrangler(["migrations", "apply", "DB"]);
  const dir = mkdtempSync(join(tmpdir(), "ppij-e2e-"));
  const file = join(dir, "seed.sql");
  try {
    writeFileSync(file, SEED_SQL);
    execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", `--file=${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith("local-fixture.mjs")) {
  seedLocalDatabase();
  console.log("[e2e] D1 lokal disiapkan untuk Admin Voting " + ADMIN_MEMBER_ID);
}
