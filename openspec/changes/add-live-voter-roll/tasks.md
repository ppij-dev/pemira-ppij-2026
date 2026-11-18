# Tasks: Tidak Membekukan DPT (live voter roll) and a live public turnout stat

Ordered, small, testable. Each numbered group lands its own tests before the next begins
(worker verification tier: build + focused tests of the changed code, 120s max per
command). Spec source of truth: the deltas in `specs/` of this change.

## 1. Migrations

- [x] 1.1 Write `migrations/0015_live_voter_roll.sql`: `ALTER TABLE elections ADD COLUMN
      live_voter_roll INTEGER NOT NULL DEFAULT 0 CHECK (live_voter_roll IN (0, 1))` with an
      Indonesian comment naming the Draf-only switch and the freeze at Kunci & Jadwalkan
      (mirrors `0011_single_candidate_mode.sql`).
- [x] 1.2 Write `migrations/0016_closing_hak_pilih.sql`: `ALTER TABLE elections ADD COLUMN
      closing_hak_pilih INTEGER` and `closing_hak_pilih_at TEXT` with a comment explaining
      NULL until the first close-time finalization in live mode and never written while the
      switch is off.
- [x] 1.3 Extend `test/schema.test.ts`: both migrations apply to a fresh D1, the switch
      default is off, an out-of-range switch insert fails the CHECK, and the closing
      columns accept NULL and a number+time pair.

## 2. Server: Pengaturan switch and no-freeze locking (election-lifecycle)

- [x] 2.1 Failing tests first in `test/election-lifecycle.test.ts`: toggle allowed in Draf
      (on and off again), refused after Kunci, one audit entry per accepted toggle with the
      "Tidak Membekukan DPT diaktifkan/dinonaktifkan" actions; lock in live mode succeeds
      with `frozen_at`/`frozen_hak_pilih` NULL, still runs the final full sync (stubbed
      failure blocks locking), records `live_voter_roll` and `portal_view_count` in the
      lock detail; lock with the switch off unchanged; readiness unchanged.
- [x] 2.2 Implement the toggle in `src/server/election/lifecycle.ts` + admin route and the
      switch-aware lock path (skip the freeze columns, keep every other lock side effect,
      add the detail fields); run the group's tests green.

## 3. Server: live portal view refresh (serviceapi)

- [x] 3.1 Failing tests first in `test/serviceapi-sync.test.ts`: incremental refresh applies
      the ACTIVE + `can_vote = 1` rule both ways
      (eligible newcomer upserted, ineligible member removed), advances the watermark to
      the portal `as_of`, and writes no audit entry when the silent option is set; manual
      sync paths keep their audit entry.
- [x] 3.2 Implement `ensurePortalViewFresh` with the 30 s TTL, the 15 s failure cooldown
      and stale-while-unavailable semantics (returns a typed stale/fresh outcome) in
      `src/server/serviceapi/sync.ts`, reusing `syncPemilih`'s incremental path with the
      silent option; run the group's tests green.

## 4. Server: live eligibility at vote time (voting)

- [x] 4.1 Failing tests first in `test/vote-api.test.ts`: in live mode with the stage
      Dibuka, a member on the refreshed view (including one never on any frozen roll) can
      vote once with unchanged secrecy/receipt/confirmation; a member removed or marked
      `can_vote = 0`/non-ACTIVE by the refresh is refused with the existing messages; a
      member absent from the view is refused `not_in_roll`; scope, Admin Voting setting,
      rate limits and one-vote-per-member unchanged; portal-down path serves the last view
      (eligible member accepted, absent member refused) without refreshing more often than
      the cooldown; `frozen_at IS NULL` no longer refuses in live mode; with the switch off
      or preview mode on, every behavior is byte-for-byte today's (preview auto-register
      included).
- [x] 4.2 Wire `ensurePortalViewFresh` + the live lookup into `authorizeVoter` in
      `src/server/voting/vote.ts` (live check only when `live_voter_roll = 1 AND
      preview_mode = 0`); run the group's tests green.

