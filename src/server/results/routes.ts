// Integration: app.route("/", resultsRoutes) after requireAdmin-guarded mounts; /dashboard guards internally and public /results must remain public.
// Parent mounts these routes before the wildcard admin middleware; /dashboard guards itself.
import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings } from "../app";
import type { SessionData } from "../auth/session";
import { requireAdmin } from "../admin/routes";
import { buildAuditInsert } from "../lib/audit";
import { getDashboard, getPublicResults, ResultsError } from "./queries";

type Env = { Bindings: Bindings & { APP_MASTER_KEY?: string }; Variables: { authRuntime?: { masterKey: string }; adminAuth?: { session: SessionData; admin: { member_id: string; name: string; is_technical: number } } } };

function fail(c: Context<Env>, error: unknown) {
  if (error instanceof ResultsError) return c.json({ error: error.message }, error.status);
  throw error;
}

export const resultsRoutes = new Hono<Env>();

// Admin tally: every load is audit-logged with the actual session actor; no vote
// choices or voter identities are written to the log.
resultsRoutes.get("/dashboard", requireAdmin, async (c) => {
  const now = new Date();
  try {
    const data = await getDashboard(c.env.DB, now);
    const actor = c.get("adminAuth")!;
    await c.env.DB.batch([await buildAuditInsert(c.env.DB, {
      at: now.toISOString(),
      actor_type: "admin",
      actor_member_id: actor.session.member_id,
      actor_name: actor.session.name,
      action: "admin_tally_viewed",
      target: null,
      komsat_path: null,
      detail_json: JSON.stringify({ stage: data.stage }),
    })]);
    return c.json(data, 200);
  } catch (error) {
    return fail(c, error);
  }
});

// Public aggregates only once Diumumkan; before publication there are no counts at all.
resultsRoutes.get("/results", async (c) => {
  try {
    const data = await getPublicResults(c.env.DB, new Date());
    if (!data) return c.json({ error: "hasil_belum_diumumkan" }, 409);
    return c.json(data, 200);
  } catch (error) {
    return fail(c, error);
  }
});
