import { openSession, SESSION_COOKIE, type SessionData } from "../../server/auth/session";
import { affiliationInScope } from "../../server/admin/routes";

export type AdminBindings = { DB?: D1Database; APP_MASTER_KEY?: string };
export async function openAdminSession(cookie: string | undefined, bindings: AdminBindings): Promise<SessionData | null> {
  return cookie && bindings.APP_MASTER_KEY ? await openSession(cookie, bindings.APP_MASTER_KEY) : null;
}
export async function isAdminPageAuthorized(cookie: string | undefined, bindings: AdminBindings): Promise<boolean> {
  const session = await openAdminSession(cookie, bindings);
  if (!session || !bindings.DB) return false;
  const [admin, scope] = await Promise.all([
    bindings.DB.prepare("SELECT member_id FROM admin_voting WHERE member_id = ?").bind(session.member_id).first(),
    bindings.DB.prepare("SELECT value FROM system_config WHERE key = 'site_scope'").first<{ value: string }>(),
  ]);
  return !!admin && !!scope && affiliationInScope(session.affiliation, scope.value);
}
export { SESSION_COOKIE };
