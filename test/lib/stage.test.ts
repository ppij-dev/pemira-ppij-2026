import { describe, expect, it } from "vitest";
import { stage, type StageElection } from "../../src/server/lib/stage";

const OPENS = "2026-12-02T05:05:00Z";
const CLOSES = "2026-12-02T15:05:00Z";

function election(overrides: Partial<StageElection> = {}): StageElection {
  return {
    status_lock: "locked",
    opens_at: OPENS,
    closes_at: CLOSES,
    closed_early_at: null,
    ...overrides,
  };
}

describe("stage(election, now)", () => {
  it("draf tetap draft kecuali dipublikasikan", () => {
    expect(stage(election({ status_lock: "draft" }), "2020-01-01T00:00:00Z")).toBe("draft");
  });

  it("locked sebelum opens_at adalah scheduled", () => {
    expect(stage(election(), "2026-12-02T05:04:59Z")).toBe("scheduled");
  });

  it("tepat opens_at sampai sebelum closes_at adalah open", () => {
    expect(stage(election(), OPENS)).toBe("open");
    expect(stage(election(), "2026-12-02T10:00:00Z")).toBe("open");
  });

  it("tepat closes_at dan sesudahnya adalah closed", () => {
    expect(stage(election(), CLOSES)).toBe("closed");
    expect(stage(election(), "2026-12-02T15:05:01Z")).toBe("closed");
  });

  it("closed_early_at terisi berarti closed meski jam belum lewat", () => {
    expect(
      stage(election({ closed_early_at: "2026-12-02T09:00:00Z" }), "2026-12-02T09:00:01Z"),
    ).toBe("closed");
  });

  it("published selalu published", () => {
    const published = { status_lock: "published" as const };
    expect(stage(election(published), "2020-01-01T00:00:00Z")).toBe("published");
    expect(stage(election(published), "2030-01-01T00:00:00Z")).toBe("published");
  });

  it("menolak waktu yang tidak bisa diurai", () => {
    expect(() => stage(election({ opens_at: "besok" }), OPENS)).toThrow();
  });
});
