# Tasks: Undangan Langsung (direct invite links)

Ordered, small, testable. Each numbered group lands its own tests before the next begins
(worker verification tier: build + focused tests of the changed code, 120s max per
command). Spec source of truth: the deltas in `specs/` of this change. Copy is Bahasa
Indonesia, no emoji; manual refresh only, no polling. Migrations start at `0017` because
`add-live-voter-roll` owns `0015` and `0016`.

## 1. Schema: the `direct_invitations` table (direct-invitations)

- [x] 1.1 Failing tests first in `test/schema.test.ts`: migration
      `0017_direct_invitations.sql` adds `direct_invitations`, keeps the Admin Voting
      `invitations` table untouched, enforces `reference`, `token_hash` and non-null
      `token_enc` uniqueness, accepts NULL `used_at`/`cancelled_at`/guest fields, and
      provides the status index.
- [x] 1.2 Write `migrations/0017_direct_invitations.sql` exactly as in the design (table
      plus `idx_direct_invitations_status`) and wire it into the schema test's migration
      list; run the group's tests green.

## 2. Backend: code, seal, generate, list and cancel (direct-invitations, election-lifecycle, audit-log)

- [x] 2.1 Failing tests first in `test/direct-invitations.test.ts`: a generated code is 26
      Crockford characters, normalizes aliases/case/separators, hashes to the stored
      `token_hash`, decrypts from `token_enc` back to the same code, and a 6-character
      `reference` is unique and non-secret; generation of N links creates N rows with
      Belum Dipakai, `created_by`/`created_by_name` and one audit entry carrying count and
      references only.
- [x] 2.2 Failing tests for the window and the limits: generation allowed in Draf,
      Terjadwal and Dibuka; refused in Ditutup (clock and Tutup Sekarang) and Diumumkan;
      batch size 0/51 and the 500-per-election ceiling refused; non-admin refused with
      nothing written.
- [x] 2.3 Failing tests for listing, retrieval and cancel: the list derives Belum Dipakai /
      Sudah Dipakai / Dibatalkan from the row, returns the decrypted full link for every
      active row and `null` for used and cancelled rows, never returns `token_hash` or
      `token_enc`, and appends exactly one `Daftar undangan dilihat` entry per view with
      stage and count only; cancelling an unused row sets Dibatalkan with actor columns
      and one audit entry; cancelling a used row, an already cancelled row, or anything
      after close is refused with nothing written.
- [x] 2.4 Implement `src/server/direct/code.ts` (code generation via the receipt helpers,
      normalization, hash, seal with `encryptSecret`, reference) and
      `src/server/direct/create.ts` plus `cancel.ts`; add `GET/POST /api/admin/undangan`
      and `DELETE /api/admin/undangan/:id` to `src/server/admin/routes.ts` so they inherit
      `requireAdmin`; run the group's tests green.

## 3. Backend: the single Hak pilih helper, results, Dasbor and Hitung Abstain (voter-roll, admin-dashboard)

- [x] 3.1 Failing tests first in `test/results-api.test.ts`: with a frozen roll of 100 and
      5 active links, `eligible_count` is 105; a used link keeps its one; a cancelled link
      removes it; during Draf the fallback roll gains the link term; the lock audit detail
      records frozen roll and active links separately.
- [x] 3.2 Failing tests for the per-korda table: an invitee counts in the chosen komsat's
      korda (both participation and ballot); unused links count in no korda and the page
      states the difference; the 10-ballot suppression is unchanged; the count check treats
      unused links as non-voters, not as a mismatch.
- [x] 3.3 Failing tests for Hitung Abstain: `pending_count` includes unused links; after
      running, the stored count matches; generation and cancellation are refused afterwards
      (group 2 guards) so the stored count cannot be invalidated.
- [x] 3.4 Implement the invite term inside `src/server/election/hakPilih.ts` (the live-roll
      helper: `DIRECT_INVITE_HAK_PILIH_SQL`, `directInviteTerm`, `withDirectInvites`, and
      the term added in `liveHakPilih`) plus the frozen branch of `resolveHakPilih` in
      `src/server/voting/board.ts`; keep `results/queries.ts` reading `resolveHakPilih`,
      extend the per-korda aggregates through the invitation row's `komsat_path`, add the
      active-link count to the payload, and surface the numbers on
      `src/pages/admin/dasbor.astro` (and `hasil.astro` / `index.astro` where they already
      read the payload); run the group's
      tests green.

## 4. Backend: opening and claiming a link (direct-invitations, public-site)

- [x] 4.1 Failing tests first in `test/direct-invitations.test.ts`: resolving a code by its
      hash returns the row and the stage view for Draf, Terjadwal, Dibuka, Ditutup and
      Diumumkan; a used, cancelled and unknown code each return their own outcome; a public
      read never returns the token or the link.
