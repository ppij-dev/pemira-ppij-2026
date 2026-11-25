import { describe, expect, it } from "vitest";
import ballot from "../src/pages/pilih-suara.astro?raw";
import inviteBallot from "../src/pages/undangan/[kode]/surat-suara.astro?raw";
import dasbor from "../src/pages/admin/dasbor.astro?raw";
import hasil from "../src/pages/hasil.astro?raw";
import landing from "../src/pages/index.astro?raw";
import pengaturan from "../src/pages/admin/pemilihan.astro?raw";
import { VOTE_CHOICES, VOTE_CHOICE_LABELS } from "../src/server/voting/choice";

// Halaman memakai aturan yang sama dengan server: dua jawaban, Setuju dan Tidak
// Setuju (keputusan owner 2026-11-22), dan sistem tidak pernah menyatakan hasil.
// Perilaku tombolnya diuji di peramban (screenshot), di sini hanya isi sumber halaman.
describe("UI mode kandidat tunggal: dua jawaban, tanpa baris hasil", () => {
  it("surat suara dan surat suara undangan menawarkan tepat Setuju dan Tidak Setuju", () => {
    expect([...VOTE_CHOICES]).toEqual(["setuju", "tidak_setuju"]);
    for (const choice of VOTE_CHOICES) {
      expect(ballot).toContain(`{value:'${choice}',label:'${VOTE_CHOICE_LABELS[choice]}'}`);
      expect(inviteBallot).toContain(`{ value: "${choice}", label: "${VOTE_CHOICE_LABELS[choice]}" }`);
    }
    // Abstain bukan pilihan Pemilih lagi, di kedua jalur surat suara.
    for (const page of [ballot, inviteBallot]) {
      expect(page).not.toContain("{value:'abstain',label:'Abstain'}");
      expect(page).not.toContain('{ value: "abstain", label: "Abstain" }');
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

  it("Dasbor menampilkan Abstain sebagai Pemilih yang tidak memilih; Hasil dan beranda tanpa Abstain", () => {
    expect(dasbor).toContain("Abstain");
    expect(dasbor).toContain("tidak memilih");
    expect(dasbor).not.toContain("Abstain diberikan");
    // revise-public-results-view (owner 2026-11-26): halaman publik hanya Setuju vs Tidak Setuju.
    for (const page of [hasil, landing]) {
      expect(page).not.toMatch(/abstain/i);
      expect(page).not.toContain("terlalu sedikit");
    }
  });

  it("Pilih Suara memakai kata tahap Ditutup dari keputusan owner Q191 dan menjaga kata Terjadwal", () => {
    expect(ballot).toContain('eligibility.stage === "scheduled" ? "Pemilihan terjadwal" : "Pemilihan ditutup"');
    expect(ballot).toContain('"Pemungutan suara belum dimulai. Kembali saat jadwal dibuka." : "Batas waktu pemungutan suara telah lewat."');
    expect(ballot).toContain("not_open:'Batas waktu pemungutan suara telah lewat.'");
    expect(ballot).not.toContain("Pemungutan suara sudah ditutup");
    expect(ballot).not.toContain("Saat ini pemungutan suara tidak dibuka");
  });
  it("Dasbor menyebut '(belum dihitung)' sebelum rekap dan memakai abstain_counted", () => {
    expect(dasbor).toContain("tidak memilih (belum dihitung)");
    expect(dasbor).toContain("abstain_counted");
    // Tanpa rincian jawaban Abstain: satu angka total saja di Dasbor.
    expect(dasbor).not.toContain("abstainParts");
  });


  it("Pengaturan tidak punya Hitung Abstain lagi dan mengarahkan rekap ke halaman Rekapitulasi", () => {
    // Tindakan Hitung Abstain digantikan Rekapitulasi Suara (Q232-Q234, 2026-11-22).
    expect(pengaturan).not.toContain("abstain-count");
    expect(pengaturan).not.toContain('id="abstain-dialog"');
    expect(pengaturan).toContain("jalankan Rekapitulasi Suara di halaman Rekapitulasi terlebih dahulu");
    expect(pengaturan).toContain('href="/admin/rekap"');
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
