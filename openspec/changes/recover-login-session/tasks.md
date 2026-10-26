# Tasks

## 1. Implementation

- [x] 1.1 Stage marker: sealed `ppij_auth_stage` cookie (10 menit) dengan kategori terbatas dan tujuan aman
- [x] 1.2 Classify callback failures (dibatalkan/state/kode/verifikasi) dan success (`ok`) di rute auth; unreachable browser path
- [x] 1.3 One recovery card on `/akun` ("Masuk belum selesai" / "Sesi masuk belum aktif" / "Masuk dibatalkan") with single retry, help code, secondary help; remove the duplicate banner and decline-era copy
- [x] 1.4 Preserve safe return destination on retry; never auto-retry; stale marker with valid session renders the normal page
- [x] 1.5 Vitest per boundary in `test/auth-session.test.ts` (23 tests in file, all green); `astro check` clean
