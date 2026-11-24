# Tasks: Unduh Excel on Daftar Pemilih

Ordered, small, testable. Spec source of truth: the deltas in `specs/`.

## 1. Server: shared query builder

- [x] 1.1 Failing tests first in `test/pemilih-export.test.ts`: the shared
      `daftarPemilihStatement` with paging concatenates to the same rows as without
      paging (same order), for several filter combinations (empty, name search, komsat,
      voted, not-voted, combined).
- [x] 1.2 Implement `src/server/pemilih/daftar.ts`: `daftarPemilihStatement(db, filter,
      paging?)` (existing page SQL verbatim, LIMIT/OFFSET only when paging is given),
      `loadUnitNames(db)` and `kordaKomsatLabels(path, names)`.

## 2. Server: export endpoint and audit

- [x] 2.1 Failing tests: non-admin session gets 403 with no rows and no audit entry; a
      successful export answers every matching row with the page's order, resolves
      Kategori/Korda/Komsat labels, appends exactly one "Daftar Pemilih diunduh" entry
      whose detail is only `{filter:{q,komsat,status}, jumlah}` (no member data), and
      the chain still verifies; in live-roll mode with an unreachable portal the export
      still answers 200 from the last view.
- [x] 2.2 Implement `GET /api/admin/pemilih/export` in `src/server/admin/routes.ts`
      behind the existing guard: live-roll refresh via `refreshPortalViewForRead`, rows
      via the shared builder without paging, one audit entry, JSON response.

## 3. UI: button and browser workbook

- [x] 3.1 Failing page-source assertions: the page uses the shared builder (no inline
      LIMIT/OFFSET SQL) and `loadUnitNames`, and carries the wired "Unduh Excel" button
      (id, endpoint fetch, `write-excel-file`, `window.withBusy`, `window.toast`,
      Pemilih + Filter sheets, JST times, file name pattern, success toast "N pemilih
      diunduh.").
- [x] 3.2 Implement the button beside Cari and the bundled export script in
      `src/pages/admin/pemilih.astro`; run the group's tests green.

## 4. Verification

- [x] 4.1 `npm run check` (astro check + tsc) green; full `npx vitest run` green.
- [x] 4.2 Local `wrangler dev` on a private port with a local D1 of 260 voters (pages
      1–3 exist): apply a filter, press Unduh Excel, open the downloaded workbook and
      check its row count against the filtered total; screenshot at 1650×962.
