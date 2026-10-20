import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const file = new URL("../.dev.vars", import.meta.url);
let local = {};
try {
  for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) local[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {}
const config = { ...local, ...process.env };
const required = ["ONELOGIN_ISSUER", "ONELOGIN_CLIENT_ID", "ONELOGIN_CLIENT_SECRET", "SERVICE_API_URL", "SERVICE_API_CLIENT_ID", "SERVICE_API_CLIENT_SECRET", "SITE_SCOPE", "SITE_BASE_URL", "SITE_NAME", "APP_MASTER_KEY"];
if (required.some((key) => typeof config[key] !== "string" || !config[key].trim())) {
  console.error("Konfigurasi operator belum lengkap; bootstrap dibatalkan.");
  process.exit(1);
}
const memberId = process.argv[2]?.trim();
if (!memberId) {
  console.error("Gunakan: npm run bootstrap -- <member_id Admin Voting pertama>");
  process.exit(1);
}
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const name = quote(config.SITE_NAME.trim());
const member = quote(memberId);
const scope = quote(config.SITE_SCOPE.trim());
const baseUrl = quote(config.SITE_BASE_URL.trim());
const logoPath = quote((config.SITE_LOGO_PATH || "/logo.svg").trim());
const now = quote(new Date().toISOString());
// A single SQLite statement makes election/admin/config visibility atomic. The
// unique election/admin keys make concurrent and repeated invocations harmless.
const sql = `INSERT INTO elections (title, status_lock) SELECT ${name}, 'draft' WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE key='initialized' AND value='1') AND NOT EXISTS (SELECT 1 FROM elections); INSERT INTO admin_voting (member_id, name, is_technical, created_at) SELECT ${member}, 'Technical Admin', 1, ${now} WHERE EXISTS (SELECT 1 FROM elections) AND NOT EXISTS (SELECT 1 FROM system_config WHERE key='initialized' AND value='1'); INSERT INTO system_config (key,value) SELECT 'site_scope',${scope} WHERE EXISTS (SELECT 1 FROM admin_voting WHERE member_id=${member}) AND NOT EXISTS (SELECT 1 FROM system_config WHERE key='initialized' AND value='1'); INSERT INTO system_config (key,value) SELECT 'site_base_url',${baseUrl} WHERE EXISTS (SELECT 1 FROM admin_voting WHERE member_id=${member}) AND NOT EXISTS (SELECT 1 FROM system_config WHERE key='initialized' AND value='1'); INSERT INTO system_config (key,value) SELECT 'site_name',${name} WHERE EXISTS (SELECT 1 FROM admin_voting WHERE member_id=${member}) AND NOT EXISTS (SELECT 1 FROM system_config WHERE key='initialized' AND value='1'); INSERT INTO system_config (key,value) SELECT 'site_logo_path',${logoPath} WHERE EXISTS (SELECT 1 FROM admin_voting WHERE member_id=${member}) AND NOT EXISTS (SELECT 1 FROM system_config WHERE key='initialized' AND value='1'); INSERT INTO system_config (key,value) SELECT 'initialized','1' WHERE EXISTS (SELECT 1 FROM admin_voting WHERE member_id=${member}) AND EXISTS (SELECT 1 FROM elections WHERE title=${name} AND status_lock='draft') AND NOT EXISTS (SELECT 1 FROM system_config WHERE key='initialized' AND value='1');`;
const result = spawnSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", sql], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
