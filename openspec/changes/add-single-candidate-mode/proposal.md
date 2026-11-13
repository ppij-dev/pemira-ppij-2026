# Proposal: Single candidate mode (Setuju / Tidak Setuju / Abstain)

## Why

Some PPIJ elections present exactly one candidate. For those, the meaningful question to
the voter is approval of that one person, not a race between rivals — but today the system
cannot run such an election at all: Kunci & Jadwalkan requires 2–10 candidates and every
ballot is a pick between candidate cards. Owner decision (2026-11-13): add an explicit
**single candidate mode** that Admin Voting turns on in Pengaturan while Draf; while it is
on, Kunci & Jadwalkan demands exactly one candidate, and the ballot asks
Setuju / Tidak Setuju / Abstain about that candidate. The winner is decided by Setuju vs
Tidak Setuju among votes cast; a tie is reported to the panitia and the system records no
decision. Ballot secrecy, receipts, eligibility and participation rules are unchanged.

## What Changes

- **Switch in Pengaturan (Draf only).** A single-candidate-mode switch sits beside the
  schedule and preview controls. It can be toggled only while Draf; each toggle is
  recorded in the audit log; the value is frozen at Kunci & Jadwalkan. New column
  `elections.single_candidate_mode` (migration `0011_single_candidate_mode.sql`),
  mirroring the existing `preview_mode` pattern.
- **Kunci & Jadwalkan refuses while the switch is on unless exactly one candidate is
  registered.** The candidate-count readiness check becomes mode-aware: 2–10 candidates
  when the switch is off (unchanged), exactly one when it is on. The frozen mode value is
  written into the lock audit entry's detail.
- **Adding a second candidate is refused while the switch is on.** Candidate management
  refuses a second candidate in Draf with a message that names the mode. Turning the
  switch on while several candidates already exist stays possible (it is Draf), but Kunci
  stays blocked until exactly one candidate remains.
- **Ballot with three answers.** While the mode is on and voting is open, the eligible
  voter sees the single candidate and chooses exactly one of Setuju, Tidak Setuju or
  Abstain before the same confirmation sheet (typing the candidate's nickname) and the
  same "Kirim Suara". Same eligibility (frozen roll + `can_vote`), same one-vote-per-member,
  same one-time receipt code, same receipt board, same ballot secrecy.
- **Storage.** Ballots keep `candidate_id` pointing at the single candidate and gain a
  `choice` column (`CHECK (choice IN ('setuju','tidak_setuju','abstain'))`, NULL for
  normal multi-candidate ballots; migration `0012_ballot_choice.sql`). Design explains why
  this preserves secrecy and backward compatibility.
- **Winning rule.** Elected when Setuju > Tidak Setuju among votes cast; Abstain is
  counted and shown on its own but excluded from the comparison. Tie (Setuju = Tidak
  Setuju with at least one ballot cast): the result shows "Seri, keputusan diserahkan
  kepada panitia" and the system records no decision. With no ballots cast the outcome
  line reads "Belum ada suara". Tidak Setuju ahead: "Tidak terpilih". Re-election is out
  of scope.
- **No nomor urut in single candidate mode.** The candidate has no displayed nomor urut
  anywhere: ballot, confirmation sheet ("Pilihan Anda: Setuju terhadap <nickname>"),
  candidate card and profile page, results, Dasbor and the Admin Voting candidate form.
  The schema keeps `candidates.number` NOT NULL UNIQUE CHECK > 0; a candidate registered
  while the mode is on is stored with a fixed internal nomor (1) that is never rendered,
  and the profile URL drops the number segment (`/kandidat/<nickname>`).
- **Results and Dasbor.** Setuju / Tidak Setuju / Abstain counts and percentages — each
  answer's share of the Setuju + Tidak Setuju + Abstain ballots in scope — overall and
  per korda, plus the outcome line; participation statistics unchanged; the under-10-ballots per-korda suppression unchanged. Public results after Diumumkan
  show the same presentation.
- **Audit.** Mode toggles are recorded as Admin Voting actions and the Kunci entry records
  the frozen mode value; vote audit entries keep recording no choice in either mode.

## Capabilities

### New Capabilities

_None — the mode lives inside existing capabilities._

### Modified Capabilities

- `voting-and-receipts`: the single-candidate ballot with the three answers, the extended
  ballot storage (`choice`), unchanged receipts/board/confirmation, and Uji Coba with a
  choice.
- `election-lifecycle`: the Draf-only switch in Pengaturan, the mode-aware readiness check,
  and the frozen mode value at Kunci & Jadwalkan.
- `candidate-management`: refusing a second candidate while the mode is on; the number-free
  candidate form with the stored internal nomor; the nickname-only profile URL.
- `admin-dashboard`: Dasbor choice tallies with percentages, the outcome line, and the
  per-korda breakdown in single candidate mode.
- `public-site`: published results show the same tallies and outcome line.
- `audit-log`: audit entries for the toggles and the frozen mode value.

## Impact

- **DB:** migrations `0011_single_candidate_mode.sql` (`elections.single_candidate_mode`)
  and `0012_ballot_choice.sql` (`ballots.choice`).
- **Server:** `election/lifecycle.ts` (switch, readiness, lock detail),
  `election/candidates.ts` (second-candidate refusal), `voting/vote.ts` (choice
  validation and storage), `voting/routes.ts`, `results/queries.ts` (choice tallies and
  outcome), admin routes for the toggle.
- **UI:** `admin/pemilihan.astro` (switch in Pengaturan), `pilih-suara.astro` (three
  answers before the confirmation sheet, no nomor urut), `admin/dasbor.astro` and
  `hasil.astro` and `index.astro` (counts, percentages, outcome line, no nomor urut),
  `admin/kandidat.astro` (form without nomor urut while the mode is on),
  `kandidat/[slug].astro` and `kandidat/index.astro` and `components/CandidateCard.astro`
  (nickname-only profile URL `/kandidat/<nickname>` and number-free cards).
- **Tests:** `test/schema.test.ts` (migrations), `test/election-lifecycle.test.ts`
  (switch, readiness, lock freeze), `test/candidates.test.ts` (second-candidate refusal),
  `test/vote-api.test.ts` (three answers, secrecy, refusal when mode off),
  `test/results-api.test.ts` (tallies, outcome line, suppression),
  `test/receipt-board.test.ts` (verification unchanged).
- **Risk:** a mode toggled late or misread between Draf and Kunci. Mitigated by the
  Draf-only switch, the mode-aware readiness check listing its state, the frozen value in
  the lock audit, and refusal messages that name the mode. Tied and Abstain-heavy results
  are only ever presented — the system records no decision, so no invented outcome can
  enter the audit chain.
- **No change** to ballot secrecy mechanics, receipt codes, the receipt board, eligibility
  (roll + `can_vote`), one-vote-per-member, participation statistics or multi-candidate
  elections.

