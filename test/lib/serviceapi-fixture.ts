import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
export async function startServiceApiFixture(opts: { mode?: "ok" | "no_grant" | "fail_page_n"; delayMs?: number; failPage?: number } = {}): Promise<{ issuer: string; serviceUrl: string; close(): Promise<void> }> {
  let memberCalls = 0;
  const units = [
    { path: "/ppij", name: "PPIJ", parent_path: "", type: "national" },
    { path: "/ppij/okayama", name: "Okayama", parent_path: "/ppij", type: "korda" },
    { path: "/ppij/kyushu", name: "Kyushu", parent_path: "/ppij", type: "korda" },
    ...["okayama", "kyushu", "fukuoka", "kumamoto", "kagoshima"].map((name, index) => ({ path: `/ppij/${index < 1 ? "okayama" : "kyushu"}/${name}`, name, parent_path: `/ppij/${index < 1 ? "okayama" : "kyushu"}`, type: "komsat" as const })),
  ];
  const initial = Array.from({ length: 8 }, (_, index) => ({ member_id: `member-${index + 1}`, full_name: `Member ${index + 1}`, nickname: `M${index + 1}`, komsat_path: index < 4 ? "/ppij/okayama/okayama" : "/ppij/kyushu/fukuoka", status: "ACTIVE", member_number: String(index + 1), updated_at: `2026-01-01T00:00:0${index}Z` }));
  const changed = [
    ...[9, 10, 11].map((n) => ({ member_id: `member-${n}`, full_name: `Member ${n}`, nickname: `M${n}`, komsat_path: "/ppij/kyushu/fukuoka", status: "ACTIVE", member_number: String(n), updated_at: "2026-01-02T00:00:00Z" })),
    { ...initial[0]!, status: "INACTIVE", updated_at: "2026-01-02T00:00:00Z" },
  ];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.pathname.endsWith("/protocol/openid-connect/token") && req.method === "POST") return send(200, { access_token: "fixture-token", token_type: "Bearer" });
    if (url.pathname === "/v1/service/members" || url.pathname === "/v1/service/units") {
      const respond = () => {
        if (opts.mode === "no_grant") return send(403, { error: "no_grant" });
        if (req.headers.authorization !== "Bearer fixture-token") return send(401, { error: "unauthorized" });
        if (url.pathname.endsWith("/units")) return send(200, { items: units, cursor: null });
        const changedSince = url.searchParams.has("changed_since");
        if (changedSince) memberCalls++;
        const data = changedSince ? memberCalls > 1 ? changed : [] : initial;
        const cursor = url.searchParams.get("cursor"); const page = cursor ? Number(cursor) : 0;
        if (opts.mode === "fail_page_n" && page === (opts.failPage ?? 1)) return send(500, { error: "failed_page" });
        return send(200, { items: data.slice(page * 2, page * 2 + 2), cursor: (page + 1) * 2 < data.length ? String(page + 1) : null });
      };
      if (opts.delayMs) setTimeout(respond, opts.delayMs); else respond();
      return;
    }
    send(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo; const base = `http://127.0.0.1:${address.port}`;
  return { issuer: base, serviceUrl: base, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