## 5. Server: closing Hak pilih snapshot (board + lifecycle)

- [x] 5.1 Failing tests first in `test/receipt-board.test.ts` and
      `test/election-lifecycle.test.ts`: first read after the deadline (board, results,
      abstain state, turnout) saves `closing_hak_pilih` + time and writes one "Hak pilih
      akhir disimpan" system audit entry with `{"hak_pilih": N}`; concurrent double
      finalization writes exactly one snapshot and one entry; Tutup Sekarang saves the
      snapshot inside the close batch; later reads return the saved value; switch-off
      elections never write the columns; Kembali ke Draf clears both columns and keeps the
      switch value.
- [x] 5.2 Implement `ensureClosingHakPilih` in `src/server/voting/board.ts` beside
      `ensureClosingSnapshot` (guarded UPDATE + tip-guarded audit insert, live mode only),
      hook it into `closeEarly`'s batch and the read paths; run the group's tests green.

## 6. Server: Hak pilih resolution and Hitung Abstain (results + lifecycle)

- [x] 6.1 Failing tests first in `test/results-api.test.ts`: payload gains
      `live_voter_roll`; in live mode while Dibuka, `eligible_count` and shares come from
      the live count; after close they come from `closing_hak_pilih`; with the switch off
      the payload equals today's shape; Hitung Abstain state and run use the saved number
      after close (pending = saved − participation); Umumkan in live single-candidate mode
      keeps its gate and uses saved shares.
- [x] 6.2 Implement the denominator resolution in `src/server/results/queries.ts` and the
      saved-number pending count in `getAbstainCount`; run the group's tests green.

## 7. Server: public turnout endpoint (results)

- [x] 7.1 Failing tests first in a new `test/turnout-api.test.ts`: visible data from
      Terjadwal (Jumlah Pemilih from the synced view, Suara Masuk 0), Dibuka, Ditutup and
      Diumumkan (counts only: stage, eligible, votes, time), no candidate/choice/korda
      fields in both switch states, rate limit per IP, refusal in Draf.
- [x] 7.2 Implement `GET /api/turnout` in `src/server/results/routes.ts` +
      `src/server/results/queries.ts` with the `rate_limits` guard; run the group's tests
      green.

## 8. UI: Pengaturan switch and admin notes

- [x] 8.1 `src/pages/admin/pemilihan.astro`: add the "Tidak Membekukan DPT" switch beside
      the single-candidate switch (Draf-only, read-only afterwards, helper text from
      design D9, posting to the toggle route with refresh-by-navigation only, no emoji).
- [x] 8.2 `src/pages/admin/dasbor.astro`: live-mode note, the stale-view warning banner
      after 5 minutes without a successful refresh (design D6), and saved-number figures
      after close; `src/pages/admin/pemilih.astro`: last portal refresh time in JST.
- [x] 8.3 Focused check: build passes and both pages render the switch state, the note
      and the banner from the elections row and watermark in Draf, Terjadwal, Dibuka and
      Ditutup.

## 9. UI: landing turnout strip

- [x] 9.1 `src/pages/index.astro`: render the strip above the schedule panel for stages
      Terjadwal/Dibuka/Ditutup/Diumumkan with labels "Jumlah Pemilih" and "Suara Masuk",
      server-
      rendered initial numbers, and the polling script (15 s open / 60 s otherwise,
      `visibilitychange` pause, jitter) with the number-flip animation on change; hidden
      in Draf.
- [x] 9.2 Focused check: build passes and the strip renders the right figures in each
      stage and both switch states; manual smoke of the flip animation against the local
      dev server.

## 10. Verification

- [x] 10.1 Full focused suite for the touched test files green (schema, lifecycle,
      serviceapi, vote-api, results-api, receipt-board, turnout-api) and `npm run build`
      green.
- [x] 10.2 `openspec validate add-live-voter-roll --strict` green.
