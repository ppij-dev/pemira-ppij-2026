import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { noindex } from "../src/server/middleware/noindex";
import { app as api } from "../src/server/app";
import baseLayout from "../src/layouts/Base.astro?raw";
import robotsTxt from "../public/robots.txt?raw";

// Keluaran build (dist/ di-gitignore): bila `npm run build` pernah dijalankan,
// pemeriksaan meta robots juga dilakukan pada berkas terkompilasi.
const compiled = import.meta.glob<string>("../dist/server/chunks/*.mjs", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Penyusunan sama seperti src/fetch.ts (middleware noindex paling awal,
// lalu /api dan pipeline halaman). Aplikasi lengkap src/fetch.ts tidak bisa
// dimuat di vitest workerd karena pipeline Astro membutuhkan modul virtual
// hasil build, sehingga perayapan halaman diwakili handler HTML berikut.
const site = new Hono()
  .use("*", noindex)
  .route("/", api)
  .use((c) =>
    c.html(
      '<!doctype html><html lang="id"><head><title>Uji</title></head><body><p>Halaman uji.</p></body></html>',
    ),
  );

describe("X-Robots-Tag", () => {
  it("terpasang pada respons /api", async () => {
    const res = await site.request("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("terpasang pada respons halaman HTML", async () => {
    const res = await site.request("/");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
});

describe("robots.txt", () => {
  it("melarang semua perayap tanpa sitemap", () => {
    expect(robotsTxt).toContain("User-agent: *");
    expect(robotsTxt).toContain("Disallow: /");
    expect(robotsTxt).not.toMatch(/sitemap/i);
  });
});

describe("meta robots pada layout dasar", () => {
  it("ada pada src/layouts/Base.astro", () => {
    expect(baseLayout).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it("ada pada keluaran build", () => {
    const chunks = Object.values(compiled);
    if (chunks.length === 0) {
      // dist/ belum ada; jalankan `npm run build` lalu ulangi pengujian.
      console.warn("dist/server belum ada; pemeriksaan keluaran build dilewati.");
      return;
    }
    const ada = chunks.some(
      (chunk) => chunk.includes('name="robots"') && chunk.includes("noindex, nofollow"),
    );
    expect(ada).toBe(true);
  });
});
