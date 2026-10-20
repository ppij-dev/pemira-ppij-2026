import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside Miniflare (workerd) with the same bindings as production.
// Keep in sync with wrangler.jsonc.
export default defineConfig({
  test: {
    exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"],
  },
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-09-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: { DB: "local" },
      },
    }),
  ],
});
