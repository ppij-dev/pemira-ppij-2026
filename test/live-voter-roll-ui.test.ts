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
    // Saklar dapat dinyalakan hanya di Draf; setelah Kunci hanya bisa dimatikan
    // untuk membekukan DPT sekarang (keputusan owner 2026-11-22).
    expect(pengaturan).toContain("lvToggle.disabled=!(d.editable||d.can_freeze)");
    expect(pengaturan).toContain("lvState.can_freeze");
    expect(pengaturan).toContain("openFreezeDialog");
    expect(pengaturan).toContain("Tidak Membekukan DPT diaktifkan.");
    expect(pengaturan).toContain("aria-label=\"Tidak Membekukan DPT\"");
    // Helper menyebut aturan Draf, penetapan Hak pilih saat penutupan, dan
    // bahwa mematikan saklar saat berjalan membekukan DPT sekarang.
    expect(pengaturan).toContain("Hanya dapat diaktifkan saat Draf");
    expect(pengaturan).toContain("Hak pilih ditetapkan saat pemungutan suara ditutup");
    expect(pengaturan).toContain("membekukan DPT sekarang dan tidak dapat dibatalkan");
    // Dialog konfirmasi menyebut Hak pilih saat ini dan sifat satu arah;
    // catatan waktu beku memakai JST.
    expect(pengaturan).toContain("id=\"freeze-dialog\"");
    expect(pengaturan).toContain("id=\"freeze-number\"");
    expect(pengaturan).toContain("Tindakan ini satu arah dan tidak dapat dibatalkan");
    expect(pengaturan).toContain("Daftar Pemilih dibekukan pada ");
  });

  it("Dasbor menampilkan catatan roll portal dan peringatan view usang 5 menit", () => {
    expect(dasbor).toContain("Roll mengikuti portal (tidak dibekukan)");
    expect(dasbor).toContain("STALE_VIEW_MS = 5 * 60 * 1000");
    expect(dasbor).toContain("Daftar Pemilih sudah lama tidak diperbarui dari portal");
    // Peringatan hanya pada tahap Dibuka dan saat saklar menyala.
    expect(dasbor).toContain("currentStage === 'open'");
    expect(dasbor).toContain("liveRoll &&");
    // Setelah roll dibekukan (Kunci atau Bekukan DPT sekarang), Dasbor
    // menampilkan catatan beku dengan waktu JST dan angka beku.
    expect(dasbor).toContain("Daftar Pemilih dibekukan");
    expect(dasbor).toContain("frozenAt");
  });

  it("Pemilih page menyebut roll portal dengan waktu segar terakhir", () => {
    expect(pemilih).toContain("Roll mengikuti portal (tidak dibekukan)");
    expect(pemilih).toContain("Terakhir diperbarui dari portal:");
    // Setelah roll dibekukan, halaman menyebut waktu pembekuan.
    expect(pemilih).toContain("Daftar Pemilih dibekukan");
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
