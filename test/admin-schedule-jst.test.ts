import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import base from "../migrations/0001_init.sql?raw";
import preview from "../migrations/0006_preview_mode.sql?raw";
import pemilihan from "../src/pages/admin/pemilihan.astro?raw";
import { fromJstInputValue, toJstInputValue } from "../src/lib/scheduleInput";
import { extendClosing, setSchedule } from "../src/server/election/lifecycle";
declare module "*.sql?raw" { const sql: string; export default sql; }

// Pengaturan menampilkan jadwal sebagai waktu dinding JST dan formulir mengirim
// nilai yang sama dengan offset +09:00. Sebelumnya input diisi potongan UTC dari
// instan tersimpan, sehingga setiap "Simpan Jadwal" menggeser jadwal -9 jam.
const NOW = new Date("2026-11-18T18:00:00Z");

async function setup() {
  await reset();
  await env.DB.batch([base, preview].flatMap((sql) => sql.split(";").map((s) => s.trim()).filter(Boolean).map((s) => env.DB.prepare(s))));
  await env.DB.prepare("INSERT INTO elections (id, title, description) VALUES (1, '', '')").run();
}
async function schedule() {
  return await env.DB.prepare("SELECT opens_at, closes_at FROM elections WHERE id = 1").first<{ opens_at: string; closes_at: string }>();
}
/** Aturan formulir Pengaturan: nilai datetime-local dikirim dengan offset JST. */
function submitValueFromInput(inputValue: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(inputValue) ? `${inputValue}:00+09:00` : inputValue;
}

