# Proposal: Seal the tally until Umumkan Hasil

## Why

Today Admin Voting sees the "Sikap Suara" section on Dasbor with live Setuju / Tidak
Setuju / Abstain counts while voting runs, and in multi-candidate mode the per-candidate
counts. That means the committee can watch the running result before it closes and
announces the election, and any member of the committee who is also a member of the
audience knows the standings before the announcement. Owner decision (2026-11-21): the
choice counts are **sealed from everyone, Admin Voting included**, until results are
announced (`status_lock='published'`, stage Diumumkan). Participation data stays open, so
the committee can still see turnout, run Hitung Abstain and announce the result without
ever looking at how people voted.

## What Changes

- **One rule, one place.** Every choice count in the results payload is omitted (`null`)
  before Diumumkan: single candidate Setuju / Tidak Setuju / Abstain cast,
  `abstain_count` (which contains that cast figure), the per-candidate `votes` in
  multi-candidate mode, and the per-korda breakdowns of all of them, plus their
  percentages. The payload carries `tally_sealed: true` so a screen can tell "sealed"
  apart from "zero".
- **Server-side, not just the UI.** The seal lives in the results query layer
  (`src/server/results/queries.ts`), so `/api/dashboard`, the SSR landing page and any
  future consumer of the payload get nothing to leak. `/api/results` already answers 409
  before Diumumkan; after Diumumkan it returns the counts as today. There is no CSV,
  Excel or other export of choice counts in 1.0 (the only `.xlsx` in the app is the
  invitation list), so no export needs a change.
- **Still visible before Diumumkan:** stage, schedule and countdown, Hak pilih,
  Sudah digunakan, Belum digunakan, turnout, participation and ballot counts, the count
  check, the Uji Coba test-count block, the per-korda participation columns,
  `tidak_memilih_count` (Hak pilih minus participation — participation data, not a
  choice), `abstain_counted` / `abstain_counted_at`, and the receipt board's hash list
  and counts. Hitung Abstain keeps working because it only needs those participation
  figures.
- **Dasbor.** The "Sikap Suara" panel (single candidate) and the "Perolehan suara
  keseluruhan" panel (multi candidate) show a locked state instead of numbers: a lock
  icon, "Hasil disegel sampai Umumkan Hasil" and one short reason that keeps the
  committee neutral (the committee does not see the direction of votes while voting
  runs, so the count stays neutral and each Pemilih's choice stays secret). The per-korda
  table replaces its choice columns with the same sealed line. After Umumkan Hasil the
  section renders exactly as today.
- **Flow unchanged.** Tutup → Hitung Abstain → Umumkan Hasil needs no look at the counts;
  the Umumkan confirmation never showed counts and still does not. After Umumkan the
  numbers appear on Dasbor, on the Hasil page and on the landing page.
- **Audit.** The existing `admin_tally_viewed` entry stays on every Dasbor load. A sealed
  read is a normal tally load, not a blocked action, so no new audit action is added.
- **Draf included.** The seal is one rule for every stage before Diumumkan, so Uji Coba
  test ballots are sealed too; a rehearsal still proves the ballot, the receipt and the
  participation counters, and the choice counts become visible with announcement.

## Impact

- Affected specs: `admin-dashboard`, `public-site`, `election-lifecycle`, `audit-log`.
- Affected code: `src/server/results/queries.ts` (seal + payload flag),
  `src/pages/admin/dasbor.astro` (sealed panel and sealed korda column),
  `test/results-api.test.ts`, `test/single-candidate-ui.test.ts`,
  `test/vote-api.test.ts` where they asserted pre-publication counts.
- No migration, no schema change, no new endpoint, no polling.
- This supersedes the "in every stage, including while voting is open" wording of the
  tally requirements in `add-election-mvp` (admin-dashboard, public-site) and
  `add-single-candidate-mode` (admin-dashboard).
