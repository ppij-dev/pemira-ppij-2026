import { Hono } from "hono";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { setupRoutes } from "./setup/routes";
import { createAuthRoutes } from "./auth/routes";
import { electionRoutes } from "./election/routes";
import { serviceApiRoutes } from "./serviceapi/routes";
import { requireAdmin } from "./admin/routes";
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
app.route("/", createAuthRoutes());

// Rute admin terintegrasi (parent): election + sync dijalankan di bawah guard
// requireAdmin yang sama dengan rute panitia (adminAuth disetel untuk test-vote).
app.use("/election/*", requireAdmin);
app.use("/admin/sync", requireAdmin);
app.route("/", electionRoutes);
app.route("/", serviceApiRoutes);

export { app };
