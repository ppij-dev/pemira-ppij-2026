import type { D1Database } from "@cloudflare/workers-types";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getCookie, setCookie } from "hono/cookie";

/**
 * Penjaga /setup (design.md keputusan 2): mesin status pemasangan satu kali.
 *
 * Sebelum terinisialisasi:
 * - kunjungan pertama mencatat `first_boot_at` di `system_config` dan menyetel
 *   cookie klaim berisi token acak (yang tersimpan hanya hash SHA-256-nya),
 * - hanya peramban pengklaim yang boleh memakai /setup dan /api/setup/*,
 *   dan hanya selama 60 menit sejak `first_boot_at`,
 * - peramban lain diblokir (409) dan tidak bisa mengirim langkah apa pun,
 * - setelah 60 menit semua permintaan /setup mendapat 423 berisi satu perintah
 *   Wrangler untuk membuka jendela ulang,
 * - setiap jalur selain /setup, /api/setup/*, dan aset statis mendapat halaman
 *   "belum selesai dipasang" (503).
 *
 * Setelah terinisialisasi: /setup dan /api/setup/* menjawab 404 selamanya;
 * perubahan lewat Pengaturan.
 */

export const SETUP_WINDOW_MS = 60 * 60 * 1000;
export const SETUP_COOKIE = "setup_claim";

/** Kunci status di system_config (key-value, migrations/0001_init.sql). */
export const KEY_FIRST_BOOT_AT = "first_boot_at";
export const KEY_CLAIM_HASH = "setup_claim_hash";
export const KEY_INITIALIZED = "initialized";

/** Satu perintah untuk membuka kembali jendela pemasangan (design.md keputusan 2). */
export const RECOVERY_COMMAND =
  'npx wrangler d1 execute DB --remote --command "UPDATE system_config SET first_boot_at = NULL WHERE initialized = 0"';

export interface SetupState {
  initialized: boolean;
  first_boot_at: string | null;
  claim_hash: string | null;
}

export interface SetupGuardEnv {
  /** D1: status pemasangan dibaca dari system_config. */
  DB: D1Database;
}

export interface SetupGuardOptions {
  /** Sumber waktu; default jam nyata. Diganti pada pengujian. */
  now?: () => Date;
}

export async function readSetupState(db: D1Database): Promise<SetupState> {
  const rows = await db
    .prepare("SELECT key, value FROM system_config WHERE key IN (?, ?, ?)")
    .bind(KEY_FIRST_BOOT_AT, KEY_CLAIM_HASH, KEY_INITIALIZED)
    .all<{ key: string; value: string }>();
  const valueByKey: Record<string, string> = {};
  for (const row of rows.results) valueByKey[row.key] = row.value;
  return {
    initialized: valueByKey[KEY_INITIALIZED] === "1",
    first_boot_at: valueByKey[KEY_FIRST_BOOT_AT] ?? null,
    claim_hash: valueByKey[KEY_CLAIM_HASH] ?? null,
  };
}

/** Token acak 32 byte, base64url; hanya hash-nya yang pernah disimpan. */
export function generateClaimToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface ClaimResult {
  /** true bila permintaan ini memenangkan klaim pertama. */
  won: boolean;
  token: string | null;
}

/**
 * Merekam `first_boot_at` bila belum ada, lalu menyimpan hash token klaim.
 * INSERT dengan ON CONFLICT DO NOTHING menjadi penentu saat dua peramban
 * datang bersamaan: hanya satu yang mengubah baris, dan hanya pemenang itu
 * yang menulis hash serta menerima cookie.
 */
