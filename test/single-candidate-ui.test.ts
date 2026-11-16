import { describe, expect, it } from "vitest";
import ballot from "../src/pages/pilih-suara.astro?raw";
import dasbor from "../src/pages/admin/dasbor.astro?raw";
import hasil from "../src/pages/hasil.astro?raw";
import landing from "../src/pages/index.astro?raw";
import { VOTE_CHOICES, VOTE_CHOICE_LABELS } from "../src/server/voting/choice";

// Halaman memakai aturan yang sama dengan server: tiga jawaban, Abstain jawaban nyata,
// dan sistem tidak pernah menyatakan hasil (keputusan owner 2026-11-16). Perilaku
// tombolnya diuji di peramban (screenshot), di sini hanya isi sumber halaman.
describe("UI mode kandidat tunggal: tiga jawaban, tanpa baris hasil", () => {
  it("surat suara menawarkan tepat Setuju, Tidak Setuju dan Abstain dari daftar server", () => {
    expect([...VOTE_CHOICES]).toEqual(["setuju", "tidak_setuju", "abstain"]);
    for (const choice of VOTE_CHOICES) {
      expect(ballot).toContain(`{value:'${choice}',label:'${VOTE_CHOICE_LABELS[choice]}'}`);
    }
    // Pesan konfirmasi memakai label jawaban terpilih: "Pilihan Anda: <jawaban> terhadap <nickname>".
    expect(ballot).toContain("terhadap ${selected.nickname}");
  });

  it("Dasbor, Hasil dan beranda tidak punya baris keputusan atau kata menunggu penutupan", () => {
    for (const page of [dasbor, hasil, landing]) {
      expect(page).not.toMatch(/outcome|Terpilih|Tidak terpilih|Seri,|Menunggu penutupan|Keputusan pemilihan/);
      expect(page).not.toContain("dihitung Tidak Setuju");
    }
  });

  it("Dasbor, Hasil dan beranda menampilkan Abstain dan tidak memilih (dihitung Abstain)", () => {
    for (const page of [dasbor, hasil, landing]) {
      expect(page).toContain("Abstain");
      expect(page).toContain("Tidak memilih (dihitung Abstain)");
    }
  });

  it("Pilih Suara memakai kata tahap Ditutup dari keputusan owner Q191 dan menjaga kata Terjadwal", () => {
    expect(ballot).toContain('eligibility.stage === "scheduled" ? "Pemilihan terjadwal" : "Pemilihan ditutup"');
    expect(ballot).toContain('"Pemungutan suara belum dimulai. Kembali saat jadwal dibuka." : "Batas waktu pemungutan suara telah lewat."');
    expect(ballot).toContain("not_open:'Batas waktu pemungutan suara telah lewat.'");
    expect(ballot).not.toContain("Pemungutan suara sudah ditutup");
    expect(ballot).not.toContain("Saat ini pemungutan suara tidak dibuka");
  });
});
