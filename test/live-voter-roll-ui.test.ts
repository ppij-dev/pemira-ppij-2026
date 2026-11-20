import { describe, expect, it } from "vitest";
import pengaturan from "../src/pages/admin/pemilihan.astro?raw";
import dasbor from "../src/pages/admin/dasbor.astro?raw";
import pemilih from "../src/pages/admin/pemilih.astro?raw";
import landing from "../src/pages/index.astro?raw";

// Halaman memakai aturan yang sama dengan server (keputusan owner 2026-11-19):
// saklar Tidak Membekukan DPT dari GET /api/election/live-voter-roll, peringatan
// view usang Dasbor dari watermark 5 menit, strip statistik dari /api/turnout.
// Perilaku visualnya diuji di peramban (screenshot); di sini isi sumber halaman.
describe("UI Tidak Membekukan DPT", () => {
  it("Pengaturan menggerakkan saklar dari GET yang sama dengan server", () => {
    expect(pengaturan).toContain("'/api/election/live-voter-roll'");
    expect(pengaturan).toContain("lvToggle.disabled=!d.editable");
    expect(pengaturan).toContain("Tidak Membekukan DPT diaktifkan.");
    expect(pengaturan).toContain("aria-label=\"Tidak Membekukan DPT\"");
    // Helper menyebut aturan Draf dan penetapan Hak pilih saat penutupan.
    expect(pengaturan).toContain("Hanya dapat diubah saat Draf");
    expect(pengaturan).toContain("Hak pilih ditetapkan saat pemungutan suara ditutup");
  });

  it("Dasbor menampilkan catatan roll portal dan peringatan view usang 5 menit", () => {
    expect(dasbor).toContain("Roll mengikuti portal (tidak dibekukan)");
    expect(dasbor).toContain("STALE_VIEW_MS = 5 * 60 * 1000");
    expect(dasbor).toContain("Daftar Pemilih sudah lama tidak diperbarui dari portal");
    // Peringatan hanya pada tahap Dibuka dan saat saklar menyala.
    expect(dasbor).toContain("currentStage === 'open'");
    expect(dasbor).toContain("liveRoll &&");
  });

  it("Pemilih page menyebut roll portal dengan waktu segar terakhir", () => {
    expect(pemilih).toContain("Roll mengikuti portal (tidak dibekukan)");
    expect(pemilih).toContain("Terakhir diperbarui dari portal:");
  });

  it("formatJst dideklarasikan sebelum pemakaian pertamanya di Pemilih", () => {
    // Regresi: rollDescription memakai formatJst sebelum deklarasi const-nya,
    // sehingga /admin/pemilih melempar ReferenceError (500) saat diakses.
    const declaration = pemilih.indexOf("const formatJst");
    const firstUse = pemilih.indexOf("formatJst(");
    expect(declaration).toBeGreaterThanOrEqual(0);
    expect(firstUse).toBeGreaterThan(declaration);
  });

  it("Beranda menampilkan strip di atas jadwal dan memakai /api/turnout", () => {
    expect(landing).toContain('id="turnout-strip"');
    expect(landing).toContain("Jumlah Pemilih");
    expect(landing).toContain("Suara Masuk");
    expect(landing.indexOf('id="turnout-strip"')).toBeLessThan(landing.indexOf('Jadwal pemungutan'));
    expect(landing).toContain("getTurnout");
    // Polling 15 detik saat Dibuka, 60 detik di tahap lain; jeda tab tersembunyi.
    expect(landing).toContain("'open'?15000:60000");
    expect(landing).toContain("visibilitychange");
  });
});