export async function claimSetup(db: D1Database, claimedAt: Date): Promise<ClaimResult> {
  const inserted = await db
    .prepare("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING")
    .bind(KEY_FIRST_BOOT_AT, claimedAt.toISOString())
    .run();
  if ((inserted.meta.changes ?? 0) !== 1) {
    return { won: false, token: null };
  }
  const token = generateClaimToken();
  await db
    .prepare(
      "INSERT INTO system_config (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(KEY_CLAIM_HASH, await hashToken(token))
    .run();
  return { won: true, token };
}

/** Nama kunci tabel halaman penjaga di bawah. */
type GuardPageKey = "not-installed" | "second-browser" | "window-expired" | "setup-removed";

const GUARD_PAGE_BY_KEY: Record<GuardPageKey, { status: ContentfulStatusCode; title: string; heading: string; paragraphs: string[]; pre?: string }> = {
  "not-installed": {
    status: 503,
    title: "Situs belum selesai dipasang",
    heading: "Situs pemilihan ini belum selesai dipasang",
    paragraphs: [
      "Tim penyelenggara sedang menyelesaikan konfigurasi situs, jadi belum ada data pemilihan yang bisa dilihat atau dikirim di sini.",
      "Silakan kunjungi lagi setelah pemasangan selesai. Terima kasih atas kesabarannya.",
    ],
  },
  "second-browser": {
    status: 409,
    title: "Pemasangan sedang berlangsung",
    heading: "Pemasangan sedang dilakukan dari perangkat lain",
    paragraphs: [
      "Hanya satu perangkat yang boleh menjalankan pemasangan agar konfigurasi situs tetap aman.",
      "Jika perangkat itu milik Anda, lanjutkan dari tab pemasangan di perangkat tersebut. Jendela pemasangan berlangsung 60 menit sejak kunjungan pertama.",
    ],
  },
  "window-expired": {
    status: 423,
    title: "Waktu pemasangan berakhir",
    heading: "Waktu pemasangan sudah berakhir",
    paragraphs: [
      "Jendela pemasangan 60 menit telah lewat. Untuk membuka jendela baru, jalankan perintah berikut, lalu muat ulang halaman /setup:",
    ],
    pre: RECOVERY_COMMAND,
  },
  "setup-removed": {
    status: 404,
    title: "Halaman tidak ditemukan",
    heading: "Halaman tidak ditemukan",
    paragraphs: ["Alamat yang Anda buka tidak tersedia di situs ini."],
  },
};

function guardPage(key: GuardPageKey): { html: string; status: ContentfulStatusCode } {
  const page = GUARD_PAGE_BY_KEY[key];
  const html = [
    "<!doctype html>",
    '<html lang="id">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${page.title}</title>`,
    "<style>",
    "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7f8;",
    "color:#1f2430;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}",
    "main{max-width:34rem;padding:2.5rem;background:#fff;border:1px solid #e3e5ea;",
    "border-radius:12px;text-align:center}",
    "h1{font-size:1.35rem;margin:0 0 1rem}",
    "p{line-height:1.6;margin:0 0 .75rem}",
    "pre{background:#f1f2f5;border:1px solid #e3e5ea;border-radius:8px;padding:.75rem 1rem;",
    "text-align:left;overflow-x:auto;font-size:.85rem;margin:1rem 0 0}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    `<h1>${page.heading}</h1>`,
    ...page.paragraphs.map((p) => `<p>${p}</p>`),
    ...(page.pre ? [`<pre><code>${page.pre}</code></pre>`] : []),
    "</main>",
    "</body>",
    "</html>",
  ].join("");
  return { html, status: page.status };
}

/**
 * Middleware penjaga /setup. Dipasang sekali di paling depan (seperti noindex):
 * di src/fetch.ts untuk seluruh situs, dan pada sub-aplikasi /api/setup di
 * src/server/setup/routes.ts.
 */
export function setupGuard(options: SetupGuardOptions = {}): MiddlewareHandler<{
  Bindings: SetupGuardEnv;
}> {
  const now = options.now ?? (() => new Date());
  return async (c, next) => {
    const state = await readSetupState(c.env.DB);
    const { pathname } = new URL(c.req.url);
    const onSetupPath =
      pathname === "/setup" ||
      pathname.startsWith("/setup/") ||
      pathname === "/api/setup" ||
      pathname.startsWith("/api/setup/");
    // Aset statis tetap dilayani saat situs belum terpasang (specs/system-onboarding).
    const staticAsset =
      pathname.startsWith("/_astro/") ||
      pathname === "/robots.txt" ||
      pathname === "/favicon.svg";

    if (state.initialized) {
      // /setup ditutup selamanya; perubahan konfigurasi lewat Pengaturan.
      if (!onSetupPath) return next();
      const removed = guardPage("setup-removed");
      return c.html(removed.html, removed.status);
    }

    if (!onSetupPath) {
      if (staticAsset) return next();
      const notInstalled = guardPage("not-installed");
      return c.html(notInstalled.html, notInstalled.status);
    }

    const bootMs = state.first_boot_at == null ? null : Date.parse(state.first_boot_at);
    if (bootMs != null && (Number.isNaN(bootMs) || now().getTime() - bootMs >= SETUP_WINDOW_MS)) {
      const expired = guardPage("window-expired");
      return c.html(expired.html, expired.status);
    }

    if (state.first_boot_at == null) {
      const claim = await claimSetup(c.env.DB, now());
      if (claim.won && claim.token) {
        setCookie(c, SETUP_COOKIE, claim.token, {
          httpOnly: true,
          sameSite: "Lax",
          path: "/",
          // Masa berlaku cookie sama dengan jendela klaim; token lama tak
          // berguna setelah jendela berakhir atau dibuka ulang lewat perintah
          // pemulihan, dan klaim baru selalu menimpa hash lama.
          maxAge: SETUP_WINDOW_MS / 1000,
          secure: new URL(c.req.url).protocol === "https:",
        });
        return next();
      }
      // Kalah bersaing saat klaim pertama: perlakukan seperti peramban kedua.
    }

    const token = getCookie(c, SETUP_COOKIE);
    const validClaim =
      token != null &&
      state.claim_hash != null &&
      (await hashToken(token)) === state.claim_hash;
    if (validClaim) return next();
    const blocked = guardPage("second-browser");
    return c.html(blocked.html, blocked.status);
  };
}
