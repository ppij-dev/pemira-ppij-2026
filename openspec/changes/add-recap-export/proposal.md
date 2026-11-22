# Proposal: Rekapitulasi Suara with an Excel export

## Why

After voting closes, Admin Voting today runs **Hitung Abstain** (which only stores the
non-voter count) and can then announce the result — but the committee never gets a
reconciliation sheet of what will be announced, and the choice counts stay sealed to the
committee until Diumumkan, so the committee cannot prepare the announcement, check that
the numbers add up, or audit who looked at the recap. Owner decisions Q232–Q234
(2026-11-22) replace the flow with: voting closes → **Rekapitulasi Suara** (one-time,
audited Admin Voting action) → Admin Voting downloads the Excel → **Umumkan Hasil**
(public). The recap absorbs what Hitung Abstain does today (it stores the non-voter
count as Abstain), lifts the tally seal **for Admin Voting only**, and a new Admin
Voting page shows the recap as tabs and builds the `.xlsx` in the browser. The public
site still sees nothing until Diumumkan, and every recap view and download is audited.

## What Changes

- **Migration `0019_election_recap.sql`.** New columns `elections.recap_at` (NULL =
  recap not done) and `recap_abstain_count` (the non-voter count stored as Abstain,
  >= 0), following the `abstain_counted_*` pattern. They are the single source of truth
  for "recap done" and for the stored Abstain figure.
- **Rekapitulasi Suara replaces Hitung Abstain.** One guarded D1 batch (UPDATE gate +
  hash-chained audit entry, exactly the Hitung Abstain pattern) stores the non-voter
  count (Hak pilih minus participation, via the existing Hak pilih resolver) in
  `recap_abstain_count` and stamps `recap_at`. Allowed once, only after close, only in
  single candidate mode. The separate Hitung Abstain button, dialog, endpoints
  (`GET/POST /api/election/abstain-count`) and `countAbstain`/`getAbstainCount`
  functions are removed; the recap state endpoint exposes the same pending count for
  the confirmation dialog. **Kembali ke Draf resets the recap columns** (as it reset the
  abstain ones, which are also cleared for pre-recap rows). Audit action: "Rekapitulasi
  Suara dijalankan" with only the count in the detail.
- **The tally seal lifts for Admin Voting at Rekapitulasi.** The seal in the results
  query layer now lifts once `recap_at` is set: Dasbor and `/api/dashboard` show the
  counts after recap even while the stage is Ditutup. The PUBLIC seal is unchanged:
  `/api/results` still answers 409 before Diumumkan, and the landing page and `/hasil`
  still read `getPublicResults`, which returns nothing until published. Multi-candidate
  elections never recap, so their seal behaves exactly as before.
- **Umumkan Hasil is refused until the recap is done** in single candidate mode, with a
  clear message (replaces the "Hitung Abstain first" gate and message).
- **New Admin Voting page "Rekapitulasi"** (`/admin/rekap`, navigation after Undangan,
  under Lainnya on phones), laid out as tabs by stage:
  - Before close: a note that recap opens after voting closes.
  - After close, before recap: the heading, a short explanation and the "Rekapitulasi
    Suara" button with a confirmation dialog stating the non-voter count that will
    become Abstain (one-way action).
  - After recap: the five tabs (Ringkasan, Korda, Komsat, Kotak suara, Abstain), an
    **Unduh Excel** button that builds the `.xlsx` in the browser with the same tabs as
    sheets (`write-excel-file`, as Undangan Pemilih does; the server returns JSON only),
    and a link to Umumkan Hasil in Pengaturan.
- **Sheets.**
  - **Ringkasan:** the election title, the schedule, the export time, Total DPT (the
    member roll with its source named: frozen at Kunci, frozen mid-vote, or the closing
    snapshot, via the existing resolver), invite links created / cancelled / used /
    unused, DPT final (roll + non-cancelled links), total votes used, and Setuju /
    Tidak Setuju / Abstain with percentages of DPT final.
  - **Korda:** ALL korda (including 0) with Hak pilih, Suara digunakan and Partisipasi
    % only — no choice counts per korda. Remainder rows (unused links, data outside any
    known korda) keep the totals adding up.
  - **Komsat:** ALL komsat with the same columns plus the korda name.
  - **Kotak suara:** one row per ballot with ONLY the receipt hash and the choice
    (Setuju / Tidak Setuju), ordered by receipt hash (already random). No komsat, no
    time, no member (owner decision Q229).
  - **Abstain:** members who did not vote with name, member number, korda and komsat
    (owner decision Q230); never-used invite links appear as rows "Tautan undangan
    <reference> (tidak dipakai)".
- **Audit.** Every recap-data load appends a hash-chained "Rekapitulasi dilihat" entry
  and every Excel download a "Rekapitulasi diunduh" entry, with no data in the detail —
  the same pattern as the existing tally-view entries.

## Impact

- Affected specs: `election-lifecycle`, `admin-dashboard`, `public-site`, `audit-log`.
- Affected code: `migrations/0019_election_recap.sql` (new), `src/server/election/lifecycle.ts`
  (recap state + action, publish gate, return-to-draft reset), `src/server/election/routes.ts`
  (recap endpoints replace abstain-count), `src/server/results/queries.ts` (seal lifts on
  `recap_at`, recap fields in the payload), `src/server/results/recap.ts` (new payload),
  `src/server/admin/routes.ts` (`/api/admin/recap` + download marker), `src/pages/admin/rekap.astro`
  (new), `src/layouts/AdminLayout.astro` (navigation), `src/pages/admin/dasbor.astro`
  (recap wording), `src/pages/admin/pemilihan.astro` (button removed), `src/pages/hasil.astro` and
  `src/pages/index.astro` (copy), `scripts/seed-rekap-demo.mjs` (new demo seed), tests.
- Supersedes the Hitung Abstain wording and gate of `add-single-candidate-mode`
  (owner decisions Q232–Q234, 2026-11-22) and the "sealed until Diumumkan for Admin
  Voting" scope of `seal-tally-until-published`: the seal now lifts for Admin Voting at
  Rekapitulasi, while the public seal until Diumumkan is unchanged.
