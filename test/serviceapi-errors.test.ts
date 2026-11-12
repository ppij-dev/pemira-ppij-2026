import { describe, expect, it } from "vitest";
import { ServiceApiError } from "../src/server/serviceapi/client";
import { describeSyncFailure } from "../src/server/serviceapi/errors";

// Pesan galat sinkronisasi tampil langsung di halaman Pemilih, jadi bahasanya
// harus Indonesia dan setiap status menunjuk satu langkah perbaikan.
describe("sync failure messages", () => {
  it("explains a rejected Service API token as 401 in Bahasa Indonesia", () => {
    const failure = describeSyncFailure(new ServiceApiError("http_error", "Token endpoint returned 401", 401));
    expect(failure.status).toBe(401);
    expect(failure.body.error).toContain("Portal menolak permintaan");
    expect(failure.body.error).toContain("401");
    expect(failure.body.detail).toBe("Token endpoint returned 401");
  });
  it("maps a missing grant and missing permission to 403 with an action to take", () => {
    for (const code of ["no_grant", "permission_missing"] as const) {
      const failure = describeSyncFailure(new ServiceApiError(code, "Service API members returned 403", 403));
      expect(failure.status).toBe(403);
      expect(failure.body.error).toContain("Admin Portal");
    }
  });
  it("maps a portal timeout to 504 and a rate limit to 429", () => {
    expect(describeSyncFailure(new ServiceApiError("timeout", "Service API request timed out")).status).toBe(504);
    expect(describeSyncFailure(new ServiceApiError("timeout", "Service API request timed out")).body.error).toContain("10 detik");
    expect(describeSyncFailure(new ServiceApiError("rate_limited", "Service API members returned 429", 429)).status).toBe(429);
  });
  it("keeps the locked-election 409 message and falls back to 502 for unknown errors", () => {
    const locked = Object.assign(new Error("Sync hanya diizinkan saat pemilihan berstatus draft"), { status: 409 });
    expect(describeSyncFailure(locked)).toEqual({ status: 409, body: { error: "Sync hanya diizinkan saat pemilihan berstatus draft" } });
    const unknown = describeSyncFailure(new Error("boom"));
    expect(unknown.status).toBe(502);
    expect(unknown.body.error).toContain("kesalahan server");
    expect(unknown.body.detail).toBe("boom");
  });
});
