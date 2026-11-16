# Tasks: Kembali ke Draf

Ordered, small, testable. Each numbered group lands its own tests before the next begins
(worker verification tier: build + focused tests of the changed code, 120s max per
command). Spec source of truth: the deltas in `specs/` of this change. No migration is
needed; no task touches the schema.

## 1. Backend: return-to-draft action, stage matrix, phrase, reset (election-lifecycle)

- [x] 1.1 Failing tests first in `test/election-lifecycle.test.ts`: preview Terjadwal →
      Draf succeeds; preview Dibuka → Draf succeeds; preview Ditutup (clock-closed and
      Tutup Sekarang) → Draf succeeds; real election Terjadwal (now < opens_at) → Draf
      succeeds; real election after opens_at refused; real Ditutup refused; Diumumkan
      refused in both modes; Draf refused; non-Admin session refused with nothing
      recorded.
- [x] 1.2 Failing tests for the phrase and the reset: wrong/empty phrase → HTTP 400 and
      the election row unchanged; case/whitespace variants accepted; on success
      `status_lock='draft'`, `frozen_hak_pilih`/`frozen_at` NULL, `closed_early_at`/
      `closing_snapshot_hash`/`closing_snapshot_at` NULL, schedule/`preview_mode`/
      `allow_admin_voting`/`single_candidate_mode`/`voters`/`pemilih_last_sync` kept;
      readiness recomputed for Draf (a re-Kunci succeeds again and the re-locked election
      reopens instead of sitting in Ditutup).
- [x] 1.3 Implement `returnToDraft` in `src/server/election/lifecycle.ts`: stage guard
      `status_lock='locked' AND (preview_mode=1 OR now < opens_at)`, server-side phrase
      re-check (case-insensitive, whitespace-collapsed), single D1 batch with the status
      guard, kept counts read for the audit detail; run the group's tests green.
- [x] 1.4 Add `POST /api/election/return-to-draft` in `src/server/election/routes.ts`
      behind the existing Admin Voting session guard, wiring the actor
      (member_id + name); focused test that the route passes the actor through and maps
      `ElectionError` to its HTTP status.

## 2. Backend: kept votes across the next Kunci (election-lifecycle, voting)

- [x] 2.1 Failing tests first in `test/election-lifecycle.test.ts`: after preview Dibuka
      → Draf with kept (is_test=0) votes, the next Kunci purges only new Uji Coba rows,
      freezes Hak pilih anew from the fresh roll, keeps the earlier participation rows
      and ballots, and the lock audit detail records the new frozen count.
- [x] 2.2 Failing tests in `test/vote-api.test.ts`: a member who voted in the earlier
      open cannot vote again after the return and re-Kunci (one-vote refusal, HTTP 409,
      nothing recorded); a member absent from the fresh roll keeps their ballot counted
      in the tally; a kept receipt hash still verifies through the board flow after the
      next close; nothing links kept ballots to members (schema-level check unchanged).
- [x] 2.3 Fix whatever the tests expose in the kept-vote paths (expected: none —
      `lockElection` already purges only `is_test=1` and results never join ballots to
      `voters`; if a join or purge turns up, remove it); run the group's tests green.

## 3. Backend: candidate protection while ballots reference them (candidate-management)

- [x] 3.1 Failing tests first in `test/candidates.test.ts`: deleting a candidate with
      kept ballots → 409 with the message naming the ballots; replacing the candidate's
      member (new member reference in update) → 409 with its message; renaming,
      re-nicknaming, editing description/intro and nomor urut under the existing mode
      rules still succeed; deleting a candidate without ballots still succeeds; with zero
      kept ballots nothing changes.
- [x] 3.2 Implement the guards in `src/server/election/candidates.ts` (`deleteCandidate`
      and the member-replacement path of `updateCandidate`, reading kept `is_test=0`
      ballots per candidate); run the group's tests green.

## 4. Backend: Mode kandidat tunggal frozen while kept ballots exist (election-lifecycle)

- [x] 4.1 Failing tests first in `test/election-lifecycle.test.ts`: with kept (is_test=0)
      ballots, turning the switch off → 409 and value unchanged; turning it on (after a
      draft state that had it off) → 409; `getSingleCandidateMode` reports
      `editable:false` with the reason; with only `is_test=1` Uji Coba rows the switch
      stays editable and a Uji Coba after the return still works and is purged at the
      next Kunci.
- [x] 4.2 Extend `setSingleCandidateMode` and `getSingleCandidateMode` in
      `src/server/election/lifecycle.ts` with the kept-ballots check (is_test=0 only);
      run the group's tests green.

## 5. Backend: audit entry (audit-log)

- [x] 5.1 Failing test first in the audit tests: an accepted "Kembali ke Draf" appends
      exactly one entry with action "Pemilihan dikembalikan ke Draf", the actor, the
      stage left (Terjadwal/Dibuka/Ditutup), preview flag and kept
      ballot/participation counts, chained onto the current tip hash; a refused attempt
      (wrong phrase, wrong stage) appends nothing and leaves the tip unchanged.
- [x] 5.2 Wire the audit insert into the return batch via the existing
      `buildAuditInsert` path; run the group's tests green.

## 6. UI: Pengaturan action and confirmation dialog (admin)

- [x] 6.1 `src/pages/admin/pemilihan.astro`: add the "Kembali ke Draf" action to
      Pengaturan, shown only while the stage matrix allows it (locked + preview, or
      locked + now < opens_at), hidden in Draf and Diumumkan, with the helper text and
      the kept-votes line when ballots are kept; refresh by navigation only, no polling,
      no emoji.
- [x] 6.2 Confirmation dialog: restates the consequence with the kept count, requires
      typing "KEMBALI KE DRAF" (client check mirrors the server: case-insensitive,
      whitespace-collapsed), posts to `/api/election/return-to-draft`, shows the success
      feedback with the kept count and maps server refusals to their messages; focused
      render/build check that the page compiles and the dialog wires the right route and
      phrase.
