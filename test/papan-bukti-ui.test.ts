import { describe, expect, it } from "vitest";
import board from "../src/pages/papan-bukti.astro?raw";
import daftar from "../src/pages/papan-bukti/daftar.astro?raw";
import {
  RECEIPT_PAGE_SIZE,
  clampPage,
  filterHashesByPrefix,
  findHashIndex,
  hashBoardCode,
  normalizeBoardCodeInput,
  normalizeHashQuery,
  pageCountFor,
  receiptPage,
} from "../src/lib/receiptBoard";

// Halaman Papan Bukti baru (keputusan owner 2026-11-22): ringkasan penutupan
// sebagai kartu statistik, pemeriksaan kode di peramban, dan daftar hash lengkap
// pindah ke /papan-bukti/daftar. Di sini diuji isi sumber halaman; perilaku
// tombolnya diverifikasi di peramban (screenshot wrangler dev).
describe("halaman Papan Bukti: ringkasan penutupan", () => {
  it("menampilkan empat kartu angka dengan penjelasan singkat", () => {
    for (const label of ["Hak pilih", "Suara masuk", "Partisipasi", "Surat suara di kotak"]) {
      expect(board).toContain(`label="${label}"`);
    }
    // Statistik dirender server dari sumber data yang sama dengan API papan.
    expect(board).toContain("getPublicBoard");
    // Penjelasan ramah untuk setiap angka, tanpa emoji.
    expect(board).toContain("Daftar Pemilih final saat penutupan.");
    expect(board).toContain("Suara masuk dibanding Hak pilih.");
    expect(board).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("menampilkan kesesuaian kotak dan partisipasi, dua arah", () => {
    expect(board).toContain("const matches = board ? board.participation_count === board.ballot_count : false;");
    expect(board).toContain("Surat suara di kotak dan Suara masuk sesuai");
    expect(board).toContain("berbeda dengan Suara masuk");
    expect(board).toContain("Hubungi panitia");
  });

  it("menampilkan waktu penutupan dan hash snapshot pendek dengan tombol salin", () => {
    expect(board).toContain("Waktu penutupan");
    expect(board).toContain("Hash snapshot penutupan");
    expect(board).toContain("snapshotHash.slice(0, 12)");
    expect(board).toContain('id="copy-snapshot"');
    expect(board).toContain('data-hash={snapshotHash ?? ""}');
    // Salin selalu hash penuh, bukan potongan pendeknya.
    expect(board).toContain('getAttribute("data-hash")');
  });

  it("menautkan daftar lengkap dengan jumlah hash dan membawa kembali", () => {
    expect(board).toContain('href="/papan-bukti/daftar"');
    expect(board).toContain("Lihat semua kode bukti (");
  });

  it("pemeriksaan kode berjalan lokal di peramban tanpa mengirim kode", () => {
    expect(board).toContain('import { findHashIndex, hashBoardCode, normalizeBoardCodeInput } from "../lib/receiptBoard"');
    expect(board).toContain('fetch("/api/votes/board")');
    expect(board).toContain("tanpa mengirim kode ke server");
    expect(board).toContain('id="board-code"');
    expect(board).not.toContain("receipt-check");
  });

  it("sebelum ditutup papan tetap menyatakan belum dibuka", () => {
    expect(board).toContain("Papan bukti belum dibuka");
    expect(board).toContain("Papan bukti diterbitkan setelah pemungutan suara ditutup.");
  });

  // Segel hasil (keputusan owner 2026-11-21): tidak ada angka pilihan di papan.
  // Tautan /hasil hanya boleh hidup setelah Diumumkan, dan hanya tautan.
  it("menjaga segel: tanpa angka pilihan, tautan /hasil hanya setelah Diumumkan", () => {
    expect(board).not.toMatch(/Setuju|Abstain|Perolehan suara|setuju_count|tidak_setuju_count|abstain_count|\/api\/results/u);
    const gate = board.indexOf("{published &&");
    const hasilLink = board.indexOf('href="/hasil"');
    expect(gate).toBeGreaterThan(-1);
    expect(hasilLink).toBeGreaterThan(gate);
    // Papan hanya menautkan hasil, tidak menghitungnya sendiri.
    expect(board).not.toMatch(/votes["']?\s*[:=]/u);
  });
});

describe("halaman daftar kode bukti", () => {
  it("memuat daftar dari API papan yang sama, tanpa data baru", () => {
    expect(daftar).toContain('fetch("/api/votes/board")');
    expect(daftar).toContain("receipt_hashes");
    // Tidak ada endpoint lain dan tidak ada kode mentah yang diminta.
    expect(daftar).not.toMatch(/\/api\/(results|dashboard|turnout|votes\/receipt-check)/u);
    // Segel hasil juga berlaku di daftar: hanya hash, tanpa angka pilihan.
    expect(daftar).not.toMatch(/Setuju|Abstain|setuju|abstain|Perolehan suara/u);
    // Ketersediaan pakai aturan dan gerbang yang sama dengan papan.
    expect(daftar).toContain("Papan bukti belum dibuka");
    expect(daftar).toContain('stage(row, new Date().toISOString()) === "closed"');
  });

  it("punya kotak cari awalan hash dan paginasi lokal", () => {
    expect(daftar).toContain('import { filterHashesByPrefix, normalizeHashQuery, receiptPage } from "../../lib/receiptBoard"');
    expect(daftar).toContain('id="hash-search"');
    expect(daftar).toContain('id="page-prev"');
    expect(daftar).toContain('id="page-next"');
    expect(daftar).toContain('id="page-indicator"');
    // Halaman kembali satu saat kueri berubah; naik-turun lewat tombol.
    expect(daftar).toContain("page = 1");
    expect(daftar).toContain("Sebelumnya");
    expect(daftar).toContain("Berikutnya");
    // Hash monospace, terbungkus rapi di ponsel 390 px.
    expect(daftar).toContain("font-mono");
    expect(daftar).toContain("break-all");
  });

  it("menautkan kembali ke Papan Bukti", () => {
    expect(daftar).toContain('href="/papan-bukti"');
    expect(daftar).toContain("Kembali ke Papan Bukti");
  });
});

describe("logika daftar: pencarian awalan, paginasi, normalisasi kode", () => {
  const hashes = Array.from({ length: 240 }, (_, i) => (i as number).toString(16).padStart(2, "0").repeat(32));

  it("ukuran halaman 100 dan tiga halaman untuk 240 hash", () => {
    expect(RECEIPT_PAGE_SIZE).toBe(100);
    expect(pageCountFor(240)).toBe(3);
    expect(pageCountFor(0)).toBe(1);
    expect(pageCountFor(101)).toBe(2);
  });

  it("paginasi memotong baris dan menjepit halaman di luar rentang", () => {
    const first = receiptPage(hashes, 1);
    expect(first).toMatchObject({ page: 1, pages: 3, start: 1, end: 100, total: 240 });
    expect(first.rows).toHaveLength(100);
    expect(receiptPage(hashes, 3).end).toBe(240);
    expect(receiptPage(hashes, 3).rows).toHaveLength(40);
    expect(receiptPage(hashes, 99).page).toBe(3);
    expect(receiptPage(hashes, 0).page).toBe(1);
    expect(receiptPage(hashes, -5).page).toBe(1);
    expect(clampPage(2, 240)).toBe(2);
    expect(clampPage(NaN, 240)).toBe(1);
    const empty = receiptPage([], 1);
    expect(empty).toMatchObject({ rows: [], page: 1, pages: 1, start: 0, end: 0, total: 0 });
  });

  it("pencarian menyaring awalan tanpa peduli huruf besar atau pemisah", () => {
    const sample = ["3f2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ABCD" + "0".repeat(60), "b19f" + "e".repeat(60)];
    expect(filterHashesByPrefix(sample, "3F")).toEqual([sample[0]]);
    expect(filterHashesByPrefix(sample, "3f-2a")).toEqual([sample[0]]);
    expect(filterHashesByPrefix(sample, "abcd")).toEqual([sample[1]]);
    expect(filterHashesByPrefix(sample, "fff")).toEqual([]);
    // Karakter bukan heks dibuang dari kueri; kueri yang tersisa kosong berarti
    // tidak menyaring apa pun (daftar penuh kembali).
    expect(filterHashesByPrefix(sample, "zzz")).toEqual(sample);
    expect(filterHashesByPrefix(sample, "  ")).toEqual(sample);
    expect(normalizeHashQuery(" 3F.2a ")).toBe("3f2a");
    // Pencarian lalu paginasi: hasil tersaring tetap dipotong per halaman.
    const zeros = Array.from({ length: 250 }, (_, i) => "0" + i.toString(16).padStart(7, "0") + "f".repeat(56));
    const filtered = filterHashesByPrefix(zeros, "0");
    expect(filtered).toHaveLength(250);
    const page3 = receiptPage(filtered, 3);
    expect(page3.page).toBe(3);
    expect(page3.rows).toHaveLength(50);
    expect(page3.end).toBe(250);
    // Papan mencocokkan hash tanpa peduli besar kecil hurufnya.
    expect(findHashIndex(["ABC", "def"], "DEF")).toBe(1);
  });

  it("normalisasi kode bukti di peramban sama dengan aturan server", async () => {
    expect(normalizeBoardCodeInput("abcd-efgh-jkmn-pqrt")).toBe("ABCDEFGHJKMNPQRT");
    expect(normalizeBoardCodeInput("o123 4567_89ab.cdef")).toBe("0123456789ABCDEF");
    const legacy = "Z".repeat(25) + "W";
    expect(normalizeBoardCodeInput(legacy)).toBe(legacy);
    expect(normalizeBoardCodeInput("Z".repeat(16))).toBe("Z".repeat(16));
    // Panjang salah atau karakter di luar Crockford ditolak (termasuk U).
    expect(normalizeBoardCodeInput("Z".repeat(15))).toBeNull();
    expect(normalizeBoardCodeInput("Z".repeat(26) + "Z")).toBeNull();
    expect(normalizeBoardCodeInput("U".repeat(16))).toBeNull();
    expect(normalizeBoardCodeInput("")).toBeNull();
    // Hash kode = SHA-256 heks kecil dari kode ternormalisasi, sama dengan
    // jalur server; halaman selalu menormalisasi lebih dulu.
    const canonical = normalizeBoardCodeInput("abcd-efgh-jkmn-pqrt");
    expect(canonical).toBe("ABCDEFGHJKMNPQRT");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical!));
    const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(await hashBoardCode(canonical!)).toBe(expected);
  });
});
