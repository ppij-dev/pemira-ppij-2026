# Spec Delta: Daftar Pemilih downloads are audited

## Purpose

Hard rule 7 records every Admin Voting action. Exporting the voter list exposes the
whole (filtered) roll to a file, so each download gets one hash-chained audit entry.
Unlike the page read, the entry records which filters were used and how many rows left
the site — but never any member data.

## ADDED Requirements

### Requirement: Each export appends one audit entry with filters only

Every successful `GET /api/admin/pemilih/export` SHALL append exactly one hash-chained
audit entry **"Daftar Pemilih diunduh"** with the acting Admin Voting as actor and
`{"filter":{"q":...,"komsat":...,"status":...},"jumlah":N}` as the only detail: the
filter words and the row count, and NO member data — no names, no member numbers, no
per-row komsat paths. Refused requests SHALL record nothing.

#### Scenario: Successful export

- **WHEN** an Admin Voting exports 120 rows with a name search and status filter
- **THEN** exactly one "Daftar Pemilih diunduh" entry is appended with the filter words
  and jumlah 120 in the detail, the chain still verifies, and no member name or member
  number appears anywhere in the entry

#### Scenario: Refused export

- **WHEN** a non-admin session requests the export endpoint
- **THEN** the request is refused with 403 and no export entry exists
