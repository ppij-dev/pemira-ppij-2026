import type { D1Database } from "@cloudflare/workers-types";

export interface RuntimeConfig {
  ONELOGIN_ISSUER: string;
  ONELOGIN_CLIENT_ID: string;
  ONELOGIN_CLIENT_SECRET: string;
  SERVICE_API_URL: string;
  SERVICE_API_CLIENT_ID: string;
  SERVICE_API_CLIENT_SECRET: string;
  SITE_SCOPE: string;
  SITE_BASE_URL: string;
  SITE_NAME: string;
  SITE_LOGO_PATH: string;
  APP_MASTER_KEY: string;
}

const REQUIRED_CONFIG: (keyof RuntimeConfig)[] = [
  "ONELOGIN_ISSUER", "ONELOGIN_CLIENT_ID", "ONELOGIN_CLIENT_SECRET",
  "SERVICE_API_URL", "SERVICE_API_CLIENT_ID", "SERVICE_API_CLIENT_SECRET",
  "SITE_SCOPE", "SITE_BASE_URL", "SITE_NAME", "APP_MASTER_KEY",
];

export function loadRuntimeConfig(source: Record<string, unknown>): RuntimeConfig | null {
  if (REQUIRED_CONFIG.some((key) => typeof source[key] !== "string" || !(source[key] as string).trim())) return null;
  const logo = source.SITE_LOGO_PATH;
  return {
    ...(Object.fromEntries(REQUIRED_CONFIG.map((key) => [key, (source[key] as string).trim()])) as Omit<RuntimeConfig, "SITE_LOGO_PATH">),
    SITE_LOGO_PATH: typeof logo === "string" && logo.trim() ? logo.trim() : "/logo.svg",
  };
}

export async function bootstrapSite(db: D1Database, config: RuntimeConfig | null, memberId: string): Promise<boolean> {
  if (!config || !memberId.trim()) return false;
  const initialized = await db.prepare("SELECT value FROM system_config WHERE key = 'initialized'").first<{value:string}>();
  if (initialized?.value === "1") return true;
  const hasConfig = loadRuntimeConfig({ ...config });
  if (!hasConfig) return false;
  const existing = await db.prepare("SELECT id FROM elections LIMIT 1").first();
  if (existing) return false;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO elections (title, status_lock) VALUES (?, 'draft')").bind(hasConfig.SITE_NAME),
    db.prepare("INSERT INTO admin_voting (member_id, name, is_technical, created_at) VALUES (?, 'Technical Admin', 1, ?)").bind(memberId.trim(), now),
    db.prepare("INSERT INTO system_config (key, value) VALUES ('site_scope', ?), ('site_base_url', ?), ('site_name', ?), ('site_logo_path', ?), ('initialized', '1')").bind(hasConfig.SITE_SCOPE, hasConfig.SITE_BASE_URL, hasConfig.SITE_NAME, hasConfig.SITE_LOGO_PATH),
  ]);
  return true;
}
