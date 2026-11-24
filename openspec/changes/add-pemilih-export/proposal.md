# Proposal: Unduh Excel on Daftar Pemilih

## Why

Daftar Pemilih (`/admin/pemilih`) is where Admin Voting checks who has and has not
voted, but the committee cannot take the list with them: the table shows 50 rows per
page and there is no export. Admin Portal side workflows (printing attendance lists,
cross-checking with korda during voting day) need the same list as a file. The owner
asked for an **"Unduh Excel"** button on Daftar Pemilih that exports every row matching
the current filters — search, komsat, status — across all pages, with the file built in
the browser exactly like Undangan Pemilih and Rekapitulasi Suara already do
(owner decision Q245, 2026-11-24: the **Waktu memilih** column is included).

## What Changes

- **One shared query builder.** The Daftar Pemilih page query (WHERE on name search,
  komsat path and voted/not-voted status; ORDER BY name; LIMIT/OFFSET paging) moves into
  a single function used by both the page and the new export endpoint, so the page and
  the export cannot drift apart. In live-roll mode ("Tidak Membekukan DPT") both refresh
  the portal view through the same read path (`refreshPortalViewForRead`), which never
  throws.
- **New Admin Voting–only GET endpoint** `GET /api/admin/pemilih/export?q=&komsat=&status=`
  behind the existing `requireAdmin` guard. It returns JSON rows using exactly the same
  WHERE and ORDER as the page query with **no LIMIT/OFFSET** (so the export is not
  limited to one page), plus the row count. Each successful export appends one
  hash-chained audit entry **"Daftar Pemilih diunduh"** with only the filter and the row
  count in the detail — no names, no member numbers, no other member data.
- **"Unduh Excel" button next to the filters** on `/admin/pemilih`. It fetches the
  endpoint for the current filter form values, builds the `.xlsx` in the browser with the
  already-bundled `write-excel-file` (as Undangan Pemilih does), uses the shared busy
  button (`window.withBusy`) and toast (`window.toast`): success **"N pemilih diunduh."**,
  failure the server's error text.
- **Workbook contents.** Sheet **Pemilih** with columns Nama, Nomor kartu, Kategori,
  Korda, Komsat, Status (Sudah memilih / Belum memilih), Waktu memilih (JST, empty when
  the member has not voted — owner decision Q245). Sheet **Filter** with the applied
  filters in words, the export time (JST) and the row count. File name
  `daftar-pemilih-<status-word-or-semua>-<YYYY-MM-DD>.xlsx` with the date in JST.

## Impact

- Affected specs: `admin-dashboard`, `audit-log`.
- Affected code: `src/server/pemilih/daftar.ts` (new shared builder + unit-name helpers),
  `src/server/admin/routes.ts` (export endpoint), `src/pages/admin/pemilih.astro`
  (button + browser export + shared builder), tests (`test/pemilih-export.test.ts`).
- No migration, no new dependency, no change to voting, eligibility or secrecy: the
  export reads the same columns the page already shows to the same audience (Admin
  Voting), and participation times are already displayed per row on the page.
