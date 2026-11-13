import { expect, test } from "@playwright/test";

test("halaman utama dimuat", async ({ page }) => {
  await page.goto("/");
  // Judul memakai nama situs hasil bootstrap fixture e2e (lihat
  // e2e/support/local-fixture.mjs), jadi tidak lagi memakai judul bawaan.
  await expect(page).toHaveTitle(/Pemilihan/);
});
