import { expect, test } from "@playwright/test";
import { sessionCookie } from "./support/local-fixture.mjs";

// Admin Voting bekerja dari ponsel: setiap tombol aksi harus mengirim
// permintaannya dan hasilnya harus terlihat tepat di bawah judul halaman.
test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "ppij_session", value: sessionCookie(), domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
});

async function activate(page: import("@playwright/test").Page, selector: string) {
  const target = page.locator(selector);
  if ((page.viewportSize()?.width ?? 1280) < 700) await target.tap();
  else await target.click();
}

test("tombol Sinkronkan mengirim POST /api/admin/sync lalu menampilkan hasil", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") posts.push(new URL(request.url()).pathname); });
  await page.route("**/api/admin/sync", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ added: 3, removed: 1, excluded: 2 }) });
  });
  await page.goto("/admin/pemilih");
  const status = page.locator("#sync-status");
  const statusText = page.locator("#sync-status-text");
  await expect(status).toBeHidden();
  await activate(page, "#sync");
  await expect(page.locator("#sync")).toBeDisabled();
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("role", "status");
  await expect(statusText).toContainText("Menyinkronkan data pemilih dari portal");
  await expect(statusText).toContainText("3 pemilih baru", { timeout: 15_000 });
  await expect(statusText).toContainText("2 anggota tanpa hak pilih tidak dimasukkan");
  await expect(page.locator("#sync")).toBeEnabled();
  expect(posts).toEqual(["/api/admin/sync"]);
  const box = await status.boundingBox();
  expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(page.viewportSize()?.height ?? 0);
});

test("tombol Perbarui Nama mengirim POST /api/admin/sync-names", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") posts.push(new URL(request.url()).pathname); });
  await page.route("**/api/admin/sync-names", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ updated: 2 }) }));
  await page.goto("/admin/pemilih");
  await activate(page, "#sync-names");
  await expect(page.locator("#sync-status-text")).toContainText("diperbarui untuk 2 pemilih");
  expect(posts).toEqual(["/api/admin/sync-names"]);
});

test("galat server tampil dalam Bahasa Indonesia dan dibaca pembaca layar", async ({ page }) => {
  await page.route("**/api/admin/sync", (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({ error: "Klien Service API tidak punya izin membaca data anggota (403). Minta Admin Portal menambah izin baca." }),
  }));
  await page.goto("/admin/pemilih");
  const status = page.locator("#sync-status");
  const statusText = page.locator("#sync-status-text");
  await activate(page, "#sync");
  await expect(status).toHaveAttribute("role", "alert");
  await expect(statusText).toContainText("(403)");
  await expect(statusText).toContainText("Admin Portal");
  // Balasan tanpa JSON (misalnya halaman galat Cloudflare) tetap berbahasa Indonesia.
  await page.unroute("**/api/admin/sync");
  await page.route("**/api/admin/sync", (route) => route.fulfill({ status: 502, contentType: "text/html", body: "<html><body>Bad gateway</body></html>" }));
  await activate(page, "#sync");
  await expect(statusText).toContainText("Portal belum bisa dihubungi (502)");
});
