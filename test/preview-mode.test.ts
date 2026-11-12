/**
 * Mode Pratinjau (fork): pemilihan dengan preview_mode=1 dapat dikunci tanpa
 * sinkronisasi Service API, dan pemilih aktif dalam cakupan terdaftar
 * otomatis dari klaim sesi saat pertama kali memeriksa kelayakan.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import base from "../migrations/0001_init.sql?raw";
import units from "../migrations/0002_units.sql?raw";
import lock from "../migrations/0003_election_lock.sql?raw";
import snapshot from "../migrations/0005_closing_snapshot.sql?raw";
import preview from "../migrations/0006_preview_mode.sql?raw";
import categorySql from "../migrations/0009_voter_category.sql?raw";
import canVoteSql from "../migrations/0010_voter_can_vote.sql?raw";
import { authorizeVoter } from "../src/server/voting/vote";
import { lockElection, setSchedule } from "../src/server/election/lifecycle";
import type { ServiceApiConfig } from "../src/server/serviceapi/client";

declare module "*.sql?raw" { const sql: string; export default sql; }

const NOW = new Date("2026-10-20T00:00:00Z");
// Jadwal relatif terhadap jam nyata: kelayakan dinilai dengan klok sekarang,
// bukan waktu uji tetap, agar berkas ini tidak kedaluwarsa sendiri.
const OPENS_AT = new Date(Date.now() - 3_600_000).toISOString();
const CLOSES_AT = new Date(Date.now() + 30 * 24 * 3_600_000).toISOString();
const cfg: ServiceApiConfig = { issuer: "https://fixture.invalid", clientId: "client", clientSecret: "secret", serviceApiUrl: "https://fixture.invalid" };
const mustNotFetch = async () => { throw new Error("Mode pratinjau tidak boleh memanggil Service API"); };

async function setup() {
  await reset();
  await env.DB.batch([base, units, lock, snapshot, preview, categorySql, canVoteSql].flatMap((sql) => sql.split(";").map((s) => s.trim()).filter(Boolean).map((s) => env.DB.prepare(s))));
  await env.DB.prepare("INSERT INTO elections(id, preview_mode) VALUES(1, 1)").run();
  await env.DB.prepare("INSERT INTO system_config(key, value) VALUES('site_scope', '/ppij')").run();
  for (let i = 1; i <= 2; i++) {
    await env.DB.prepare("INSERT INTO candidates(member_id, number, name, nickname, komsat_path) VALUES(?, ?, ?, ?, '/ppij')")
      .bind(`cand-${i}`, i, `Kandidat ${i}`, `C${i}`)
      .run();
  }
  await setSchedule(env.DB, NOW, { title: "Preview", description: "", opens_at: OPENS_AT, closes_at: CLOSES_AT, preview_mode: true });
  await lockElection(env.DB, cfg, NOW, mustNotFetch);
}

describe("preview mode", () => {
  beforeEach(() => setup());

  it("locks without Service API sync even when opens_at is in the past", async () => {
    const row = await env.DB.prepare("SELECT status_lock, preview_mode, frozen_at, frozen_hak_pilih FROM elections").first<{ status_lock: string; preview_mode: number; frozen_at: string | null }>();
    expect(row).toMatchObject({ status_lock: "locked", preview_mode: 1 });
    expect(row?.frozen_at).not.toBeNull();
  });

  it("auto-registers an ACTIVE in-scope member from session claims", async () => {
    const session = { member_id: "member-new", name: "New Member", affiliation: "/ppij/okayama", auth_time: Math.floor(Date.now() / 1000) };
    const { voter, election } = await authorizeVoter(env.DB, session);
    expect(election.preview_mode).toBe(1);
    expect(voter.status).toBe("ACTIVE");
    expect(voter.komsat_path).toBe("/ppij/okayama");
    const stored = await env.DB.prepare("SELECT name, nickname, category, can_vote FROM voters WHERE member_id = 'member-new'").first<{ name: string; nickname: string; category: string; can_vote: number }>();
    expect(stored).toMatchObject({ name: "New Member", nickname: "New Member", category: "BIASA", can_vote: 1 });
  });

  it("prefers the in-scope affiliation path from a multi-unit member", async () => {
    const session = { member_id: "member-multi", name: "Multi Unit", affiliation: ["/other/unit", "/ppij/kansai"], auth_time: Math.floor(Date.now() / 1000) };
    const { voter } = await authorizeVoter(env.DB, session);
    expect(voter.komsat_path).toBe("/ppij/kansai");
  });

  it("still rejects unregistered members when preview is off, without re-login requirement", async () => {
    await env.DB.prepare("UPDATE elections SET preview_mode = 0").run();
    const session = { member_id: "member-other", name: "Other", affiliation: "/ppij", auth_time: Math.floor(Date.now() / 1000) - 7200 };
    await expect(authorizeVoter(env.DB, session)).rejects.toThrow("tidak terdaftar");
  });

  it("heals a legacy preview row that has no portal decision yet", async () => {
    // Baris pratinjau dari versi sebelum can_vote ada: boleh memilih setelah
    // anggotanya masuk lagi, tanpa Service API.
    await env.DB.prepare("INSERT INTO voters (member_id, name, nickname, komsat_path, status, synced_at, category, can_vote) VALUES ('member-legacy','Legacy','Legacy','/ppij','ACTIVE','2026-01-01T00:00:00Z',NULL,NULL)").run();
    const session = { member_id: "member-legacy", name: "Legacy Name", affiliation: "/ppij", auth_time: Math.floor(Date.now() / 1000) };
    const { voter } = await authorizeVoter(env.DB, session);
    expect(voter.can_vote).toBe(1);
    const stored = await env.DB.prepare("SELECT name, category, can_vote FROM voters WHERE member_id = 'member-legacy'").first<{ name: string; category: string; can_vote: number }>();
    expect(stored).toEqual({ name: "Legacy", category: "BIASA", can_vote: 1 });
  });

  it("keeps auto-registration idempotent across repeated checks", async () => {
    const session = { member_id: "member-again", name: "Again", affiliation: "/ppij", auth_time: Math.floor(Date.now() / 1000) };
    await authorizeVoter(env.DB, session);
    await authorizeVoter(env.DB, session);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM voters WHERE member_id = 'member-again'").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("accepts an old session in preview mode but rejects future auth_time", async () => {
    const old = { member_id: "member-old", name: "Old Session", affiliation: "/ppij", auth_time: Math.floor(Date.now() / 1000) - 3600 };
    const { voter } = await authorizeVoter(env.DB, old);
    expect(voter.status).toBe("ACTIVE");
    const future = { member_id: "member-future", name: "Future", affiliation: "/ppij", auth_time: Math.floor(Date.now() / 1000) + 120 };
    await expect(authorizeVoter(env.DB, future)).rejects.toThrow("tidak valid");
  });
});
