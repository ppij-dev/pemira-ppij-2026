import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import initSql from "../../migrations/0001_init.sql?raw";
import {
  NEUTRAL_ACCOUNT_NAME,
  NEUTRAL_ADMIN_NAME,
  initialsFor,
  looksLikeMemberId,
  pickDisplayName,
  resolveDisplayName,
  usableName,
} from "../../src/server/lib/displayName";

declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}

const UUID = "2b6b8200-6b6b-4e04-960d-1023682c5d56";

beforeEach(async () => {
  await reset();
  await env.DB.batch(initSql.split(";").map((s) => s.trim()).filter(Boolean).map((s) => env.DB.prepare(s)));
});

async function seedRoll(memberId: string, name: string) {
  await env.DB.prepare("INSERT INTO voters (member_id, name, komsat_path, status, synced_at) VALUES (?, ?, ?, 'ACTIVE', ?)")
    .bind(memberId, name, "/ppij/okayama", new Date().toISOString())
    .run();
}

describe("displayName", () => {
  it("falls back to the roll name when the session name is the member UUID", async () => {
    await seedRoll(UUID, "I NYOMAN DARMA KOTAMA");
    const name = await resolveDisplayName(env.DB, UUID, UUID, NEUTRAL_ADMIN_NAME);
    expect(name).toBe("I NYOMAN DARMA KOTAMA");
    expect(initialsFor(name)).toBe("I");
  });

  it("gives the neutral label when there is no roll row and the session name is the UUID", async () => {
    expect(await resolveDisplayName(env.DB, UUID, UUID, NEUTRAL_ADMIN_NAME)).toBe("Admin Voting");
    expect(await resolveDisplayName(env.DB, UUID, UUID, NEUTRAL_ACCOUNT_NAME)).toBe("Akun");
  });

  it("prefers the roll name over a real session name", async () => {
    await seedRoll(UUID, "I NYOMAN DARMA KOTAMA");
    expect(await resolveDisplayName(env.DB, UUID, "Nyoman", NEUTRAL_ACCOUNT_NAME)).toBe("I NYOMAN DARMA KOTAMA");
  });

  it("uses a real session name when the roll is empty or missing", async () => {
    await seedRoll(UUID, "");
    expect(await resolveDisplayName(env.DB, UUID, "Nyoman", NEUTRAL_ACCOUNT_NAME)).toBe("Nyoman");
    expect(await resolveDisplayName(env.DB, "member-without-roll", "Nyoman", NEUTRAL_ACCOUNT_NAME)).toBe("Nyoman");
  });

  it("rejects the member id and UUID shapes as names", () => {
    expect(looksLikeMemberId(UUID)).toBe(true);
    expect(looksLikeMemberId("  ")).toBe(true);
    expect(looksLikeMemberId("Nyoman")).toBe(false);
    expect(usableName(UUID, "other-member")).toBeNull();
    expect(usableName("member-1", "member-1")).toBeNull();
    expect(usableName("Budiono", "member-1")).toBe("Budiono");
    expect(pickDisplayName([null, UUID, ""], UUID, NEUTRAL_ACCOUNT_NAME)).toBe("Akun");
    expect(initialsFor(UUID)).toBe("?");
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("okta")).toBe("O");
  });
});