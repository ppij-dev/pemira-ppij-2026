# Tasks: Undangan Langsung (direct invite links)

Ordered, small, testable. Each numbered group lands its own tests before the next begins
(worker verification tier: build + focused tests of the changed code, 120s max per
command). Spec source of truth: the deltas in `specs/` of this change. Copy is Bahasa
Indonesia, no emoji; manual refresh only, no polling.

## 1. Schema: the `direct_invitations` table (direct-invitations)

- [ ] 1.1 Failing tests first in `test/schema.test.ts`: migration
      `0015_direct_invitations.sql` adds `direct_invitations`, keeps the Admin Voting
      `invitations` table untouched, enforces `reference` and `token_hash` uniqueness,
      accepts NULL `used_at`/`cancelled_at`/guest fields, and provides the status index.
- [ ] 1.2 Write `migrations/0015_direct_invitations.sql` exactly as in the design (table
      plus `idx_direct_invitations_status`) and wire it into the schema test's migration
      list; run the group's tests green.

## 2. Backend: code, generate, list and cancel (direct-invitations, election-lifecycle, audit-log)

- [ ] 2.1 Failing tests first in `test/direct-invitations.test.ts`: a generated code is 26
      Crockford characters, normalizes aliases/case/separators, hashes to the stored
      `token_hash`, and a 6-character `reference` is unique and non-secret; generation of
      N links creates N rows with Belum Dipakai, `created_by`/`created_by_name` and one
      audit entry carrying count and references only.
- [ ] 2.2 Failing tests for the window and the limits: generation allowed in Draf,
      Terjadwal and Dibuka; refused in Ditutup (clock and Tutup Sekarang) and Diumumkan;
      batch size 0/51 and the 500-per-election ceiling refused; non-admin refused with
      nothing written.
- [ ] 2.3 Failing tests for listing and cancel: the list derives Belum Dipakai / Sudah
      Dipakai / Dibatalkan from the row and never returns `token_hash`; cancelling an
      unused row sets Dibatalkan with actor columns and one audit entry; cancelling a used
      row, an already cancelled row, or anything after close is refused with nothing
      written.
- [ ] 2.4 Implement `src/server/direct/code.ts` (code generation via the receipt helpers,
      normalization, hash, reference) and `src/server/direct/create.ts` plus
      `cancel.ts`; add `GET/POST /api/admin/undangan` and `DELETE /api/admin/undangan/:id`
      to `src/server/admin/routes.ts` so they inherit `requireAdmin`; run the group's
      tests green.

## 3. Backend: effective Hak pilih, results, Dasbor and Hitung Abstain (voter-roll, admin-dashboard)

- [ ] 3.1 Failing tests first in `test/results-api.test.ts`: with a frozen roll of 100 and
      5 active links, `eligible_count` is 105; a used link keeps its one; a cancelled link
      removes it; during Draf the fallback roll gains the link term; the lock audit detail
      records frozen roll and active links separately.
- [ ] 3.2 Failing tests for the per-korda table: an invitee counts in the chosen komsat's
      korda (both participation and ballot); unused links count in no korda and the page
      states the difference; the 10-ballot suppression is unchanged; the count check treats
      unused links as non-voters, not as a mismatch.
- [ ] 3.3 Failing tests for Hitung Abstain: `pending_count` includes unused links; after
      running, the stored count matches; generation and cancellation are refused afterwards
      (group 2 guards) so the stored count cannot be invalidated.
- [ ] 3.4 Implement one `effectiveHakPilih` helper used by `src/server/results/queries.ts`
      and the lifecycle Hitung Abstain path, extend the per-korda aggregates through the
      invitation row's `komsat_path`, and add the active-link count to the payload;
      surface the numbers on `src/pages/admin/dasbor.astro` (and `hasil.astro` /
      `index.astro` where they already read the payload); run the group's tests green.

## 4. Backend: opening and claiming a link (direct-invitations, public-site)

- [ ] 4.1 Failing tests first in `test/direct-invitations.test.ts`: resolving a code by its
      hash returns the row and the stage view for Draf, Terjadwal, Dibuka, Ditutup and
      Diumumkan; a used, cancelled and unknown code each return their own outcome; the raw
      code is never returned by any read endpoint.
