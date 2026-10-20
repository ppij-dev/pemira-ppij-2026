import { describe, expect, it } from "vitest";
import { affiliationInScope } from "./routes";

describe("affiliationInScope", () => {
  it("accepts a string claim equal to the scope or a child unit", () => {
    expect(affiliationInScope("/ppij/okayama", "/ppij/okayama")).toBe(true);
    expect(affiliationInScope("/ppij/okayama/komsat-a", "/ppij/okayama")).toBe(true);
  });
  it("normalizes array claims and national scope", () => {
    expect(affiliationInScope(["/ppij/tokyo", "/ppij/okayama/komsat-a"], "/ppij/okayama")).toBe(true);
    expect(affiliationInScope(["/ppij/tokyo"], "/ppij/okayama")).toBe(false);
    expect(affiliationInScope(["/ppij/okayama"], "/ppij")).toBe(true);
  });
  it("does not accept path-prefix lookalikes or malformed claims", () => {
    expect(affiliationInScope("/ppij/okayama-other", "/ppij/okayama")).toBe(false);
    expect(affiliationInScope([null, 1] as unknown as string[], "/ppij")).toBe(false);
    expect(affiliationInScope(null, "/ppij")).toBe(false);
  });
});
