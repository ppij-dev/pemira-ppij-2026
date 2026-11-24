# Spec Delta: Daftar Pemilih export

## Purpose

Admin Voting can already read participation per row on Daftar Pemilih, but only 50 rows
at a time and only on screen. The committee needs the filtered list as a file (printouts,
cross-checks with korda on voting day). The export must stay in lockstep with the page:
one query builder serves both, so what an admin sees is always what an admin downloads.

## ADDED Requirements

### Requirement: Unduh Excel exports every row matching the current filters

Daftar Pemilih SHALL have an "Unduh Excel" button beside the filters. It SHALL export
EVERY row matching the currently set filters (name search, komsat, status Sudah memilih /
Belum memilih / all) across all pages, not only the visible page, ordered exactly like
the page. The rows SHALL come from an Admin Voting–only GET endpoint
(`/api/admin/pemilih/export`) behind the existing Admin Voting guard.

#### Scenario: Export matches the filtered pages

- **WHEN** an Admin Voting applies a filter and presses Unduh Excel
- **THEN** the file contains every matching row of every page in the page's order, with
  one row per roll member

#### Scenario: Page and export cannot drift

- **WHEN** the page lists a filtered, paged slice of the roll
- **THEN** both the page and the endpoint build their query from the same shared
  function, differing only in the optional LIMIT/OFFSET

### Requirement: Live-roll export refreshes through the page's read path

In live-roll mode ("Tidak Membekukan DPT") the export endpoint SHALL refresh the portal
view through the same read path as the page, which never throws; a portal outage SHALL
NOT fail the export.

#### Scenario: Portal outage in live-roll mode

- **WHEN** the portal view cannot be refreshed while "Tidak Membekukan DPT" is on and an
  Admin Voting exports
- **THEN** the export still answers from the last known view and never fails because of
  the refresh

### Requirement: Workbook shape

The export SHALL build the `.xlsx` in the browser with the bundled `write-excel-file`.
Sheet **Pemilih** SHALL have the columns Nama, Nomor kartu, Kategori, Korda, Komsat,
Status (Sudah memilih / Belum memilih) and Waktu memilih (JST, empty when the member has
not voted; owner decision Q245). Sheet **Filter** SHALL state the applied filters in
words, the export time in JST and the row count. The file SHALL be named
`daftar-pemilih-<status-word-or-semua>-<YYYY-MM-DD>.xlsx` with the date in JST.

#### Scenario: Columns and sheets

- **WHEN** an Admin Voting downloads the export
- **THEN** the workbook has the Pemilih sheet with the seven columns in order and a
  Filter sheet naming the filters, the JST export time and the row count

#### Scenario: Not-voted members have an empty vote time

- **WHEN** a row in the export belongs to a member who has not voted
- **THEN** its Status reads "Belum memilih" and its Waktu memilih cell is empty

### Requirement: Shared busy and toast feedback

The button SHALL use the shared busy button (`window.withBusy`) while preparing the file
and the shared toast (`window.toast`): success SHALL read "N pemilih diunduh." with the
row count; failure SHALL show the server's error text.

#### Scenario: Successful export

- **WHEN** the workbook is downloaded for 120 rows
- **THEN** a success toast reads "120 pemilih diunduh."

#### Scenario: Failed export

- **WHEN** the endpoint answers an error
- **THEN** an error toast shows the server's error text and the button returns to rest

### Requirement: Kategori, Korda and Komsat labels match the page

The export SHALL resolve Kategori, Korda and Komsat to the same human-readable labels
the page shows (category labels, official portal unit names), so the file reads like the
table it came from.

#### Scenario: Labels resolve like the table

- **WHEN** a roll row's komsat path has an official unit name in the units table
- **THEN** the export shows that name, split into its Korda and Komsat columns, and the
  Kategori column uses the same labels as the page's badges