describe("Jadwal Pengaturan: tampilan JST dan simpan ulang", () => {
  beforeEach(() => setup());

  it("mengisi input datetime-local dengan waktu dinding JST", () => {
    // 19:19 UTC adalah 04:19 JST hari berikutnya.
    expect(toJstInputValue("2026-11-18T19:19:00.000Z")).toBe("2026-11-19T04:19");
    expect(toJstInputValue("2026-11-18T22:24:00.000Z")).toBe("2026-11-19T07:24");
    // Potongan UTC tidak lagi dipakai: itulah sumber pergeseran -9 jam.
    expect(toJstInputValue("2026-11-18T19:19:00.000Z")).not.toBe("2026-11-18T19:19");
    expect(toJstInputValue(null)).toBe("");
    expect(toJstInputValue("bukan tanggal")).toBe("");
  });

  it("menyimpan ulang formulir tanpa perubahan tidak menggeser jadwal", async () => {
    const stored = { opens_at: "2026-11-18T19:19:00.000Z", closes_at: "2026-11-18T22:24:00.000Z" };
    await setSchedule(env.DB, NOW, { title: "Pemilihan", description: "", opens_at: stored.opens_at, closes_at: stored.closes_at });
    // Halaman merender nilai input, panitia menekan Simpan Jadwal tanpa mengubah apa pun.
    const opensInput = toJstInputValue((await schedule()).opens_at);
    const closesInput = toJstInputValue((await schedule()).closes_at);
    expect(opensInput).toBe("2026-11-19T04:19");
    expect(closesInput).toBe("2026-11-19T07:24");
    await setSchedule(env.DB, NOW, {
      title: "Pemilihan",
      description: "",
      opens_at: submitValueFromInput(opensInput),
      closes_at: submitValueFromInput(closesInput),
    });
    // Instan tersimpan tetap sama (bukan -9 jam, bukan +9 jam).
    expect(await schedule()).toEqual(stored);
    // Simpan ulang berkali-kali tetap stabil.
    for (let i = 0; i < 3; i++) {
      const current = await schedule();
      await setSchedule(env.DB, NOW, {
        title: "Pemilihan",
        description: "",
        opens_at: submitValueFromInput(toJstInputValue(current.opens_at)),
        closes_at: submitValueFromInput(toJstInputValue(current.closes_at)),
      });
    }
    expect(await schedule()).toEqual(stored);
  });

  it("menyimpan nilai yang diketik dalam JST sebagai instan UTC yang benar", async () => {
    // 10:00 JST = 01:00 UTC.
    await setSchedule(env.DB, NOW, { title: "Pemilihan", description: "", opens_at: submitValueFromInput("2026-11-19T10:00"), closes_at: submitValueFromInput("2026-11-19T15:30") });
    expect(await schedule()).toEqual({ opens_at: "2026-11-19T01:00:00.000Z", closes_at: "2026-11-19T06:30:00.000Z" });
    // Nilai tanpa zona yang dikirim langsung (tanpa langkah +09:00 di peramban) bermakna JST yang sama.
    expect(fromJstInputValue("2026-11-19T10:00")).toBe("2026-11-19T01:00:00.000Z");
    await setSchedule(env.DB, NOW, { title: "Pemilihan", description: "", opens_at: "2026-11-19T10:00", closes_at: "2026-11-19T15:30" });
    expect(await schedule()).toEqual({ opens_at: "2026-11-19T01:00:00.000Z", closes_at: "2026-11-19T06:30:00.000Z" });
    // Nilai yang sudah membawa zona tetap dipakai apa adanya.
    await setSchedule(env.DB, NOW, { title: "Pemilihan", description: "", opens_at: "2026-11-19T01:00:00.000Z", closes_at: "2026-11-19T06:30:00.000Z" });
    expect(await schedule()).toEqual({ opens_at: "2026-11-19T01:00:00.000Z", closes_at: "2026-11-19T06:30:00.000Z" });
  });

  it("menolak nilai kosong atau tidak valid, dan jadwal terbalik", async () => {
    await expect(setSchedule(env.DB, NOW, { title: "Pemilihan", description: "", opens_at: "bukan tanggal", closes_at: "2026-11-19T15:30" })).rejects.toThrow("Jadwal tidak valid");
    await expect(setSchedule(env.DB, NOW, { title: "Pemilihan", description: "", opens_at: "", closes_at: "2026-11-19T15:30" })).rejects.toThrow("Jadwal tidak valid");
    await expect(setSchedule(env.DB, NOW, { title: "Pemilihan", description: "", opens_at: "2026-11-19T10:00", closes_at: "2026-11-19T09:00" })).rejects.toThrow("Jadwal tidak valid");
    expect(await schedule()).toEqual({ opens_at: null, closes_at: null });
  });

  it("perpanjangan waktu memakai aturan JST yang sama", async () => {
    await env.DB.prepare("UPDATE elections SET status_lock = 'locked', opens_at = '2026-11-18T17:00:00.000Z', closes_at = '2026-11-18T20:00:00.000Z' WHERE id = 1").run();
    // 10:00 JST pada 19 November = 01:00 UTC, lebih akhir dari penutupan sekarang (20:00 UTC 18 November).
    await extendClosing(env.DB, NOW, "2026-11-19T10:00", "Perpanjangan");
    expect((await schedule()).closes_at).toBe("2026-11-19T01:00:00.000Z");
    await expect(extendClosing(env.DB, NOW, "2026-11-19T03:00", "Terlalu awal")).rejects.toThrow("harus lebih akhir");
  });

  it("halaman memakai konversi bersama, bukan potongan UTC", () => {
    expect(pemilihan).toContain("value={toJstInputValue(e?.opens_at)}");
    expect(pemilihan).toContain("value={toJstInputValue(e?.closes_at)}");
    expect(pemilihan).not.toContain("e?.opens_at?.slice(0, 16)");
    expect(pemilihan).not.toContain("e?.closes_at?.slice(0, 16)");
    // Label input tetap menyebut JST, dan formulir mengirim nilai itu dengan offset JST.
    expect(pemilihan).toContain("Mulai · JST");
    expect(pemilihan).toContain("Selesai · JST");
    expect(pemilihan).toContain("v[k]+=':00+09:00'");
  });
});
