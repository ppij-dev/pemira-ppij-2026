import { Hono } from "hono";
import type { Bindings } from "../app";
import { assertSyncAllowed, syncPemilih } from "./sync";
type ServiceBindings = Bindings & { ONELOGIN_ISSUER?: string; SERVICE_API_CLIENT_ID?: string; SERVICE_API_CLIENT_SECRET?: string; SERVICE_API_URL?: string };

export const serviceApiRoutes = new Hono<{ Bindings: ServiceBindings }>();
serviceApiRoutes.post("/admin/sync", async (c) => {
  try {
    await assertSyncAllowed(c.env.DB);
    const result = await syncPemilih(c.env.DB, {
      issuer: c.env.ONELOGIN_ISSUER ?? "",
      clientId: c.env.SERVICE_API_CLIENT_ID ?? "",
      clientSecret: c.env.SERVICE_API_CLIENT_SECRET ?? "",
      serviceApiUrl: c.env.SERVICE_API_URL ?? "",
    }, new Date());
    return c.json(result);
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 502;
    return c.json({ error: error instanceof Error ? error.message : "Service API sync failed" }, status as 409 | 502);
  }
});
