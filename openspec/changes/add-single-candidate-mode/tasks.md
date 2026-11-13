# Tasks: Single candidate mode

Ordered, small, testable. Each numbered group lands its own tests before the next begins
(worker verification tier: build + focused tests of the changed code, 120s max per
command). Spec source of truth: the deltas in `specs/` of this change.

## 1. Migrations

- [x] 1.1 Write `migrations/0011_single_candidate_mode.sql`: `ALTER TABLE elections ADD
      COLUMN single_candidate_mode INTEGER NOT NULL DEFAULT 0 CHECK (single_candidate_mode
      IN (0, 1))` with an Indonesian comment naming the Draf-only switch and the freeze at
      Kunci & Jadwalkan (mirrors `0006_preview_mode.sql`).
- [x] 1.2 Write `migrations/0012_ballot_choice.sql`: `ALTER TABLE ballots ADD COLUMN
      choice TEXT CHECK (choice IN ('setuju','tidak_setuju','abstain'))` with a comment
      explaining NULL = normal multi-candidate ballots and that the column carries no
      member link (secrecy).
- [x] 1.3 Extend `test/schema.test.ts`: both migrations apply to a fresh D1, the elections
      default is off, an insert of a ballot with an out-of-range choice fails the CHECK,
      NULL passes, existing multi-candidate ballot inserts still succeed.

## 2. Server: Pengaturan switch, readiness and lock (election-lifecycle)

- [x] 2.1 Failing tests first in `test/election-lifecycle.test.ts`: toggle allowed in Draf
      (on and off again), refused after Kunci, refused with 2+ candidates (message naming
      the candidate count, mode stays off; owner decision Q35), audit entry per accepted
      toggle, readiness candidate check mode-aware (exactly one when on; 2–10 when off),
      lock succeeds with exactly one candidate while on, lock audit detail records
      `single_candidate_mode`.
- [x] 2.2 Implement the toggle in `src/server/election/lifecycle.ts` + admin route:
      Draf-only write of `elections.single_candidate_mode`, refusal message for later
      stages, refusal to enable while two or more candidates are registered (message
      naming the count, see design D7), audit entries "Mode kandidat tunggal
      diaktifkan"/"…dinonaktifkan".
- [x] 2.3 Make `getReadiness` mode-aware: replace the candidate-count check with exactly
      one candidate while the mode is on (message naming one candidate), keep "Minimal 2
      kandidat"/"Maksimal 10 kandidat" while off.
- [x] 2.4 Add `single_candidate_mode` to the Kunci lock audit detail JSON; run the group's
      tests green.

## 3. Server: candidate refusal (candidates)

- [x] 3.1 Failing tests first in `test/candidates.test.ts`: adding a second candidate
      while the mode is on is refused with the message naming the mode; adding the first
      candidate while on succeeds; deleting down to one candidate succeeds; with the mode
      off nothing changes.
- [x] 3.2 Implement the guard in `src/server/election/candidates.ts` (Draf add path),
      refusal message "Mode kandidat tunggal aktif: hanya satu kandidat yang dapat
      didaftarkan."; run the group's tests green.
- [x] 3.3 Number-free form and stored nomor: failing tests first in
      `test/candidates.test.ts` (while the mode is on the form contract carries no nomor
      urut and the server stores the candidate with the fixed internal nomor 1 satisfying
      `NOT NULL UNIQUE CHECK > 0`; candidates already registered keep their stored nomor;
      with the mode off the form and numbering rules are unchanged), then implement in
      `src/server/election/candidates.ts` and `src/pages/admin/kandidat.astro` (form
      renders no nomor urut field while the mode is on); run the group's tests green.
- [x] 3.4 Nickname-only profile URL: while the mode is on resolve `/kandidat/<nickname>`
      by nickname (existing numbered route shape stays for normal mode) and generate all
      profile links in the number-free form; focused render check of the profile page
      showing name, nickname, komsat, description, color and placeholder image with no
      nomor urut.

## 4. Server: ballot with choice (voting)

- [x] 4.1 Failing tests first in `test/vote-api.test.ts`: in single candidate mode a vote
      with each of the three choices is accepted and stored (choice + single
      `candidate_id`); missing/invalid choice → HTTP 400, nothing recorded;
      `candidate_id` of a different candidate → 400; with the mode off a request carrying
      a choice → 400 and a normal vote still stores NULL; participation + ballot still one
      batch; ballot rows gain no member/time data; receipt code and board flow unchanged
      (cover the single-mode code in `test/receipt-board.test.ts`).
