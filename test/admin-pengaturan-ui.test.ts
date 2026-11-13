import { describe, expect, it } from "vitest";
import page from "../src/pages/admin/pemilihan.astro?raw";
import { RETURN_TO_DRAFT_PHRASE } from "../src/server/election/lifecycle";

// Pengaturan (admin/pemilihan.astro) harus memakai aturan server yang sama:
// tombol tampil dari canReturnToDraft, frasa dari RETURN_TO_DRAFT_PHRASE, dan
// saklar mode kandidat tunggal dari GET /api/election/single-candidate-mode.
// Perilaku tombolnya sendiri diuji di peramban (Playwright), bukan di sini.
describe("Pengaturan: Kembali ke Draf dan mode kandidat tunggal", () => {
  it("menampilkan tombol dari matriks ketersediaan server, bukan aturan sendiri", () => {
    expect(page).toContain("canReturnToDraft(");
    expect(page).toContain("{canReturn &&");
    expect(page).toContain("Kembali ke Draf");
  });

  it("memakai route dan frasa konfirmasi yang sama dengan server", () => {
    expect(page).toContain("'/api/election/return-to-draft'");
    expect(page).toContain(`'${RETURN_TO_DRAFT_PHRASE}'`);
    // Perbandingan klien dulu dinormalisasi seperti server: spasi dirapatkan, huruf besar.
    expect(page).toContain("replace(/\\s+/g,' ').trim().toUpperCase()");
    expect(page).toContain("returnConfirm.disabled=returnBusy||normalizePhrase(");
  });

  it("memuat ulang lewat navigasi dan menyebut suara tersimpan apa adanya", () => {
    expect(page).toContain("location.assign('/admin/pemilihan?kembali=1')");
    expect(page).toContain("Pemilihan kembali ke Draf.");
    expect(page).toContain("suara tetap tersimpan");
    expect(page).toContain("returnError.textContent=d.error");
  });

  it("menggerakkan saklar mode kandidat tunggal dari GET, termasuk alasannya", () => {
    expect(page).toContain("'/api/election/single-candidate-mode'");
    expect(page).toContain("scToggle.disabled=!d.editable");
    expect(page).toContain("scReason.textContent=d.reason||''");
  });
});
