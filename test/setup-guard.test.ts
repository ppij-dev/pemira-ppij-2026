import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { env, reset } from "cloudflare:test";
import type { Bindings } from "../src/server/app";
import { app as api } from "../src/server/app";
import migrationSql from "../migrations/0001_init.sql?raw";
import {
  KEY_CLAIM_HASH,
  KEY_FIRST_BOOT_AT,
  RECOVERY_COMMAND,
  SETUP_COOKIE,
  SETUP_WINDOW_MS,
  hashToken,
  setupGuard,
} from "../src/server/setup/guard";

// Penyusunan sama seperti src/fetch.ts: penjaga paling depan, lalu halaman.
// Pipeline Astro tidak bisa dimuat di vitest workerd, sehingga halaman diwakili
// penanda berikut: "langkah-1" adalah wizard /setup (tugas 2.2) dan "beranda"
// halaman publik yang harus tersembunyi sebelum pemasangan selesai.
let nowMs = Date.parse("2026-10-18T09:00:00Z");

const site = new Hono<{ Bindings: Bindings }>()
  .use("*", setupGuard({ now: () => new Date(nowMs) }))
  .get("/setup", (c) => c.html("<main>langkah-1</main>"))
  .get("/api/setup/langkah-1", (c) => c.json({ langkah: 1 }))
  .post("/api/setup/langkah-1", (c) => c.json({ dikirim: true }))
  .get("/", (c) => c.html("<main>beranda</main>"))
  .get("/robots.txt", (c) => c.text("User-agent: *"))
  .get("/favicon.svg", (c) => c.text("<svg/>"))
  .get("/_astro/x.css", (c) => c.text("body{}"));

function claimCookie(res: Response): string | null {
  return res.headers.get("Set-Cookie")?.match(new RegExp(`${SETUP_COOKIE}=([^;]+)`))?.[1] ?? null;
}

async function configValue(key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM system_config WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

async function markInitialized(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO system_config (key, value) VALUES ('initialized', '1') " +
      "ON CONFLICT(key) DO UPDATE SET value = '1'",
  ).run();
}

beforeEach(async () => {
  await reset();
  const statements = migrationSql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => env.DB.prepare(statement));
  await env.DB.batch(statements);
  nowMs = Date.parse("2026-10-18T09:00:00Z");
});

describe("kunjungan pertama mengklaim pemasangan", () => {
  it("mencatat first_boot_at, menyetel cookie klaim HttpOnly, dan melanjutkan ke langkah 1", async () => {
    const res = await site.request("/setup", undefined, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("langkah-1");

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain(`Max-Age=${SETUP_WINDOW_MS / 1000}`);

    expect(await configValue(KEY_FIRST_BOOT_AT)).toBe(new Date(nowMs).toISOString());

    // Cookie berisi token acak; di D1 hanya hash SHA-256-nya yang tersimpan.
    const token = claimCookie(res);
    expect(token).toBeTruthy();
    const storedHash = await configValue(KEY_CLAIM_HASH);
    expect(storedHash).not.toBe(token);
    expect(storedHash).toBe(await hashToken(token as string));
  });

  it("peramban pengklaim tetap bisa melanjutkan tanpa mengubah first_boot_at", async () => {
    const first = await site.request("/setup", undefined, env);
    const token = claimCookie(first);
    const bootAt = await configValue(KEY_FIRST_BOOT_AT);

    nowMs += 10 * 60 * 1000;
    const second = await site.request("/setup", {
      headers: { Cookie: `${SETUP_COOKIE}=${token}` },
    }, env);
    expect(second.status).toBe(200);
    expect(await configValue(KEY_FIRST_BOOT_AT)).toBe(bootAt);
  });

  it("peramban pengklaim boleh mengirim langkah wizard", async () => {
    const first = await site.request("/setup", undefined, env);
    nowMs += 10 * 60 * 1000;
    const res = await site.request("/api/setup/langkah-1", {
      method: "POST",
      headers: { Cookie: `${SETUP_COOKIE}=${claimCookie(first)}` },
    }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dikirim: true });
  });
});

describe("peramban kedua selama jendela", () => {
  it("diblokir dengan pesan peramban lain dan tidak bisa mengirim langkah apa pun", async () => {
    const first = await site.request("/setup", undefined, env);
    const bootAt = await configValue(KEY_FIRST_BOOT_AT);
    const claimHash = await configValue(KEY_CLAIM_HASH);
    nowMs += 10 * 60 * 1000;

    const page = await site.request("/setup", undefined, env);
    expect(page.status).toBe(409);
    expect(await page.text()).toContain("Pemasangan sedang dilakukan dari perangkat lain");

    const submit = await site.request("/api/setup/langkah-1", { method: "POST" }, env);
    expect(submit.status).toBe(409);

    // Klaim tidak berpindah: pemilik asli tetap mengatur pemasangan.
    expect(await configValue(KEY_FIRST_BOOT_AT)).toBe(bootAt);
    expect(await configValue(KEY_CLAIM_HASH)).toBe(claimHash);
    expect(claimCookie(page)).toBeNull();
  });

  it("menolak cookie klaim yang cocok tidak atau dimanipulasi", async () => {
    const first = await site.request("/setup", undefined, env);
    const token = claimCookie(first) as string;

    const tampered = await site.request("/setup", {
      headers: { Cookie: `${SETUP_COOKIE}=${token.slice(0, -2)}zz` },
    }, env);
    expect(tampered.status).toBe(409);

    const stale = await site.request("/setup", {
      headers: { Cookie: `cookie_lama=nilai_lain` },
    }, env);
    expect(stale.status).toBe(409);
  });
});

