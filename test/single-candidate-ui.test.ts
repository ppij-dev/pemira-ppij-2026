import { describe, expect, it } from "vitest";
import ballot from "../src/pages/pilih-suara.astro?raw";
import dasbor from "../src/pages/admin/dasbor.astro?raw";
import hasil from "../src/pages/hasil.astro?raw";
import landing from "../src/pages/index.astro?raw";
import pengaturan from "../src/pages/admin/pemilihan.astro?raw";
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
  it("Dasbor, Hasil dan beranda menyebut '(belum dihitung)' sebelum Hitung Abstain dan memakai abstain_counted", () => {
    for (const page of [dasbor, hasil]) {
      expect(page).toContain("tidak memilih (belum dihitung)");
      expect(page).toContain("abstain_counted");
    }
    expect(landing).toContain("(belum dihitung)");
    expect(landing).toContain("abstain_counted");
    // Rincian tidak memilih per korda hanya muncul setelah Hitung Abstain.
    expect(dasbor).toContain("i===2&&d.abstain_counted");
    expect(hasil).toContain("data.abstain_counted?'<span");
  });

  it("Pengaturan menaruh Hitung Abstain di Tindakan tahap dengan dialog yang menyebut angkanya", () => {
    expect(pengaturan).toContain("'/api/election/abstain-count'");
    expect(pengaturan).toContain('id="abstain-dialog"');
    expect(pengaturan).toContain('id="abstain-number"');
    expect(pengaturan).toContain("hanya dapat dijalankan sekali dan tidak dapat dibatalkan");
    expect(pengaturan).toContain("abstainCard.hidden=!d.single_candidate_mode");
    expect(pengaturan).toContain("openAbstain.disabled=!d.can_run");
  });

  // Keputusan owner 2026-11-21: angka pilihan disegel dari semua orang, panitia
  // termasuk, sampai Umumkan Hasil. Dasbor membaca tally_sealed dari server.
  it("Dasbor menampilkan keadaan disegel sampai Umumkan Hasil tanpa satu angka pilihan", () => {
    expect(dasbor).toContain("const sealed=Boolean(d.tally_sealed)");
    expect(dasbor).toContain("Hasil disegel sampai Umumkan Hasil");
    // Nilai kunci pada panel Sikap suara (kandidat tunggal) dan perolehan keseluruhan.
    expect(dasbor).toContain("sealedPanel(single?'Sikap suara':'Perolehan suara keseluruhan'");
    // Alasan netral, bukan janji hasil.
    expect(dasbor).toContain("supaya penghitungan tetap netral dan pilihan setiap Pemilih tetap rahasia");
    // Ikon kunci dari Tabler (path IconLock), tanpa emoji.
    expect(dasbor).toContain("M8 11v-4a4 4 0 1 1 8 0v4");
    // Kolom Setuju, Tidak Setuju dan Abstain tidak dirender sama sekali selama disegel:
    // header pilihan hanya ada di cabang yang tidak disegel, dan selnya kosong.
    expect(dasbor).toContain("const kordaHead=sealed?''");
    expect(dasbor).toContain("const kordaCells=(k)=>sealed?'':kordaCellsUnsealed(k)");
    const lines = dasbor.split("\n");
    const headGuard = lines.findIndex((line) => line.includes("const kordaHead=sealed?''"));
    const choiceHeader = lines.findIndex((line) => line.includes(">Setuju</th>"));
    expect(headGuard).toBeGreaterThan(-1);
    // Header pilihan hanya hidup di cabang terlarang (`sealed?'':<pilihan>`), dua baris sesudahnya.
    expect(choiceHeader).toBe(headGuard + 2);
    // Tidak ada <th> pembungkus kosong: header terpasang langsung setelah kolom partisipasi.
    expect(dasbor).toContain(">Partisipasi</th>'+kordaHead+'</tr>");
    // Kolom partisipasi tetap dirender pada setiap baris.
    expect(dasbor).toContain("Angka pilihan per korda muncul setelah Umumkan Hasil.");
    // Angka pilihan hanya dirender dari cabang yang tidak disegel.
    expect(dasbor).toContain("const tallyPanelUnsealed=single");
    expect(dasbor).not.toMatch(/emoji|🔒/u);
  });
});
