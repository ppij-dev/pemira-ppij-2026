import { Hono } from "hono";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { setupRoutes } from "./setup/routes";
import { createAuthRoutes } from "./auth/routes";

export type Bindings = {
  /** D1: election data, audit log, encrypted secrets. */
  DB: D1Database;
  /** R2: candidate profiles and CKEditor uploads. */
  MEDIA: R2Bucket;
};

// The API sub-app, mounted at /api by src/fetch.ts.
const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

// /api/setup/*: penjaga pemasangan (tugas 2.1); langkah wizard menyusul.
app.route("/setup", setupRoutes);

// /api/auth/* dan /api/me: BFF One Login (tugas 3.1).
app.route("/", createAuthRoutes());

export { app };
