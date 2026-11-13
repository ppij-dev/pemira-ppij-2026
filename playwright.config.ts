import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:4321",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Halaman admin dipakai panitia dari ponsel: uji juga pada layar 390px.
    { name: "mobile-chrome", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    // Fixture D1 lokal ikut dijalankan supaya spec punya Admin Voting dan sesi
    // yang cocok dengan APP_MASTER_KEY di .dev.vars. Runtime-nya `wrangler dev`
    // (Worker sungguhan, latar depan) karena `astro preview` melepaskan diri ke
    // proses latar dan langsung keluar sehingga Playwright menganggapnya gagal.
    command: "node e2e/support/local-fixture.mjs && npm run build && npx wrangler dev --port 4321",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
