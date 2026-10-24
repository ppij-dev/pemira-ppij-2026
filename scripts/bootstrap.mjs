import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { buildBootstrapStatements, escapeSqlString } from "./bootstrap-sql.mjs";

export { buildBootstrapStatements, escapeSqlString };

const execFileAsync = promisify(execFile);

export const REQUIRED_CONFIG = [
  "ONELOGIN_ISSUER",
  "ONELOGIN_CLIENT_ID",
  "ONELOGIN_CLIENT_SECRET",
  "SERVICE_API_URL",
  "SERVICE_API_CLIENT_ID",
  "SERVICE_API_CLIENT_SECRET",
  "SITE_SCOPE",
  "SITE_BASE_URL",
  "SITE_NAME",
  "APP_MASTER_KEY",
];

export const USAGE_TEXT =
  "Gunakan: npm run bootstrap -- <member_id Admin Voting pertama> atau npm run bootstrap -- --remote --database <nama_d1> <member_id>";

export function parseBootstrapArgs(argv) {
  let isRemote = false;
  let database = "";
  let dryRun = false;
  let memberId = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--remote") {
      isRemote = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--database" || arg === "-d") {
      i++;
      if (i >= argv.length) {
        throw new Error(USAGE_TEXT);
      }
      const val = argv[i].trim();
      if (!val || val.startsWith("-")) {
        throw new Error(USAGE_TEXT);
      }
      database = val;
    } else if (arg.startsWith("--database=")) {
      const val = arg.slice("--database=".length).trim();
      if (!val || val.startsWith("-")) {
        throw new Error(USAGE_TEXT);
      }
      database = val;
    } else if (arg.startsWith("-")) {
      throw new Error(USAGE_TEXT);
    } else {
      if (memberId) {
        throw new Error(USAGE_TEXT);
      }
      memberId = arg.trim();
    }
  }

  if (!memberId) {
    throw new Error(USAGE_TEXT);
  }

  if (database && !isRemote) {
    throw new Error(USAGE_TEXT);
  }

  if (isRemote && !database) {
    throw new Error(USAGE_TEXT);
  }

  return { isRemote, database, dryRun, memberId };
}

export async function loadConfig(devVarsPath = new URL("../.dev.vars", import.meta.url), env = process.env) {
  let local = {};
  try {
    const content = await readFile(devVarsPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match) local[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {}
  return { ...local, ...env };
}

export function validateConfig(config) {
  if (!config || typeof config !== "object") return false;
  return REQUIRED_CONFIG.every((key) => typeof config[key] === "string" && config[key].trim().length > 0);
}

export function validateSiteScope(scope) {
  if (typeof scope !== "string") return false;
  const trimmed = scope.trim();
  return trimmed.startsWith("/") && !/\s/.test(trimmed);
}

export function extractD1Results(raw) {
  if (raw === null || raw === undefined) {
    throw new Error("Keluaran basis data D1 kosong.");
  }
  let parsed;
  if (typeof raw !== "string") {
    parsed = raw;
  } else {
    const text = raw.trim();
    if (!text) {
      throw new Error("Keluaran basis data D1 kosong.");
    }
    const jsonStart = text.search(/[{\[]/);
    const jsonEnd = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
      throw new Error("Keluaran basis data D1 tidak dapat diurai sebagai JSON.");
    }
    const jsonStr = text.slice(jsonStart, jsonEnd + 1);
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error("Keluaran basis data D1 tidak dapat diurai sebagai JSON.");
    }
  }

  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && Array.isArray(parsed[0]?.results)) {
      return parsed[0].results;
    }
    throw new Error("Keluaran basis data D1 tidak memiliki array hasil.");
  }

  if (parsed && typeof parsed === "object" && Array.isArray(parsed.results)) {
    return parsed.results;
  }

  throw new Error("Keluaran basis data D1 tidak memiliki array hasil.");
}

export async function defaultExecutor(file, args) {
  return await execFileAsync(file, args, { encoding: "utf8" });
}

export async function runExecutor(executor, bin, args) {
  if (typeof executor !== "function") {
    throw new TypeError("Executor must be a function");
  }
  if (executor.length === 1) {
    return await executor(args);
  }
  return await executor(bin, args);
}

