export type ServiceApiErrorCode = "no_grant" | "permission_missing" | "unauthorized" | "not_found" | "rate_limited" | "http_error" | "timeout" | "invalid_response";
export class ServiceApiError extends Error {
  constructor(public readonly code: ServiceApiErrorCode, message: string, public readonly status?: number) { super(message); this.name = "ServiceApiError"; }
}
export interface ServiceApiConfig { issuer: string; clientId: string; clientSecret: string; serviceApiUrl: string; fetchImpl?: typeof fetch; }
export type MemberStatus = "ACTIVE" | "EXPIRED" | "SUSPENDED" | "REVOKED" | "INCOMPLETE" | "ALL";
/** Kategori AD/ART dari portal; null berarti belum ditentukan (bukan Luar Biasa). */
export type MemberCategory = "BIASA" | "LUAR_BIASA" | "UNKNOWN" | null;
export interface Member {
  member_id: string;
  full_name: string;
  nickname: string | null;
  komsat_path: string;
  korda_path?: string | null;
  status: string;
  member_number: string | null;
  valid_until?: string | null;
  account_activated?: boolean;
  member_category?: MemberCategory;
  member_subtype?: string | null;
  can_vote?: boolean | null;
  updated_at: string;
}
export interface Unit { path: string; name: string; parent_path: string; type: "national" | "korda" | "komsat"; }
/** Halaman daftar Service API beserta `as_of` server untuk changed_since berikutnya. */
export interface ListPage<T> { items: T[]; asOf: string; }
export interface MemberQuery { changedSince?: string; status?: MemberStatus; }
const timeoutMs = 10_000;
const errorCodes: Record<string, ServiceApiErrorCode> = {
  no_grant: "no_grant",
  permission_missing: "permission_missing",
  unauthorized: "unauthorized",
  not_found: "not_found",
  rate_limited: "rate_limited",
};
/** Kode error dari body `{"error": "..."}`; bila tidak dikenal, dari status HTTP. */
async function errorCode(response: Response): Promise<ServiceApiErrorCode> {
  let named: ServiceApiErrorCode | null = null;
  try {
    const body = await response.json() as { error?: string };
    named = typeof body.error === "string" ? errorCodes[body.error] ?? null : null;
  } catch { /* status menentukan kode */ }
  if (named) return named;
  if (response.status === 401) return "unauthorized";
  if (response.status === 403) return "permission_missing";
  if (response.status === 404) return "not_found";
  if (response.status === 429) return "rate_limited";
  return "http_error";
}
export class ServiceApiClient {
  private token?: string;
  constructor(private readonly cfg: ServiceApiConfig) {}
  private async request(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await (this.cfg.fetchImpl ?? fetch)(url, { ...init, signal: controller.signal }); }
    catch (error) { if (controller.signal.aborted) throw new ServiceApiError("timeout", "Service API request timed out"); throw new ServiceApiError("http_error", String(error)); }
    finally { clearTimeout(timer); }
  }
  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const form = new URLSearchParams({ grant_type: "client_credentials", client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret });
    const response = await this.request(`${this.cfg.issuer.replace(/\/$/, "")}/protocol/openid-connect/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
    if (!response.ok) throw new ServiceApiError("http_error", `Token endpoint returned ${response.status}`, response.status);
    try { const data = await response.json() as { access_token?: string }; if (!data.access_token) throw new Error("missing access_token"); this.token = data.access_token; return this.token; }
    catch { throw new ServiceApiError("invalid_response", "Invalid token response"); }
  }
  async getUnits(): Promise<Unit[]> { return (await this.list<Unit>("units")).items; }
  async getMembers(query: MemberQuery = {}): Promise<ListPage<Member>> { return this.list<Member>("members", query); }
  private async list<T>(resource: string, query: MemberQuery = {}): Promise<ListPage<T>> {
    const token = await this.accessToken(); const rows: T[] = []; let cursor: string | null = null; let asOf: string | null = null;
    do {
      const url = new URL(`/v1/service/${resource}`, this.cfg.serviceApiUrl);
      if (cursor) url.searchParams.set("cursor", cursor);
      if (query.changedSince) url.searchParams.set("changed_since", query.changedSince);
      if (query.status) url.searchParams.set("status", query.status);
      const response = await this.request(url.toString(), { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const code = await errorCode(response);
        throw new ServiceApiError(code, `Service API ${resource} returned ${response.status}`, response.status);
      }
      try {
        const page = await response.json() as { items: T[]; cursor: string | null; as_of?: string };
        if (!Array.isArray(page.items) || !(page.cursor === null || typeof page.cursor === "string")) throw new Error();
        rows.push(...page.items);
        // as_of halaman pertama adalah penanda waktu server untuk changed_since
        // berikutnya; klok lokal tidak pernah dipakai (kontrak Service API §4.3).
        if (asOf === null && typeof page.as_of === "string" && page.as_of) asOf = page.as_of;
        cursor = page.cursor;
      }
      catch { throw new ServiceApiError("invalid_response", `Invalid ${resource} page`); }
    } while (cursor !== null);
    return { items: rows, asOf: asOf ?? new Date().toISOString() };
  }
}