describe("jendela 60 menit berakhir", () => {
  it("masih diizinkan tepat sebelum 60 menit", async () => {
    const first = await site.request("/setup", undefined, env);
    const token = claimCookie(first);
    nowMs += SETUP_WINDOW_MS - 1000;
    const res = await site.request("/setup", {
      headers: { Cookie: `${SETUP_COOKIE}=${token}` },
    }, env);
    expect(res.status).toBe(200);
  });

  it("mengembalikan 423 dengan perintah pemulihan wrangler, juga untuk pengklaim", async () => {
    const first = await site.request("/setup", undefined, env);
    const token = claimCookie(first);
    nowMs += SETUP_WINDOW_MS + 1000;

    const claimer = await site.request("/setup", {
      headers: { Cookie: `${SETUP_COOKIE}=${token}` },
    }, env);
    expect(claimer.status).toBe(423);
    const body = await claimer.text();
    expect(body).toContain("Waktu pemasangan");
    expect(body).toContain(RECOVERY_COMMAND);

    const other = await site.request("/setup", undefined, env);
    expect(other.status).toBe(423);
  });

  it("perintah pemulihan membuka jendela baru untuk klaim berikutnya", async () => {
    const first = await site.request("/setup", undefined, env);
    nowMs += SETUP_WINDOW_MS + 1000;
    expect((await site.request("/setup", undefined, env)).status).toBe(423);

    // Efek perintah pemulihan (design.md keputusan 2) pada system_config
    // key-value: first_boot_at dihapus bila belum terinisialisasi.
    await env.DB.prepare("DELETE FROM system_config WHERE key = ?")
      .bind(KEY_FIRST_BOOT_AT)
      .run();
    nowMs += 5 * 60 * 1000;

    const reopened = await site.request("/setup", undefined, env);
    expect(reopened.status).toBe(200);
    expect(await configValue(KEY_FIRST_BOOT_AT)).toBe(new Date(nowMs).toISOString());

    // Hash lama tertimpa: cookie usang peramban pertama tidak lagi berlaku.
    const newToken = claimCookie(reopened);
    expect(newToken).not.toBe(claimCookie(first));
    expect(await configValue(KEY_CLAIM_HASH)).toBe(await hashToken(newToken as string));
  });
});

describe("halaman sebelum pemasangan selesai", () => {
  it("beranda dan /api lainnya 503 tanpa membocorkan data", async () => {
    const landing = await site.request("/", undefined, env);
    expect(landing.status).toBe(503);
    const body = await landing.text();
    expect(body).toContain("Situs pemilihan ini belum selesai dipasang");
    expect(body).not.toContain("beranda");

    const apiPath = await site.request("/api/pemilihan", undefined, env);
    expect(apiPath.status).toBe(503);
  });

  it("aset statis tetap dilayani", async () => {
    for (const path of ["/robots.txt", "/favicon.svg", "/_astro/x.css"]) {
      const res = await site.request(path, undefined, env);
      expect(res.status, path).toBe(200);
    }
  });
});

describe("setelah pemasangan selesai", () => {
  it("/setup dan /api/setup/* menjawab 404 selamanya, juga dengan cookie klaim", async () => {
    const first = await site.request("/setup", undefined, env);
    const token = claimCookie(first);
    await markInitialized();

    const cookie = { Cookie: `${SETUP_COOKIE}=${token}` };
    const page = await site.request("/setup", { headers: cookie }, env);
    expect(page.status).toBe(404);

    const stepGet = await site.request("/api/setup/langkah-1", { headers: cookie }, env);
    expect(stepGet.status).toBe(404);
    const stepPost = await site.request("/api/setup/langkah-1", {
      method: "POST",
      headers: cookie,
    }, env);
    expect(stepPost.status).toBe(404);
  });

  it("jalur lain berjalan normal kembali", async () => {
    await markInitialized();
    const res = await site.request("/", undefined, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("beranda");
  });
});

describe("klaim bersamaan", () => {
  it("hanya satu peramban yang memenangkan klaim pertama", async () => {
    const [a, b] = await Promise.all([
      site.request("/setup", undefined, env),
      site.request("/setup", undefined, env),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winners = [a, b].filter((res) => res.status === 200);
    expect(winners).toHaveLength(1);
    expect(await configValue(KEY_CLAIM_HASH)).toBe(
      await hashToken(claimCookie(winners[0]) as string),
    );

    const bootRows = await env.DB.prepare(
      "SELECT value FROM system_config WHERE key = ?",
    ).bind(KEY_FIRST_BOOT_AT).all();
    expect(bootRows.results).toHaveLength(1);
  });
});

describe("pemasangan sub-aplikasi di src/server/app.ts", () => {
  it("/api/setup/* terjaga dan mengklaim saat kunjungan pertama", async () => {
    const res = await api.request("/api/setup/langkah-1", undefined, env);
    // Penjaga meloloskan pengklaim (404 dari Hono karena langkah 2.2 belum ada),
    // bukan memblokirnya.
    expect(res.status).toBe(404);
    expect(claimCookie(res)).toBeTruthy();
    expect(await configValue(KEY_FIRST_BOOT_AT)).toBeTruthy();

    const other = await api.request("/api/setup/langkah-1", undefined, env);
    expect(other.status).toBe(409);
  });

  it("/api selain /api/setup tetap bekerja setelah terinisialisasi", async () => {
    await markInitialized();
    const res = await api.request("/api/health", undefined, env);
    expect(res.status).toBe(200);
  });
});
