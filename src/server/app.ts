import { Hono } from "hono";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

export type Bindings = {
  /** D1: election data, audit log, encrypted secrets. */
  DB: D1Database;
  /** R2: candidate profiles and CKEditor uploads. */
  MEDIA: R2Bucket;
};

// The API sub-app, mounted at /api by src/fetch.ts.
const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

export { app };
