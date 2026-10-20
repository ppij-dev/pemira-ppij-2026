import { readFile } from "node:fs/promises";
import { getPlatformProxy } from "wrangler";

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
const proxy = await getPlatformProxy({ remoteBindings: false });
try {
  const db = proxy.env.DB;
  const initialized = await db.prepare("SELECT value FROM system_config WHERE key='initialized'").first();
  if (initialized?.value === "1") {
    console.log("Situs sudah diinisialisasi; tidak ada perubahan.");
    process.exitCode = 0;
  } else {
    const existingAdmins = await db.prepare("SELECT member_id FROM admin_voting").all();
    if (existingAdmins.results.length) throw new Error("Data bootstrap parsial: admin sudah ada tanpa situs terinisialisasi; operator perlu memeriksa basis data.");
    const now = new Date().toISOString();
    const results = await db.batch([
      db.prepare("INSERT INTO elections (title, status_lock) SELECT ?, 'draft' WHERE NOT EXISTS (SELECT 1 FROM elections)").bind(config.SITE_NAME.trim()),
      db.prepare("INSERT INTO admin_voting (member_id, name, is_technical, created_at) VALUES (?, 'Technical Admin', 1, ?)").bind(memberId, now),
      db.prepare("INSERT INTO system_config (key, value) VALUES ('site_scope', ?), ('site_base_url', ?), ('site_name', ?), ('site_logo_path', ?)").bind(config.SITE_SCOPE.trim(), config.SITE_BASE_URL.trim(), config.SITE_NAME.trim(), (config.SITE_LOGO_PATH || "/logo.svg").trim()),
      db.prepare("INSERT INTO system_config (key, value) VALUES ('initialized', '1')"),
    ]);
    if (results.some((result) => result.success === false)) throw new Error("Bootstrap tidak dapat diselesaikan; basis data belum diinisialisasi.");
    console.log("Bootstrap situs selesai.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Bootstrap gagal.");
  process.exitCode = 1;
} finally {
  await proxy.dispose();
}
