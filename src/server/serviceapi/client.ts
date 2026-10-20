export type ServiceApiErrorCode = "no_grant" | "permission_missing" | "http_error" | "timeout" | "invalid_response";
export class ServiceApiError extends Error {
  constructor(public readonly code: ServiceApiErrorCode, message: string, public readonly status?: number) { super(message); this.name = "ServiceApiError"; }
}
export interface ServiceApiConfig { issuer: string; clientId: string; clientSecret: string; serviceApiUrl: string; }
export interface Member { member_id: string; full_name: string; nickname: string; komsat_path: string; status: string; member_number: string; updated_at: string; }
export interface Unit { path: string; name: string; parent_path: string; type: "national" | "korda" | "komsat"; }
const timeoutMs = 10_000;
export class ServiceApiClient {
  private token?: string;
  constructor(private readonly cfg: ServiceApiConfig) {}
  private async request(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...init, signal: controller.signal }); }
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
  async getUnits(): Promise<Unit[]> { return this.pages<Unit>("units"); }
  async getMembers(changedSince?: string): Promise<Member[]> { return this.pages<Member>("members", changedSince); }
  private async pages<T>(resource: string, changedSince?: string): Promise<T[]> {
    const token = await this.accessToken(); const rows: T[] = []; let cursor: string | null = null;
    do {
      const url = new URL(`/v1/service/${resource}`, this.cfg.serviceApiUrl);
      if (cursor) url.searchParams.set("cursor", cursor);
      if (changedSince) url.searchParams.set("changed_since", changedSince);
      const response = await this.request(url.toString(), { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) {
        let code: ServiceApiErrorCode = response.status >= 500 ? "http_error" : "permission_missing";
        try { const body = await response.json() as { error?: string }; if (body.error === "no_grant") code = "no_grant"; else if (body.error === "permission_missing") code = "permission_missing"; } catch { /* status determines error */ }
        throw new ServiceApiError(code, `Service API ${resource} returned ${response.status}`, response.status);
      }
      try { const page = await response.json() as { items: T[]; cursor: string | null }; if (!Array.isArray(page.items) || !(page.cursor === null || typeof page.cursor === "string")) throw new Error(); rows.push(...page.items); cursor = page.cursor; }
      catch { throw new ServiceApiError("invalid_response", `Invalid ${resource} page`); }
    } while (cursor !== null);
    return rows;
  }
}
