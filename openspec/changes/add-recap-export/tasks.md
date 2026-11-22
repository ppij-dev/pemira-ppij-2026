# Tasks: Rekapitulasi Suara with an Excel export

Ordered, small, testable. Spec source of truth: the deltas in `specs/`. The next free
migration number is 0019.

## 1. Spec and schema

- [x] 1.1 Proposal, design and spec deltas for `election-lifecycle`, `admin-dashboard`,
      `public-site`, `audit-log`; `openspec validate add-recap-export --type change --strict` passes.
- [x] 1.2 Migration `0019_election_recap.sql`: `elections.recap_at TEXT` and
      `elections.recap_abstain_count INTEGER CHECK (>= 0)`, following the
      `abstain_counted_*` pattern of 0014.

## 2. Server: recap action, publish gate, seal lift

- [x] 2.1 Failing tests in `test/election-lifecycle.test.ts` (replacing the Hitung
      Abstain group): recap refused before close / outside the mode / twice; one
      guarded batch stores the count and `recap_at` with one audit entry naming only
      the count; concurrent runs produce one winner; Umumkan refused before recap with
      the new message and allowed after; multi-candidate unaffected; Kembali ke Draf
      clears the recap columns (and the legacy abstain columns).
- [x] 2.2 Implement `getRecapState` / `runRecap` in `src/server/election/lifecycle.ts`
      (removing `getAbstainCount` / `countAbstain`), the recap gate and message in
      `publishResults`, the recap reset in `returnToDraft`, and the recap routes
      (`GET`/`POST /api/election/recap`) replacing the abstain-count routes.
- [x] 2.3 Failing tests in `test/results-api.test.ts`: `/api/dashboard` unsealed after
      recap while Ditutup, still sealed for multi-candidate; `/api/results` still 409
      after recap; payload gains `recap_done` / `recap_at`.
- [x] 2.4 Implement the seal lift (`stage !== "published" && recap_at === null`) and
      the recap fields in `src/server/results/queries.ts`, feeding
      `abstain_counted` / `abstain_counted_at` from the recap columns.

## 3. Server: recap payload and audit

- [x] 3.1 Failing tests in `test/recap-export.test.ts`: an independent reference
      calculator over the raw tables, compared against every tab across the seeded
      scenarios (frozen roll; live roll frozen mid-vote; live roll never frozen;
      unused/used/cancelled links; a korda with 0 voters; a komsat under 10 ballots;
      0 votes; everyone voted) and the invariants (Setuju + Tidak Setuju + Abstain =
      DPT final; ballot count = participation = Total suara digunakan; per-korda sums
      with remainder rows; Abstain rows = Abstain count).
- [x] 3.2 Implement `src/server/results/recap.ts` (state + five data blocks, set-based
      SQL, remainder rows, hash-ordered Kotak suara, Abstain list with unused-link
      rows) and the guarded admin endpoints `GET /api/admin/recap` (audit
      "Rekapitulasi dilihat" when data is served) and `POST /api/admin/recap/download`
      (audit "Rekapitulasi diunduh").

## 4. UI: Rekapitulasi page, navigation, Dasbor and Pengaturan wording

- [x] 4.1 Failing source tests for the new page: navigation entry, three stage states,
      confirmation dialog with the pending count, five tabs, bundled write-excel-file
      export, no CDN, link to Umumkan Hasil.
- [x] 4.2 Implement `src/pages/admin/rekap.astro` (three states, dialog, tabs,
      browser-side .xlsx with the five sheets) and the navigation entry in
      `src/layouts/AdminLayout.astro`.
- [x] 4.3 Update `src/pages/admin/dasbor.astro` (recap wording, warning links to the
      recap page), remove the Hitung Abstain card/dialog from
      `src/pages/admin/pemilihan.astro` (Umumkan Hasil card explains the recap gate),
      and refresh the Abstain copy on `/hasil` and the landing page.

## 5. Demo seed and verification

- [x] 5.1 `scripts/seed-rekap-demo.mjs`: deterministic closed/not-recapped demo
      election (~400 members, several korda/komsat, one empty korda, ~60% turnout,
      Setuju/Tidak Setuju mix, 10 links: 6 used / 2 unused / 2 cancelled), printing the
      expected numbers, refusing the production database name.
- [x] 5.2 `npm run check` (typecheck) and the touched test files.
- [x] 5.3 Full `npx vitest run`.
- [x] 5.4 Local `wrangler dev` with local D1 on a free port: seed the demo, walk the
      three page states, run the recap, download the .xlsx (list its sheets and row
      counts), screenshots at 1650x962 and 390 px under `~/.local/share/ghostex/i/`.
