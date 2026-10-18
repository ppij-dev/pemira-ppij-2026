import { expect, test } from "@playwright/test";

test("halaman utama dimuat", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/PPIJ/);
});
