import type { D1Database } from "@cloudflare/workers-types";
import type { MiddlewareHandler } from "hono";

export interface SetupGuardEnv { DB: D1Database }

export function setupGuard(): MiddlewareHandler<{ Bindings: SetupGuardEnv }> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/setup" || path.startsWith("/setup/") || path === "/api/setup" || path.startsWith("/api/setup/")) return c.notFound();
    const isStatic = path.startsWith("/_astro/") || path === "/robots.txt" || path === "/favicon.svg" || path.startsWith("/assets/");
    if (isStatic) return next();
    const row = await c.env.DB.prepare("SELECT value FROM system_config WHERE key = 'initialized'").first<{value:string}>();
    if (row?.value === "1") return next();
    return c.html('<!doctype html><html lang="id"><meta charset="utf-8"><title>Situs belum siap</title><main><h1>Situs pemilihan ini belum siap</h1><p>Tim penyelenggara sedang menyelesaikan konfigurasi situs. Silakan kunjungi kembali nanti.</p></main></html>', 503);
  };
}