- [ ] 4.2 Failing tests for the claim: a valid claim stores guest Nama, Email and chosen
      komsat on the invitation row and sets a sealed 30-minute session; a second claimer
      inside the reservation window is refused and the reservation is not overwritten; the
      same claim id can resume; the reservation lapses by the clock.
- [ ] 4.3 Failing tests for rate limits: per-code open limit, global open ceiling, per-code
      claim limit and per-invitation vote limit each refuse with a rate-limit outcome, and
      no key contains a client IP.
- [ ] 4.4 Implement `src/server/direct/open.ts`, `claim.ts` and `routes.ts`, mount the
      public routes in `src/server/app.ts` before the auth routes, and reuse
      `encryptSecret`/`decryptSecret` for the sealed `undangan_session`; run the group's
      tests green.

## 5. Backend: the invite vote batch (voting-and-receipts, audit-log)

- [ ] 5.1 Failing tests first in `test/invite-vote.test.ts`: an invite vote writes one
      participation row with `undangan:<reference>`, one ballot with the chosen komsat
      path, one audit entry and a one-time receipt; the link becomes Sudah Dipakai; the
      confirmation text and single candidate mode rules match the Pemilih path; a wrong
      confirmation writes nothing.
- [ ] 5.2 Failing concurrency tests: two concurrent submissions of the same link produce
      exactly one vote, one ballot and one audit entry, and the loser gets a clear refusal;
      a replayed claim session is refused; an invite vote in a closed stage is refused; no
      query links a ballot to an invitation row.
- [ ] 5.3 Implement `src/server/direct/vote.ts` mirroring `castVote`'s guarded batch
      (participation insert from the invitation row, `used_at` update, ballot, audit) with
      the audit-tip retry, reusing `generateReceipt`, `isVoteChoice` and the choice rules;
      run the group's tests green.

## 6. UI: Undangan Pemilih page (direct-invitations)

- [ ] 6.1 Failing render tests first in `test/admin-pengaturan-ui.test.ts` (or a new
      `test/direct-invite-ui.test.ts`): the page offers the batch form with the 1–50 limit,
      renders the show-once result panel with per-row copy buttons and "Salin semua", and
      lists the table with exactly the columns Link | Dibuat Pada | Oleh | Status and the
      three status labels.
- [ ] 6.2 Failing tests for the states: the copy button appears only while the browser
      holds the code (sessionStorage), cancel is offered on Belum Dipakai rows only, used
      and cancelled rows show their refusal message, and the whole generation/cancel area
      is hidden or refused after close with the refusal message.
- [ ] 6.3 Implement `src/pages/admin/undangan.astro`, add the nav entry in
      `src/layouts/AdminLayout.astro` (label "Undangan"), wire the API calls and the
      show-once copy behaviour; no polling, no emoji; run the group's tests green.

## 7. UI: the public invitation pages (public-site, direct-invitations)

- [ ] 7.1 Failing render tests first: `/undangan/<kode>` shows the welcome, "Lihat profil
      kandidat", "Pilih" and, per stage, the schedule (before open, no ballot), the claim
      form (open) or the closed/announced message (after close); used, cancelled and
      unknown codes show their own pages.
- [ ] 7.2 Failing tests for the claim form: Nama, Email and a Korda/Komsat `<select>` built
      from `units` (korda/komsat inside scope, Portal names, no free text); the form cannot
      submit while the unit list is empty; a refused or reserved claim shows its message.
- [ ] 7.3 Implement `src/pages/undangan/[kode].astro` and
      `src/pages/undangan/[kode]/surat-suara.astro`, reusing the existing ballot,
      confirmation sheet and receipt presentation; verify the invitee sees the same
      single-candidate-mode ballot; run the group's tests green.

## 8. Wrap-up: labels, docs and strict validation

- [ ] 8.1 Failing test first in `test/audit-api.test.ts`: the audit view renders
      `undangan:<reference>` targets as a readable invitation label; then extend
      `src/server/audit/labels.ts`; run the tests green.
- [ ] 8.2 Run the focused suites of every group plus `npm run check`, then
      `openspec validate add-direct-invite --strict` and fix whatever it reports.
- [ ] 8.3 Confirm the design's stated consequences still hold in the built pages: unused
      links are shown as non-voters, the per-korda page states that unused links are
      counted nationally only, and no surface shows a link code after the show-once panel.
