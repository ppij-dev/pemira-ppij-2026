# Design: Unduh Excel on Daftar Pemilih

## Context

`/admin/pemilih` renders one server-side query with three filters (name search `q`,
komsat path, voted/not-voted status) and fixed 50-row paging, ordered by name. In
"Tidak Membekukan DPT" mode the page refreshes the portal view before reading through
`refreshPortalViewForRead` (short wait, stale-while-unavailable, never throws).
Undangan Pemilih and Rekapitulasi Suara already build `.xlsx` files in the browser with
the bundled `write-excel-file`; the server returns JSON only and a marker endpoint
appends the audit entry.

Owner decision Q245 (2026-11-24) fixes the shape: button next to the filters; every
matching row across all pages; server endpoint behind `requireAdmin` returning JSON with
the page's exact WHERE/ORDER without LIMIT/OFFSET; sheets Pemilih (with Waktu memilih in
JST, empty when not voted) and Filter; file name
`daftar-pemilih-<status-word-or-semua>-<YYYY-MM-DD>.xlsx`; audit entry "Daftar Pemilih
diunduh" with `{filter:{q,komsat,status}, jumlah:N}` and no member data.

## Goals

- The page query and the export query cannot drift: one function builds the statement
  for both, paging is an optional argument.
- The endpoint reads and refreshes exactly like the page in live-roll mode.
- No new dependency, no migration, no change to the voter-facing flow.

## Decisions

1. **One builder, paging optional** (`src/server/pemilih/daftar.ts`).
   `daftarPemilihStatement(db, filter, paging?)` returns the prepared statement with the
   existing SQL verbatim (same WHERE expressions, `ORDER BY v.name`); with `paging` it
   appends `LIMIT ? OFFSET ?`, without it the endpoint gets every matching row. The page
   passes `{ limit: 50, offset: (page-1)*50 }`; the export endpoint omits paging. Unit
   names come from one `loadUnitNames(db)` helper used by page and endpoint, and
   `kordaKomsatLabels(path, names)` splits a roll path into the Korda and Komsat export
   columns (korda = unit directly under the national root; komsat = the deepest unit on
   the path; empty when the row sits on the korda itself).

2. **Export endpoint returns display-ready rows.** `GET /api/admin/pemilih/export`
   answers `{ jumlah, rows: [{ name, member_number, kategori, korda, komsat, voted,
   voted_at }] }`. The Kategori label is resolved server-side with the same three labels
   the page's badges show (Anggota Biasa / Anggota Luar Biasa / Belum ditentukan /
   Tidak berhak memilih), so the browser cannot diverge from the page. `voted_at` stays
   raw ISO; the browser formats it in JST exactly like the page does, and sends an empty
   cell when the member has not voted.

3. **Live-roll refresh through the page's path.** The endpoint reads
   `elections.live_voter_roll` and, when on, calls `refreshPortalViewForRead(db,
   serviceApiConfig(env), new Date())` — the same helper with the same TTL/cooldown/
   stale-while-unavailable semantics as the page, which never throws, so a portal outage
   can never turn into a 500.

4. **Audit: one entry per export, filters only.** The entry carries
   `detail_json = {"filter":{"q":...,"komsat":...,"status":...},"jumlah":N}`. The filter
   words are what the admin typed into the search box, not member data; no name, member
   number or komsat per row is recorded. Refused requests (non-admin) record nothing.

5. **Browser export reads the filter form.** The button sits in the filter form and
   sends the form's current values (they equal the URL filters until the admin edits
   them, so "current filters" always matches what the admin sees in the form). The busy
   state uses the shared `window.withBusy`; toasts use `window.toast` with the shared
   success/failure copy. Status word in the file name: `sudah-memilih`, `belum-memilih`
   or `semua`; the date is today in JST.

## Risks

- Large rolls (thousands of rows) make one big JSON response and one in-browser file;
  the audience is the election committee and the roll is a single chapter's member list,
  so this is acceptable for 1.0 and mirrors how Undangan exports already work.
- The Korda/Komsat split relies on the roll path shape (`/ppij/<korda>[/<komsat>]`);
  rows outside that shape degrade to title-cased path parts, never to an error.