- [x] 4.2 Implement in `src/server/voting/vote.ts` (+ `routes.ts`): accept and validate
      `choice` only while the mode is on, enforce `candidate_id` = the single registered
      candidate, write `choice` in the existing single D1 batch, keep the nickname
      confirmation and one-vote-per-member guards identical; run the group's tests green.

## 5. Server: Uji Coba with a choice

- [x] 5.1 Failing test in `test/election-lifecycle.test.ts`: while the mode is on a Uji
      Coba vote stores a chosen choice and Dasbor counts it as test data; while off the
      test vote shape is unchanged.
- [x] 5.2 Extend `castTestVote` accordingly; run the group's tests green.

## 6. Server: results and outcome (results)

- [x] 6.1 Failing tests first in `test/results-api.test.ts`: in single candidate mode the
      payload carries the three counts with their shares of votes cast (Setuju + Tidak
      Setuju + Abstain in scope), the outcome (`terpilih` / `tidak_terpilih` / `seri` /
      `belum_ada_suara`) for Setuju ahead, Tidak Setuju ahead, tie with at least one
      ballot cast, and the "Belum ada suara" zero-ballot case; per-korda rows carry the three counts above 10 ballots and
      stay suppressed below; test rows in Draf behave as today; with the mode off the
      payload equals today's shape.
- [x] 6.2 Implement the aggregation and outcome computation in
      `src/server/results/queries.ts` (set-based SQL, same suppression constant); run the
      group's tests green.

## 7. UI: Pengaturan switch (admin)

- [x] 7.1 `src/pages/admin/pemilihan.astro`: add the "Mode kandidat tunggal" switch to the
      schedule/settings panel, editable only in Draf (read-only with explanatory text
      afterwards), helper text naming the exactly-one-candidate rule, posting to the
      toggle route with refresh-by-navigation only (no polling), no emoji.
- [ ] 7.2 Focused check: build passes and the page renders the switch state from the
      elections row in Draf and after Kunci.

## 8. UI: single-candidate ballot (voter)

- [ ] 8.1 `src/pages/pilih-suara.astro`: while the mode is on show the single candidate
      with the three answers "Setuju", "Tidak Setuju", "Abstain" (radio-style cards),
      require a selection before the confirmation sheet opens, then the existing sheet
      (type the nickname) and "Kirim Suara"; the ballot and the sheet show no nomor urut
      and the sheet states the chosen answer as "Pilihan Anda: Setuju terhadap <nickname>"
      (likewise "Tidak Setuju"/"Abstain terhadap"); success screen, one-time code and
      Bukti Suara link untouched; keep the multi-candidate UI exactly as-is while the
      mode is off.
- [ ] 8.2 Focused check: build passes; manual smoke of the three answers against the local
      dev server is covered by the group 4 API tests plus this render check.

## 9. UI: results and outcome (Dasbor, Hasil, landing)

- [ ] 9.1 `src/pages/admin/dasbor.astro`: in single candidate mode render the three counts
      with percentages, the outcome line ("Terpilih" / "Tidak terpilih" / "Seri,
      keputusan diserahkan kepada panitia") and the per-korda columns, all without a
      nomor urut (nickname and color only); normal mode rendering untouched; manual
      refresh behavior untouched.
- [ ] 9.2 `src/pages/hasil.astro` and `src/pages/index.astro`: render the same public
      presentation once Diumumkan, including the Seri line and the number-free candidate
      card linking to `/kandidat/<nickname>`; nothing before Diumumkan.
- [ ] 9.3 Focused check: build passes and the outcome line strings match design.md D7
      exactly.

## 10. Verification

- [x] 10.1 Worker tier: build + the focused tests of every group above green.
- [x] 10.2 Re-read AGENTS.md hard rules against the diff: ballot secrecy (no link, no
      timestamp), receipts (hash-only storage, browser hashing), audit (every toggle and
      tally view recorded, never a choice), manual refresh only, roles wording ("Admin
      Voting"), Bahasa Indonesia copy with no emoji.
- [x] 10.3 `openspec validate add-single-candidate-mode --strict` passes before handoff.
