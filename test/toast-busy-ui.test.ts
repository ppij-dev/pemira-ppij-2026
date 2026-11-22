import { describe, expect, it } from "vitest";
import toastComponent from "../src/components/ui/Toast.astro?raw";
import busyComponent from "../src/components/ui/BusyButton.astro?raw";
import adminLayout from "../src/layouts/AdminLayout.astro?raw";
import baseLayout from "../src/layouts/Base.astro?raw";
import previewLayout from "../src/layouts/DesignPreviewLayout.astro?raw";
import pengaturan from "../src/pages/admin/pemilihan.astro?raw";
import rekap from "../src/pages/admin/rekap.astro?raw";
import kandidat from "../src/pages/admin/kandidat.astro?raw";
import pemilih from "../src/pages/admin/pemilih.astro?raw";
import panitia from "../src/pages/admin/index.astro?raw";
import undangan from "../src/pages/admin/undangan.astro?raw";
import dasbor from "../src/pages/admin/dasbor.astro?raw";
import audit from "../src/pages/admin/audit.astro?raw";
import pilihSuara from "../src/pages/pilih-suara.astro?raw";
import undanganMasuk from "../src/pages/undangan/[kode].astro?raw";
import undanganSurat from "../src/pages/undangan/[kode]/surat-suara.astro?raw";
import akun from "../src/pages/akun.astro?raw";
import suratSuara from "../src/pages/surat-suara.astro?raw";
import papanBukti from "../src/pages/papan-bukti.astro?raw";

