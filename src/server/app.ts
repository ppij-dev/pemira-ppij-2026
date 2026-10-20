import { Hono } from "hono";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { setupRoutes } from "./setup/routes";
import { createAuthRoutes } from "./auth/routes";
import { electionRoutes } from "./election/routes";
import { serviceApiRoutes } from "./serviceapi/routes";
import { resultsRoutes } from "./results/routes";
import { voteRoutes } from "./voting/routes";
import { boardRoutes } from "./voting/board";
import { auditRoutes } from "./audit/routes";
import { requireAdmin } from "./admin/routes";
import { loadRuntimeConfig } from "./setup/bootstrap";
export type Bindings = {
  /** D1: election data, audit log, encrypted secrets. */
  DB: D1Database;
  /** R2: candidate profiles and CKEditor uploads. */
  /** Secret used to authenticate session cookies. */
  APP_MASTER_KEY: string;
  MEDIA: R2Bucket;
};

// The API sub-app, mounted at /api by src/fetch.ts.
const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.route("/setup", setupRoutes);

// /api/results harus publik: pasang SEBELUM createAuthRoutes (wildcard
// requireAdmin panitia di dalamnya akan menutup rute ini bila dilewati).
// /api/dashboard tetap terlindungi oleh requireAdmin internal resultsRoutes.
// Sama untuk /votes*: sesi divalidasi internal, bukan oleh guard panitia.
app.route("/", resultsRoutes);
app.route("/", voteRoutes);
app.route("/", boardRoutes);

app.route("/", createAuthRoutes({
  loadRuntime: (c) => {
    const config = loadRuntimeConfig(c.env);
    return config ? {
      masterKey: config.APP_MASTER_KEY,
      config: {
        issuer: config.ONELOGIN_ISSUER,
        clientId: config.ONELOGIN_CLIENT_ID,
        clientSecret: config.ONELOGIN_CLIENT_SECRET,
        redirectUri: new URL("/api/auth/callback", config.SITE_BASE_URL).href,
      },
    } : null;
  },
}));

// Rute admin terintegrasi (parent): election + sync dijalankan di bawah guard
// requireAdmin yang sama dengan rute panitia (adminAuth disetel untuk test-vote).
app.use("/election/*", requireAdmin);
app.use("/admin/sync", requireAdmin);
app.route("/", electionRoutes);
app.route("/", serviceApiRoutes);

// Audit khusus Admin Voting (guard internal per rute).
app.route("/", auditRoutes);

export { app };
