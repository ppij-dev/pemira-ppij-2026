import { expect, test } from "@playwright/test";
import { sessionCookie } from "./support/local-fixture.mjs";

// Semua tombol aksi Admin Voting harus mengirim permintaannya dari ponsel
// maupun desktop, dan tidak boleh melempar galat yang membuat tombol diam.
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

function trackPosts(page: import("@playwright/test").Page) {
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") posts.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  return posts;
}

test("Panitia mengirim undangan lewat POST /api/admin/invitations", async ({ page }) => {
  const posts = trackPosts(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/admin/invitations", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ invitation_url: "http://localhost:4321/undangan/uji/abc" }) }));
  await page.goto("/admin");
  await page.locator("#member_id").fill("member-e2e");
  await activate(page, "#invite button[type=submit]");
  await expect(page.locator("#message")).toContainText("Undangan dibuat");
  expect(posts).toEqual(["POST /api/admin/invitations"]);
  expect(errors).toEqual([]);
});

test("Kandidat menyimpan lewat POST dan tombol Kosongkan membersihkan formulir", async ({ page }) => {
  const posts = trackPosts(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/election/candidates", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Nomor urut sudah dipakai kandidat lain." }) }));
  await page.goto("/admin/kandidat");
  await page.locator("#candidate-member").fill("member-e2e");
  await page.locator("#candidate-number").fill("1");
  await page.locator("#candidate-name").fill("Budi Santoso");
  await page.locator("#candidate-nickname").fill("Budi");
  await activate(page, "#candidate button[type=submit]");
  await expect(page.locator("#message")).toContainText("Nomor urut sudah dipakai");
  expect(posts).toEqual(["POST /api/election/candidates"]);
  await activate(page, "#candidate-reset");
  await expect(page.locator("#candidate-name")).toHaveValue("");
  expect(errors).toEqual([]);
});

test("Pemilihan mengunci lewat POST /api/election/lock", async ({ page }) => {
  const posts = trackPosts(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("**/api/election/lock", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Jadwal pemilihan belum lengkap." }) }));
  await page.goto("/admin/pemilihan");
  await activate(page, "#lock");
  await expect(page.locator("#message")).toContainText("Jadwal pemilihan belum lengkap");
  expect(posts).toEqual(["POST /api/election/lock"]);
  expect(errors).toEqual([]);
});
