import { describe, expect, it } from "vitest";
import { app } from "./app";

describe("GET /api/health", () => {
  it("menjawab 200 dengan { ok: true }", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