// Umpan balik aksi Admin Voting dan Pemilih: satu komponen Toast dan satu
// helper tombol sibuk (window.withBusy) dipasang di layout, lalu setiap aksi
// memakai keduanya. Perilaku visualnya diuji di peramban (screenshot); di sini
// isi sumber halaman dan komponen.
describe("Komponen Toast", () => {
  it("memiliki varian sukses, galat, dan info dengan peran ARIA yang benar", () => {
    expect(toastComponent).toContain('id="toast-region"');
    expect(toastComponent).toContain('aria-live="polite"');
    // Sukses dan info memakai role="status"; galat memakai role="alert".
    expect(toastComponent).toContain("success:{role:'status'");
    expect(toastComponent).toContain("error:{role:'alert'");
    expect(toastComponent).toContain("info:{role:'status'");
    for (const variant of ["success", "error", "info"]) {
      expect(toastComponent).toContain(`data-toast-icon="${variant}"`);
    }
    expect(toastComponent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("auto-dismiss sukses 4 detik, galat lebih lama, dengan tombol tutup", () => {
    expect(toastComponent).toContain("DEFAULT_MS={success:4000,error:7000,info:5000}");
    expect(toastComponent).toContain('data-toast-close');
    expect(toastComponent).toContain('aria-label="Tutup pemberitahuan"');
    expect(toastComponent).toContain("clearTimeout");
  });

  it("bertumpuk di bawah pada ponsel di atas navigasi bawah, kanan atas di desktop", () => {
    // Posisi bawah mengikuti safe-area; navigasi bawah setinggi 3,5 rem.
    expect(toastComponent).toContain("bottom-[calc(4.75rem+env(safe-area-inset-bottom))]");
    // Pada 701px ke atas (bilah bawah admin menghilang) pindah ke kanan atas.
    expect(toastComponent).toContain("min-[701px]:top-5");
    expect(toastComponent).toContain("min-[701px]:right-5");
    expect(toastComponent).toContain("min-[701px]:bottom-auto");
  });

  it("menyediakan window.toast dan alur satu-pakai lewat flag URL yang dihapus", () => {
    expect(toastComponent).toContain("window.toast=function(message,options)");
    expect(toastComponent).toContain("window.toastFromFlag=function(flag,message,options)");
    expect(toastComponent).toContain("history.replaceState(null,'',url.pathname+url.search+url.hash)");
    expect(toastComponent).toContain("url.searchParams.delete(flag)");
  });
});

describe("Helper tombol sibuk (window.withBusy)", () => {
  it("menonaktifkan tombol, memakai spinner, dan menandai aria-busy", () => {
    expect(busyComponent).toContain("window.withBusy=async function(button,busyLabel,run)");
    expect(busyComponent).toContain("animate-spin");
    expect(busyComponent).toContain("button.disabled=true");
    expect(busyComponent).toContain("button.setAttribute('aria-busy','true')");
    expect(busyComponent).toContain("button.removeAttribute('aria-busy')");
  });

  it("mencegah kirim ganda dan memulihkan tombol setelah selesai", () => {
    expect(busyComponent).toContain("button.getAttribute('data-busy')==='1'");
    expect(busyComponent).toContain("button.disabled=wasDisabled");
    expect(busyComponent).toContain("button.innerHTML=original");
    expect(busyComponent).toContain("button.removeAttribute('data-busy')");
  });

  it("dipasang bersama Toast di semua layout", () => {
    for (const layout of [adminLayout, baseLayout, previewLayout]) {
      expect(layout).toContain("<Toast />");
      expect(layout).toContain("<BusyButton />");
    }
  });
});

describe("Pengaturan (admin/pemilihan): setiap aksi memakai toast dan tombol sibuk", () => {
  it("Simpan Jadwal: Menyimpan… dan toast sukses", () => {
    expect(pengaturan).toContain("busyLabel:'Menyimpan…',success:'Jadwal pemilihan tersimpan.'");
    expect(pengaturan).toContain("window.withBusy(button,busyLabel");
  });

  it("Kunci & Jadwalkan: Mengunci… dan toast sukses", () => {
    expect(pengaturan).toContain("busyLabel:'Mengunci…',success:'Pemilihan terkunci dan terjadwal.'");
  });

  it("Perpanjang, Tutup Sekarang, Umumkan Hasil memakai action() dengan toast", () => {
    expect(pengaturan).toContain("success:'Waktu pemungutan suara diperpanjang.'");
    expect(pengaturan).toContain("success:'Pemungutan suara ditutup.'");
    expect(pengaturan).toContain("success:'Hasil pemilihan telah diumumkan.'");
    // Galat memakai teks galat server.
    expect(pengaturan).toContain("(d.error||'Tindakan gagal')");
    expect(pengaturan).toContain("{variant:'error'}");
  });

  it("saklar mode kandidat tunggal dan Tidak Membekukan DPT memakai toast", () => {
    expect(pengaturan).toContain("window.toast(enabled?'Mode kandidat tunggal diaktifkan.':'Mode kandidat tunggal dinonaktifkan.'");
    expect(pengaturan).toContain("window.toast(enabled?'Tidak Membekukan DPT diaktifkan.':'Tidak Membekukan DPT dinonaktifkan.'");
    expect(pengaturan).toContain("scToggle.setAttribute('aria-busy','true')");
    expect(pengaturan).toContain("lvToggle.setAttribute('aria-busy','true')");
  });

  it("Kembali ke Draf: tombol sibuk di dialog, toast sukses lewat flag kembali=1", () => {
    expect(pengaturan).toContain("window.withBusy(returnConfirm,'Mengembalikan…'");
    expect(pengaturan).toContain("window.toastFromFlag('kembali'");
    expect(pengaturan).toContain("Pemilihan kembali ke Draf.");
    expect(pengaturan).toContain("{variant:'error'})}finally{returnBusy=false");
  });

  it("Rekapitulasi di halaman rekap: tombol sibuk di dialog dan toast sukses", () => {
    expect(rekap).toContain("window.withBusy(confirmButton, \"Merekap…\"");
    expect(rekap).toContain("window.toast(\"Rekapitulasi Suara dijalankan: angka tidak memilih disimpan sebagai Abstain.\"");
    expect(rekap).toContain("window.withBusy(exportButton, \"Menyiapkan berkas…\"");
  });

  it("Periksa ulang kesiapan memakai tombol sibuk", () => {
    expect(pengaturan).toContain("window.withBusy(document.querySelector('#refresh'),'Memeriksa…'");
  });
});

describe("Kandidat: simpan dan hapus memakai toast dan tombol sibuk", () => {
  it("Simpan Kandidat: Menyimpan…, muat ulang dengan flag sekali-pakai", () => {
    expect(kandidat).toContain("window.withBusy(button,'Menyimpan…'");
    expect(kandidat).toContain("location.assign('/admin/kandidat?kandidat=1')");
    expect(kandidat).toContain("window.toastFromFlag('kandidat','Kandidat tersimpan.'");
  });

  it("Hapus kandidat: Menghapus…, flag kandidat-terhapus", () => {
    expect(kandidat).toContain("window.withBusy(b,'Menghapus…'");
    expect(kandidat).toContain("location.assign('/admin/kandidat?kandidat-terhapus=1')");
    expect(kandidat).toContain("window.toastFromFlag('kandidat-terhapus','Kandidat dihapus.'");
  });

  it("galat server tampil sebagai toast galat", () => {
    expect(kandidat).toContain("window.toast(d.error||'Kandidat belum tersimpan. Coba kembali.',{variant:'error'})");
  });
});

describe("Pemilih: sinkronisasi memakai toast dan tombol sibuk", () => {
  it("Sinkronkan Data Pemilih dan Perbarui Nama & Kategori memakai withBusy + toast", () => {
    // Kedua tombol memakai label sibuk masing-masing lewat run() yang sama.
    expect(pemilih).toContain("run(syncButton, '/api/admin/sync', 'Menyinkronkan…'");
    expect(pemilih).toContain("run(namesButton, '/api/admin/sync-names', 'Memperbarui…'");
    expect(pemilih).toContain("window.withBusy(button, busyText");
    expect(pemilih).toContain("window.toast(done(body||{})");
    expect(pemilih).toContain("window.toast(failureText(response,body)");
    // Galat tetap menerjemahkan kode status server menjadi kalimat Indonesia.
    expect(pemilih).toContain("function failureText(response, body)");
  });
});

describe("Panitia: undang, hapus, batalkan, dan salin memakai toast dan tombol sibuk", () => {
  it("Buat undangan Admin Voting: Memproses… dan toast sukses", () => {
    expect(panitia).toContain("window.withBusy(button,'Memproses…'");
    expect(panitia).toContain("window.toast('Undangan Admin Voting dibuat.'");
  });

  it("Hapus Admin Voting dan Batalkan undangan: tombol sibuk, toast lewat flag muat ulang", () => {
    expect(panitia).toContain("window.withBusy(button,'Menghapus…'");
    expect(panitia).toContain("location.assign('/admin?panitia-terhapus=1')");
    expect(panitia).toContain("window.withBusy(button,'Membatalkan…'");
    expect(panitia).toContain("location.assign('/admin?undangan-dibatalkan=1')");
    expect(panitia).toContain("window.toastFromFlag('panitia-terhapus','Admin Voting dihapus.'");
    expect(panitia).toContain("window.toastFromFlag('undangan-dibatalkan','Undangan Admin Voting dibatalkan.'");
  });

  it("tombol Salin tautan memakai toast", () => {
    expect(panitia).toContain("window.toast('Tautan undangan disalin.'");
  });
});

describe("Undangan Pemilih: buat, batalkan, salin, unduh Excel", () => {
  it("Buat undangan: Membuat… dan toast sukses", () => {
    expect(undangan).toContain('window.withBusy(generateButton,"Membuat…"');
    expect(undangan).toContain('{variant:"success",duration:7000}');
  });

  it("Batalkan tautan: tombol sibuk per baris dan toast sukses", () => {
    expect(undangan).toContain('window.withBusy(cancelButton,"Membatalkan…"');
    expect(undangan).toContain('window.toast("Tautan undangan dibatalkan."');
  });

  it("Salin tautan dan Unduh Excel memakai toast", () => {
    expect(undangan).toContain('window.toast("Tautan undangan disalin."');
    expect(undangan).toContain('window.withBusy(exportButton,"Menyiapkan berkas…"');
    expect(undangan).toContain('window.toast("Berkas Excel diunduh."');
  });
});

describe("Dasbor dan Audit", () => {
  it("Muat Ulang Data dasbor: tombol sibuk dan toast sukses pada muat manual", () => {
    expect(dasbor).toContain("window.withBusy(refresh,'Memuat…',()=>load(true))");
    expect(dasbor).toContain("window.toast('Data dasbor dimuat ulang.'");
  });

  it("Periksa ulang integritas memakai tombol sibuk dengan toast hasilnya", () => {
    expect(audit).toContain("window.withBusy(document.querySelector('#integrity-check'),'Memeriksa…'");
    expect(audit).toContain("window.toast('Rantai log utuh.'");
    expect(audit).toContain("window.toast('Rantai log terputus pada seq '+d.broken_at+'.',{variant:'error'})");
  });

  it("Salin hash snapshot dan Muat lainnya memakai toast / tombol sibuk", () => {
    expect(audit).toContain("window.toast('Hash snapshot disalin.'");
    expect(audit).toContain("window.withBusy(more,'Memuat…',()=>load())");
  });
});

describe("Halaman Pemilih yang mengirim data", () => {
  it("Kirim suara (portal dan undangan): tombol sibuk Mengirim… dan toast galat", () => {
    expect(pilihSuara).toContain("window.withBusy(sendBtn,'Mengirim…'");
    expect(undanganSurat).toContain('window.withBusy(sendBtn, "Mengirim…"');
    expect(pilihSuara).toContain("{variant:'error'}");
    expect(undanganSurat).toContain('{variant:"error"}');
  });

  it("Salin kode bukti memakai toast", () => {
    expect(pilihSuara).toContain("window.toast('Kode bukti disalin.'");
    expect(undanganSurat).toContain('window.toast("Kode bukti disalin."');
    expect(suratSuara).toContain("window.toast('Kode bukti disalin.'");
  });

  it("formulir klaim undangan: tombol sibuk Menyimpan… dan toast galat server", () => {
    expect(undanganMasuk).toContain('window.withBusy(submit, "Menyimpan…"');
    expect(undanganMasuk).toContain('window.toast(errors[data.error]||"Data belum dapat disimpan. Coba lagi."');
  });

  it("Keluar (akun): tombol sibuk Keluar… dan toast galat", () => {
    expect(akun).toContain("window.withBusy(logout,'Keluar…'");
    expect(akun).toContain("{variant:'error'}");
  });

  it("Salin hash snapshot di papan bukti memakai toast", () => {
    expect(papanBukti).toContain("window.toast('Hash snapshot disalin.'");
  });
});
