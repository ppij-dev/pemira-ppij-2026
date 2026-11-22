# Design: Revamp Papan Bukti

## D1. Satu sumber data, dua halaman

`getPublicBoard` tetap satu-satunya pembaca papan. `/papan-bukti` merender kartu
statistik langsung dari server (frontmatter Astro memanggil `getPublicBoard`, gerbang
tahap yang sama dengan API: Ditutup atau Diumumkan). `/papan-bukti/daftar` memuat
`GET /api/votes/board` di peramban dan memotong daftar hashnya secara lokal. Tidak ada
endpoint baru; tidak ada data baru yang terbuka.

## D2. Pemeriksaan kode tetap sepenuhnya lokal

Kode dinormalisasi di peramban (`normalizeBoardCodeInput`, alias Crockford sama dengan
server), di-hash dengan WebCrypto (`hashBoardCode`), lalu dicocokkan terhadap daftar hash
yang sudah dimuat (`findHashIndex`). Kode mentah tidak pernah dikirim; pemeriksaan tidak
memakai `/api/votes/receipt-check` (jalur itu tetap untuk Bukti Suara). Daftar hash untuk
pemeriksaan dimuat lazy saat pemeriksaan pertama, bukan saat halaman dibuka.

## D3. Paginasi dan pencarian murni dan teruji

Logika yang dapat diuji (ukuran halaman 100, saring awalan heks tanpa peduli huruf,
jepit nomor halaman, potong baris) hidup di `src/lib/receiptBoard.ts` dan diimpor skrip
halaman daftar yang dibundel Astro (`<script>` terproses, pola `admin/rekap.astro` dan
`admin/audit.astro`). Halaman hanya mengikat keadaan: kueri, halaman, render.

## D4. Segel dan pesan

Kedua halaman tidak pernah menghitung pilihan; regex penguji melarang kata angka
pilihan dan endpoint hasil. Tautan `/hasil` hanya ada di dalam cabang `{published && …}`
dan hanya berupa tautan. Papan memakai komponen lokal (`StatCard`, `PanelCard`,
`Callout`, `Badge`, `Button`) dan utilitas semantik dari `src/styles/global.css`; hash
dan kode memakai `font-mono` dengan `break-all` agar utuh di 320–390 px.

## D5. Kompatibilitas API

Medan baru murni tambahan (`hak_pilih`, `hak_pilih_source`, `turnout_percentage`,
`closed_at`); konsumen lama tidak berubah. Hak pilih lewat `resolveHakPilih` sehingga
pembaca papan ikut menetapkan snapshot penutupan bila belum ada — perilaku sama dengan
sebelumnya (`ensureClosingHakPilih` sudah dipanggil di pembacaan papan).
