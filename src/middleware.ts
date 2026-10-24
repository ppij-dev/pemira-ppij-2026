/**
 * Middleware permintaan: pengunjung tanpa sesi yang membuka halaman admin
 * dialihkan ke One Login dan kembali ke halaman yang dituju. Panggilan API
 * (Accept bukan text/html) tetap mendapat JSON dari guard rutenya masing-
 * masing. Sesi yang masuk tetapi bukan Admin Voting ditangani halaman (403).
 */
import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { SESSION_COOKIE, openAdminSession, type AdminBindings } from "./pages/admin/admin-auth";

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const acceptsHtml = (context.request.headers.get("accept") ?? "").includes("text/html");
    if (acceptsHtml) {
      const cookie = context.cookies.get(SESSION_COOKIE)?.value;
      const bindings = env as unknown as AdminBindings;
      const session = await openAdminSession(cookie, bindings);
      if (!session) {
        return context.redirect(`/api/auth/login?return_to=${encodeURIComponent(pathname + search)}`);
      }
    }
  }
  return next();
});
