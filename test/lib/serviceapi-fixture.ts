import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// The HTTP fixture is for out-of-workerd rehearsals; focused workerd tests use createServiceApiStub.
type FixtureOptions = { mode?: "ok" | "no_grant" | "fail_page_n"; delayMs?: number; failPage?: number };
/** as_of halaman pertama: klien menyimpannya sebagai changed_since berikutnya. */
const AS_OF = "2026-01-01T00:00:00.000Z";
function createHandler(opts: FixtureOptions) {
  const units = [
    { path: "/ppij", name: "PPIJ", parent_path: "", type: "national" },
    { path: "/ppij/okayama", name: "Okayama", parent_path: "/ppij", type: "korda" },
    { path: "/ppij/kyushu", name: "Kyushu", parent_path: "/ppij", type: "korda" },
    ...["okayama", "kyushu", "fukuoka", "kumamoto", "kagoshima"].map((name, index) => ({ path: `/ppij/${index < 1 ? "okayama" : "kyushu"}/${name}`, name, parent_path: `/ppij/${index < 1 ? "okayama" : "kyushu"}`, type: "komsat" as const })),
  ];
  const initial = Array.from({ length: 8 }, (_, index) => ({ member_id: `member-${index + 1}`, full_name: `Member ${index + 1}`, nickname: `M${index + 1}`, komsat_path: index < 4 ? "/ppij/okayama/okayama" : "/ppij/kyushu/fukuoka", status: "ACTIVE", member_number: String(index + 1), member_category: "BIASA", can_vote: true, updated_at: `2026-01-01T00:00:0${index}Z` }));
  const joined = [9, 10, 11].map((n) => ({ member_id: `member-${n}`, full_name: `Member ${n}`, nickname: `M${n}`, komsat_path: "/ppij/kyushu/fukuoka", status: "ACTIVE", member_number: String(n), member_category: "BIASA", can_vote: true, updated_at: "2026-01-02T00:00:00Z" }));
  // Luar Biasa: portal menyatakan can_vote false.
  const extraordinary = { member_id: "member-12", full_name: "Member 12", nickname: "M12", komsat_path: "/ppij/kyushu/fukuoka", status: "ACTIVE", member_number: "12", member_category: "LUAR_BIASA", can_vote: false, updated_at: "2026-01-02T00:00:00Z" };
  // Kategori belum ditentukan: portal mengirim can_vote null.
  const undetermined = { member_id: "member-13", full_name: "Member 13", nickname: "M13", komsat_path: "/ppij/kyushu/fukuoka", status: "ACTIVE", member_number: "13", member_category: null, can_vote: null, updated_at: "2026-01-02T00:00:00Z" };
  const memberOneExpired = { ...initial[0]!, status: "EXPIRED", can_vote: false, updated_at: "2026-01-02T00:00:00Z" };
  // Deltanya sync bertahap; snapshot penuh (status=ALL) mencerminkan keadaan server sekarang.
  const changed = [...joined, extraordinary, undetermined, memberOneExpired];
  const all = [...initial.filter((member) => member.member_id !== "member-1"), memberOneExpired, ...joined, extraordinary, undetermined];
  const envelope = (items: unknown[], url: URL) => {
    const page = url.searchParams.get("cursor") ? Number(url.searchParams.get("cursor")) : 0;
    return { items: items.slice(page * 2, page * 2 + 2), cursor: (page + 1) * 2 < items.length ? String(page + 1) : null, as_of: AS_OF };
  };
  return (url: URL, init: RequestInit = {}): Response => {
    if (url.pathname.endsWith("/protocol/openid-connect/token") && init.method === "POST") return Response.json({ access_token: "fixture-token", token_type: "Bearer" });
    if (url.pathname !== "/v1/service/members" && url.pathname !== "/v1/service/units") return Response.json({ error: "not_found" }, { status: 404 });
    if (opts.mode === "no_grant") return Response.json({ error: "no_grant" }, { status: 403 });
    if (new Headers(init.headers).get("authorization") !== "Bearer fixture-token") return Response.json({ error: "unauthorized" }, { status: 401 });
    if (url.pathname.endsWith("/units")) return Response.json(envelope(units, url));
    const changedSince = url.searchParams.has("changed_since");
    const full = url.searchParams.get("status") === "ALL";
    const data = changedSince ? changed : full ? all : initial;
    if (url.searchParams.has("member_id") && !data.some((member) => member.member_id === url.searchParams.get("member_id"))) return Response.json({ error: "not_found" }, { status: 404 });
    const page = url.searchParams.get("cursor") ? Number(url.searchParams.get("cursor")) : 0;
    if (opts.mode === "fail_page_n" && page === (opts.failPage ?? 1)) return Response.json({ error: "failed_page" }, { status: 500 });
    return Response.json(envelope(data, url));
  };
}

export function createServiceApiStub(opts: FixtureOptions = {}): { fetchImpl: typeof fetch; issuer: string; serviceUrl: string; token: string; asOf: string } {
  const handler = createHandler(opts);
  const fetchImpl: typeof fetch = async (input, init) => handler(new URL(typeof input === "string" || input instanceof URL ? input : input.url), init);
  return { fetchImpl, issuer: "https://fixture.invalid", serviceUrl: "https://fixture.invalid", token: "fixture-token", asOf: AS_OF };
}

export async function startServiceApiFixture(opts: FixtureOptions = {}): Promise<{ issuer: string; serviceUrl: string; close(): Promise<void> }> {
  const handler = createHandler(opts);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const respond = () => {
      req.resume();
      req.on("end", () => {
        const response = handler(url, { method: req.method, headers: req.headers });
        void response.text().then((body) => { res.writeHead(response.status, { "content-type": "application/json" }); res.end(body); });
      });
    };
    if (opts.delayMs) setTimeout(respond, opts.delayMs); else respond();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo; const base = `http://127.0.0.1:${address.port}`;
  return { issuer: base, serviceUrl: base, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
