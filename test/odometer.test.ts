import { describe, expect, it } from "vitest";
import { odometerVisual, planOdometer } from "../src/lib/odometer";
import odometerSource from "../src/lib/odometer.ts?raw";
import landing from "../src/pages/index.astro?raw";
import dasbor from "../src/pages/admin/dasbor.astro?raw";

/**
 * Odometer strip statistik dan hitung mundur: hanya digit yang berubah yang
 * menggelinding, lebar sel dikunci agar tidak ada pergeseran tata letak,
 * prefers-reduced-motion mengubah seketika, dan pembaca layar tidak diumumkan
 * tiap detik. Logika rencana diuji langsung; perilaku halaman diuji di
 * peramban (tangkapan layar/rekaman), sesuai konvensi uji UI proyek ini.
 */

describe("planOdometer", () => {
  it("hanya posisi digit yang berubah ditandai menggelinding", () => {
    const plan = planOdometer("12:34:56", "12:34:57");
    expect(plan.rebuild).toBe(false);
    expect(plan.cells.map((c) => c.roll)).toEqual([false, false, false, false, false, false, false, true]);
    expect(plan.cells.at(-1)).toEqual({ char: "7", roll: true });
  });

  it("beberapa digit berubah sekaligus: semua digelindingkan", () => {
    const plan = planOdometer("09:59:59", "10:00:00");
    expect(plan.rebuild).toBe(false);
    expect(plan.cells.map((c) => c.roll)).toEqual([true, true, false, true, true, false, true, true]);
  });

  it("angka sama persis tidak menggelindingkan apa pun", () => {
    const plan = planOdometer("397", "397");
    expect(plan.rebuild).toBe(false);
    expect(plan.cells.every((c) => !c.roll)).toBe(true);
  });

  it("perubahan panjang (999 ke 1.000) memicu bangun ulang seketika", () => {
    const plan = planOdometer("999", "1.000");
    expect(plan.rebuild).toBe(true);
    expect(plan.cells).toEqual([]);
  });

  it("karakter non-digit yang bergeser tulis langsung tanpa animasi", () => {
    const plan = planOdometer("1.234", "1.235");
    expect(plan.rebuild).toBe(false);
    expect(plan.cells[1]).toEqual({ char: ".", roll: false });
    expect(plan.cells.at(-1)).toEqual({ char: "5", roll: true });
  });
});

describe("spasi di dalam sel odometer", () => {
  it("spasi digambar non-breaking (1 hari 06:36:17 tidak runtuh jadi 1hari06:36:17)", () => {
    const chars = [..."1 hari 06:36:17"];
    expect(chars.map(odometerVisual)).toEqual([..."1\u00A0hari\u00A006:36:17"]);
    // Dua spasi tetap ada sebagai sel 1ch, bukan hilang.
    expect(chars.map(odometerVisual).filter((c) => c === "\u00A0")).toHaveLength(2);
    expect(chars.map(odometerVisual).filter((c) => c === " ")).toHaveLength(0);
  });

  it("digit dan pemisah tidak berubah, dan rencana tetap menyimpan spasi apa adanya", () => {
    for (const char of "0123456789:.") expect(odometerVisual(char)).toBe(char);
    const plan = planOdometer("1 hari 06:36:17", "1 hari 06:36:18");
    expect(plan.rebuild).toBe(false);
    expect(plan.cells.map((c) => c.char).join("")).toBe("1 hari 06:36:18");
    expect(plan.cells.filter((c) => c.char === " ").every((c) => !c.roll)).toBe(true);
    expect(plan.cells.map((c) => c.roll).filter(Boolean)).toHaveLength(1);
  });

  it("CSS sel mengunci spasi dan cermin sr-only tetap memakai spasi biasa", () => {
    // Sel inline-block hanya spasi akan runtuh tanpa white-space:pre.
    expect(odometerSource).toMatch(/\.odo-cell\{[^}]*white-space:pre/);
    // Teks yang dikirim ke DOM selalu lewat odometerVisual, cermin tidak.
    expect(odometerSource).not.toMatch(/createTextNode\(state\.char\)/);
    expect(odometerSource).not.toMatch(/createTextNode\(next\)/);
    expect(odometerSource).toMatch(/mirror\.textContent = next/);
    expect(odometerSource).toMatch(/mirror\.textContent = initial/);
  });
});

describe("sumber odometer dan pemasangannya di halaman", () => {
  it("lebar sel digit dikunci 1ch agar tidak ada alih tata letak", () => {
    expect(odometerSource).toContain("min-width:1ch");
    // Halaman memakai font mono + tabular-nums pada elemen angkanya.
    expect(landing).toContain("tabular-nums");
    expect(dasbor).toContain('id="countdown" class="mt-1 font-mono');
    expect(dasbor).toContain("tabular-nums text-brand-ink");
  });

  it("menghormati prefers-reduced-motion: animasi dilewati di JS dan CSS", () => {
    expect(odometerSource).toContain("prefers-reduced-motion: reduce");
    expect(odometerSource).toContain("@media (prefers-reduced-motion:reduce)");
  });

  it("sel visual aria-hidden dan teks pembaca layar di satu span sr-only", () => {
    expect(odometerSource).toContain('setAttribute("aria-hidden", "true")');
    expect(odometerSource).toContain('className = "sr-only"');
  });

  it("hanya animasi transform/opacity: hemat CPU tanpa dependensi", () => {
    expect(odometerSource).not.toMatch(/import\s/);
    expect(odometerSource).toContain("translateY(-100%)");
    expect(odometerSource).toContain("translateY(100%)");
  });

  it("beranda memakai odometer untuk hitung mundur dan kedua angka strip", () => {
    expect(landing).toContain('import { attachOdometer } from "../lib/odometer"');
    expect(landing).toContain("attachOdometer(el)");
    expect(landing).toContain('attachOdometer(eligible)');
    expect(landing).toContain('attachOdometer(votes)');
    // Animasi flip lama sudah tidak ada.
    expect(landing).not.toContain("turnout-flip");
  });

  it("beranda memakai poller yang selalu lanjut (15 detik saat Dibuka)", () => {
    expect(landing).toContain('import { startTurnoutPoller } from "../lib/turnoutPoller"');
    expect(landing).toContain('(stage === "open" ? 15_000 : 60_000)');
    expect(landing).toContain('id="turnout-strip"');
    expect(landing.indexOf('id="turnout-strip"')).toBeLessThan(landing.indexOf("Jadwal pemungutan"));
    expect(landing).toContain("getTurnout");
  });

  it("Dasbor memakai odometer yang sama untuk hitung mundurnya", () => {
    expect(dasbor).toContain('import { attachOdometer } from "../../lib/odometer"');
    // Skrip is:inline Dasbor memakai helper global dengan fallback aman.
    expect(dasbor).toContain("window.attachOdometer");
    expect(dasbor).toContain("odo.set(text)");
    expect(dasbor).toContain("el.textContent=text");
  });
});
