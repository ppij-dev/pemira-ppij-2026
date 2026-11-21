# Tasks: Seal the tally until Umumkan Hasil

Ordered, small, testable. Each group lands its tests before the next begins. Spec source of
truth: the deltas in `specs/` of this change. No migration; the schema is unchanged.

## 1. Backend seal in the results query layer (public-site)

- [x] 1.1 Failing tests first in `test/results-api.test.ts`: `/api/dashboard` before
      published returns `tally_sealed: true` with null Setuju / Tidak Setuju / Abstain
      cast, null `abstain_count`, null choice percentages, null `candidates[].votes` and
      null per-korda choice fields, in single candidate mode and in multi-candidate mode;
      participation figures (`eligible_count`, `used_count`, `unused_count`,
      `turnout_percentage`, `participation_count`, `ballot_count`, `count_matches`,
      `tidak_memilih_count`, per-korda eligible/used/turnout) keep their values.
- [x] 1.2 Failing tests for Diumumkan: after publication the same run returns the counts
      and percentages, overall and per korda, and `tally_sealed` is false.
- [x] 1.3 Implement the seal in `src/server/results/queries.ts`: `tally_sealed` on
      `ResultsPayload`, `CandidateTally.votes` nullable, one `sealed` transform that nulls
      every choice figure and the per-korda choice columns while the stage is not
      Diumumkan (design D1, D2, D4); run the group's tests green.
- [x] 1.4 Confirm the flow endpoints are untouched and still work while sealed:
      `POST /api/election/abstain-count` and `POST /api/election/publish` (tests in
      `test/election-lifecycle.test.ts`), and that `/api/results` still answers 409 before
      Diumumkan.

## 2. Dasbor sealed state (admin-dashboard)

- [x] 2.1 Failing source tests in `test/single-candidate-ui.test.ts` /
      `test/results-api.test.ts`: Dasbor renders the sealed line
      "Hasil disegel sampai Umumkan Hasil", a lock icon and the neutrality sentence from
      `tally_sealed`, for the single candidate panel, the multi-candidate panel and the
      korda column, and renders today's panels when `tally_sealed` is false.
- [x] 2.2 Implement the sealed panel and sealed korda cell in
      `src/pages/admin/dasbor.astro` (design D5), keeping stage, countdown, participation
      cards, count check, Uji Coba block and the Hitung Abstain warning untouched.
- [x] 2.3 Keep the audit entry unchanged: one `admin_tally_viewed` per load with the stage
      in the detail (audit-log delta), no new action.

## 3. Tests and verification

- [x] 3.1 Update the existing tests that asserted pre-publication counts
      (`test/results-api.test.ts` single candidate and korda groups, `test/vote-api.test.ts`
      dashboard tally assertion) so they publish first where they assert counts and assert
      the seal where they do not.
- [x] 3.2 `npm run check` (typecheck) and `npx vitest run test/results-api.test.ts
      test/single-candidate-ui.test.ts test/election-lifecycle.test.ts test/vote-api.test.ts`.
- [x] 3.3 Full `npx vitest run`.
- [x] 3.4 Local `wrangler dev` with a private port and local D1: bootstrap, single
      candidate mode, one real vote, and 390px screenshots of Dasbor while Dibuka (sealed)
      and after Umumkan (shown).
