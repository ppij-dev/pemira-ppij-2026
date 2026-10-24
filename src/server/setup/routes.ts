import { Hono } from "hono";
import type { Bindings } from "../app";

// 1.0 intentionally has no setup routes; reserved URLs are rejected by the site guard.
export const setupRoutes = new Hono<{ Bindings: Bindings }>();