- [x] 4.2 Failing tests for the claim: a valid claim stores guest Nama, Email and chosen
      komsat on the invitation row and sets a sealed 30-minute session; a second claimer
      inside the reservation window is refused and the reservation is not overwritten; the
      same claim id can resume; the reservation lapses by the clock.
- [x] 4.3 Failing tests for rate limits: per-code open limit, global open ceiling, per-code
      claim limit and per-invitation vote limit each refuse with a rate-limit outcome, and
      no key contains a client IP.
- [x] 4.4 Implement `src/server/direct/open.ts`, `claim.ts` and `routes.ts`, mount the
      public routes in `src/server/app.ts` before the auth routes, and reuse
      `encryptSecret`/`decryptSecret` for the sealed `undangan_session`; run the group's
      tests green.

## 5. Backend: the invite vote batch (voting-and-receipts, audit-log)

- [x] 5.1 Failing tests first in `test/invite-vote.test.ts`: an invite vote writes one
      participation row with `undangan:<reference>`, one ballot with the chosen komsat
      path, one audit entry and a one-time receipt; the link becomes Sudah Dipakai; the
      confirmation text and single candidate mode rules match the Pemilih path; a wrong
      confirmation writes nothing.
- [x] 5.2 Failing concurrency tests: two concurrent submissions of the same link produce
      exactly one vote, one ballot and one audit entry, and the loser gets a clear refusal;
      a replayed claim session is refused; an invite vote in a closed stage is refused; no
      query links a ballot to an invitation row.
- [x] 5.3 Implement `src/server/direct/vote.ts` mirroring `castVote`'s guarded batch
      (participation insert from the invitation row, `used_at` update, ballot, audit) with
      the audit-tip retry, reusing `generateReceipt`, `isVoteChoice` and the choice rules;
      run the group's tests green.

## 6. UI: Undangan Pemilih page, filter and Excel export (direct-invitations)

- [x] 6.1 Add the browser Excel dependency (`write-excel-file`, D13) to `package.json` and
      `package-lock.json`; run a focused check that the page script imports it without a
      CDN or a build-time global.
- [x] 6.2 Failing render tests first in a new `test/direct-invite-ui.test.ts`: the page
      offers the batch form with the 1–50 limit and renders the table with exactly the
      columns Link | Dibuat Pada | Oleh | Status and the three status labels; every active
      row has a copy button and used/cancelled rows have none.
- [x] 6.3 Failing tests for the filter and export: a status select and a reference search
      drive a client-side filter; "Unduh Excel" builds an `.xlsx` from the filtered rows
      with the Link, Referensi, Dibuat Pada, Oleh, Status, Dipakai Pada, Nama, Email and
      Korda/Komsat columns, with blank links for used and cancelled rows, and makes no
      server request; the generation and cancel area is hidden or refused after close with
      the refusal message.
- [x] 6.4 Implement `src/pages/admin/undangan.astro` (list load, copy, filter, search,
      export, cancel, generate), add the nav entry in `src/layouts/AdminLayout.astro`
      (label "Undangan"), wire the API calls; no polling, no emoji; run the group's tests
      green.

## 7. UI: the public invitation pages (public-site, direct-invitations)

- [x] 7.1 Failing render tests first: `/undangan/<kode>` shows the welcome, "Lihat profil
      kandidat", "Pilih" and, per stage, the schedule (before open, no ballot), the claim
      form (open) or the closed/announced message (after close); used, cancelled and
      unknown codes show their own pages.
- [x] 7.2 Failing tests for the claim form: Nama, Email and a Korda/Komsat `<select>` built
      from `units` (korda/komsat inside scope, Portal names, no free text); the form cannot
      submit while the unit list is empty; a refused or reserved claim shows its message.
- [x] 7.3 Implement `src/pages/undangan/[kode].astro` and
      `src/pages/undangan/[kode]/surat-suara.astro`, reusing the existing ballot,
      confirmation sheet and receipt presentation; verify the invitee sees the same
      single-candidate-mode ballot; run the group's tests green.

## 8. Wrap-up: labels, screenshots, docs and strict validation

- [x] 8.1 Failing test first in `test/audit-api.test.ts`: the audit view renders
      `undangan:<reference>` targets as a readable invitation label and the new actions
      read as "Undangan langsung dibuat", "Undangan langsung dibatalkan" and "Daftar
      undangan dilihat"; then extend `src/server/audit/labels.ts`; run the tests green.
- [x] 8.2 Run the focused suites of every group plus `npm run check` and the full
      `vitest run`, then `openspec validate add-direct-invite --strict` and fix whatever it
      reports.
- [x] 8.3 Start `wrangler dev` on this worktree's own state directory and port, seed one
      election with a link, and take 390 px screenshots of the Undangan Pemilih page, the
      welcome page, the claim form and the invite ballot; store them under
      `design/screenshots/direct-invite/`.
- [x] 8.4 Confirm the design's stated consequences still hold in the built pages: unused
      links are shown as non-voters, the per-korda page states that unused links are
      counted nationally only, and no public surface shows a link or a reference.
