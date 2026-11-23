// Integration: app.route("/", resultsRoutes) after requireAdmin-guarded mounts; /dashboard guards internally and public /results must remain public.
// Parent mounts these routes before the wildcard admin middleware; /dashboard guards itself.
import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings } from "../app";
import type { SessionData } from "../auth/session";
import { requireAdmin } from "../admin/routes";
import { serviceApiConfig } from "../serviceapi/sync";
import { buildAuditInsert } from "../lib/audit";
import { getDashboard, getPublicResults, getTurnout, ResultsError } from "./queries";

type Env = { Bindings: Bindings & { APP_MASTER_KEY?: string; ONELOGIN_ISSUER?: string; SERVICE_API_CLIENT_ID?: string; SERVICE_API_CLIENT_SECRET?: string; SERVICE_API_URL?: string }; Variables: { authRuntime?: { masterKey: string }; adminAuth?: { session: SessionData; admin: { member_id: string; name: string; is_technical: number }; displayName: string } } };

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
    const data = await getDashboard(c.env.DB, now, serviceApiConfig(c.env));
    const actor = c.get("adminAuth")!;
    await c.env.DB.batch([await buildAuditInsert(c.env.DB, {
      at: now.toISOString(),
      actor_type: "admin",
      actor_member_id: actor.session.member_id,
      actor_name: actor.displayName,
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
// Pembacaan Hak pilih menyegarkan view portal lewat jalur yang sama dengan turnout.
resultsRoutes.get("/results", async (c) => {
  try {
    const data = await getPublicResults(c.env.DB, new Date(), serviceApiConfig(c.env));
    if (!data) return c.json({ error: "hasil_belum_diumumkan" }, 409);
    return c.json(data, 200);
  } catch (error) {
    return fail(c, error);
  }
});

// Batas per IP lega untuk satu lokasi di belakang satu IP (NAT gedung/venue):
// 600/menit ≈ 10 permintaan/detik ≈ 150 tab beranda yang men-polling 4x/menit,
// masih menahan penyalahgunaan. Ekspor konstanta untuk uji regeresi.
export const TURNOUT_LIMIT = 600;
const TURNOUT_WINDOW_SEC = 60;

/** Rate limit atomik via D1 UPSERT (pola papan bukti); kunci per IP. */
async function consumeTurnoutAttempt(db: Env["Bindings"]["DB"], ip: string): Promise<boolean> {
  const nowSec = Math.floor(Date.now() / 1000);
  const row = await db.prepare(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
     RETURNING count`,
  ).bind(`turnout:${ip}`, nowSec + TURNOUT_WINDOW_SEC, nowSec, nowSec, nowSec + TURNOUT_WINDOW_SEC).first<{ count: number }>();
  return (row?.count ?? TURNOUT_LIMIT + 1) <= TURNOUT_LIMIT;
}

// Dua angka publik untuk strip beranda (Jumlah Pemilih dan Suara Masuk): tanpa
// kandidat/pilihan/korda, dari Terjadwal sampai Diumumkan, ditolak saat Draf.
resultsRoutes.get("/turnout", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!await consumeTurnoutAttempt(c.env.DB, ip)) return c.json({ error: "rate_limited" }, 429);
  try {
    // no-store: angka live tidak boleh dilayani dari cache peramban/CDN.
    c.header("Cache-Control", "no-store");
    return c.json(await getTurnout(c.env.DB, new Date(), serviceApiConfig(c.env)), 200);
  } catch (error) {
    return fail(c, error);
  }
});