export async function runRemoteBootstrap({
  database,
  memberId,
  config,
  executor = defaultExecutor,
  wranglerBin = "wrangler",
}) {
  if (!database || !database.trim()) {
    throw new Error("Nama basis data D1 wajib diisi untuk mode --remote (--database <nama>).");
  }
  const dbName = database.trim();

  // 1. Check if already initialized
  const initCheckOutput = await runExecutor(executor, wranglerBin, [
    "d1",
    "execute",
    dbName,
    "--remote",
    "--json",
    "--command",
    "SELECT value FROM system_config WHERE key='initialized'",
  ]);

  const initRows = extractD1Results(initCheckOutput?.stdout ?? initCheckOutput);
  if (initRows.length > 0 && initRows[0]?.value === "1") {
    console.log("Situs sudah diinisialisasi; tidak ada perubahan.");
    return { alreadyInitialized: true };
  }

  // 2. Check if admins exist without initialization (partial state)
  const adminCheckOutput = await runExecutor(executor, wranglerBin, [
    "d1",
    "execute",
    dbName,
    "--remote",
    "--json",
    "--command",
    "SELECT member_id FROM admin_voting",
  ]);

  const adminRows = extractD1Results(adminCheckOutput?.stdout ?? adminCheckOutput);
  if (adminRows.length > 0) {
    throw new Error(
      "Data bootstrap parsial: admin sudah ada tanpa situs terinisialisasi; operator perlu memeriksa basis data."
    );
  }

  // 3. Build statements and write to temporary file
  const now = new Date().toISOString();
  const logoPath =
    typeof config.SITE_LOGO_PATH === "string" && config.SITE_LOGO_PATH.trim()
      ? config.SITE_LOGO_PATH.trim()
      : "/pemira-2026-logo.png";

  const statements = buildBootstrapStatements({
    memberId: memberId.trim(),
    siteName: config.SITE_NAME.trim(),
    siteScope: config.SITE_SCOPE.trim(),
    siteBaseUrl: config.SITE_BASE_URL.trim(),
    siteLogoPath: logoPath,
    now,
  });

  const sqlContent = statements.map((s) => `${s};`).join("\n") + "\n";
  const tempDir = await mkdtemp(join(tmpdir(), "bootstrap-"));
  const tempFile = join(tempDir, "bootstrap.sql");

  try {
    await writeFile(tempFile, sqlContent, "utf8");
    await runExecutor(executor, wranglerBin, [
      "d1",
      "execute",
      dbName,
      "--remote",
      "--file",
      tempFile,
    ]);
    console.log("Bootstrap situs selesai.");
    return { success: true };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runLocalBootstrap({
  memberId,
  config,
}) {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy({ remoteBindings: false });
  try {
    const db = proxy.env.DB;
    const initialized = await db
      .prepare("SELECT value FROM system_config WHERE key='initialized'")
      .first();
    if (initialized?.value === "1") {
      console.log("Situs sudah diinisialisasi; tidak ada perubahan.");
      return { alreadyInitialized: true };
    }

    const existingAdmins = await db.prepare("SELECT member_id FROM admin_voting").all();
    if (existingAdmins.results?.length) {
      throw new Error(
        "Data bootstrap parsial: admin sudah ada tanpa situs terinisialisasi; operator perlu memeriksa basis data."
      );
    }

    const now = new Date().toISOString();
    const logoPath =
      typeof config.SITE_LOGO_PATH === "string" && config.SITE_LOGO_PATH.trim()
        ? config.SITE_LOGO_PATH.trim()
        : "/pemira-2026-logo.png";

    const statements = buildBootstrapStatements({
      memberId: memberId.trim(),
      siteName: config.SITE_NAME.trim(),
      siteScope: config.SITE_SCOPE.trim(),
      siteBaseUrl: config.SITE_BASE_URL.trim(),
      siteLogoPath: logoPath,
      now,
    });

    const results = await db.batch(statements.map((statement) => db.prepare(statement)));
    if (results.some((result) => result.success === false)) {
      throw new Error("Bootstrap tidak dapat diselesaikan; basis data belum diinisialisasi.");
    }

    console.log("Bootstrap situs selesai.");
    return { success: true };
  } finally {
    await proxy.dispose();
  }
}

export async function main(
  argv = process.argv.slice(2),
  {
    executor = defaultExecutor,
    env = process.env,
    devVarsPath,
    wranglerBin = "wrangler",
  } = {}
) {
  let parsed;
  try {
    parsed = parseBootstrapArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : USAGE_TEXT);
    process.exitCode = 1;
    return;
  }

  const { isRemote, database, dryRun, memberId } = parsed;

  const config = await loadConfig(devVarsPath, env);
  if (!validateConfig(config)) {
    console.error("Konfigurasi operator belum lengkap; bootstrap dibatalkan.");
    process.exitCode = 1;
    return;
  }

  if (!validateSiteScope(config.SITE_SCOPE)) {
    console.error("SITE_SCOPE tidak valid: harus diawali dengan '/' dan tidak boleh mengandung spasi (contoh: '/ppij/okayama').");
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    const now = new Date().toISOString();
    const logoPath =
      typeof config.SITE_LOGO_PATH === "string" && config.SITE_LOGO_PATH.trim()
        ? config.SITE_LOGO_PATH.trim()
        : "/pemira-2026-logo.png";
    const statements = buildBootstrapStatements({
      memberId,
      siteName: config.SITE_NAME.trim(),
      siteScope: config.SITE_SCOPE.trim(),
      siteBaseUrl: config.SITE_BASE_URL.trim(),
      siteLogoPath: logoPath,
      now,
    });
    console.log(statements.map((s) => `${s};`).join("\n"));
    return;
  }

  try {
    if (isRemote) {
      await runRemoteBootstrap({
        database,
        memberId,
        config,
        executor,
        wranglerBin,
      });
    } else {
      await runLocalBootstrap({
        memberId,
        config,
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Bootstrap gagal.");
    process.exitCode = 1;
    throw error;
  }
}

if (typeof process !== "undefined" && process.argv?.[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Bootstrap gagal.");
    process.exitCode = 1;
  });
}
