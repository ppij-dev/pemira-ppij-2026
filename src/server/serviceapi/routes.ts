import { Hono } from "hono";
import type { Bindings } from "../app";
import { describeSyncFailure } from "./errors";
import { assertSyncAllowed, enrichRollNames, syncPemilih } from "./sync";
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
    const failure = describeSyncFailure(error);
    return c.json(failure.body, failure.status as 401 | 403 | 409 | 429 | 502 | 504);
  }
});

// Perbarui nama resmi, nomor kartu dan kategori baris roll yang sudah ada;
// aman pada pemilihan yang sudah dibekukan karena tidak mengubah keanggotaan roll.
serviceApiRoutes.post("/admin/sync-names", async (c) => {
  try {
    const result = await enrichRollNames(c.env.DB, {
      issuer: c.env.ONELOGIN_ISSUER ?? "",
      clientId: c.env.SERVICE_API_CLIENT_ID ?? "",
      clientSecret: c.env.SERVICE_API_CLIENT_SECRET ?? "",
      serviceApiUrl: c.env.SERVICE_API_URL ?? "",
    }, new Date());
    return c.json(result);
  } catch (error) {
    const failure = describeSyncFailure(error);
    return c.json(failure.body, failure.status as 401 | 403 | 409 | 429 | 502 | 504);
  }
});
