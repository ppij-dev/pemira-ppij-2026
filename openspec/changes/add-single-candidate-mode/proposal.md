# Proposal: Single candidate mode (Setuju / Tidak Setuju)

## Why

Some PPIJ elections present exactly one candidate. For those, the meaningful question to
the voter is approval of that one person, not a race between rivals — but today the system
cannot run such an election at all: Kunci & Jadwalkan requires 2–10 candidates and every
ballot is a pick between candidate cards. Owner decision (2026-11-13): add an explicit
**single candidate mode** that Admin Voting turns on in Pengaturan while Draf; while it is
on, Kunci & Jadwalkan demands exactly one candidate, and the ballot asks
Setuju or Tidak Setuju about that candidate. At close every member of the frozen Hak pilih
who did not vote counts as Tidak Setuju, so the candidate is elected by more than half of
Hak pilih; a tie is reported to the panitia and the system records no decision. Ballot
secrecy, receipts, eligibility and participation rules are unchanged.

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
  refuses a second candidate in Draf with a message that names the mode. The switch can
  only be turned on while 0 or 1 candidate is registered; with 2+ candidates Pengaturan
  refuses the switch with a clear message naming the candidate count (owner decision
  2026-11-13, Q35).
- **Ballot with two answers.** While the mode is on and voting is open, the eligible
  voter sees the single candidate and chooses exactly one of Setuju or Tidak Setuju
  before the same confirmation sheet (typing the candidate's nickname) and the same
  "Kirim Suara". Same eligibility (frozen roll + `can_vote`), same one-vote-per-member,
  same one-time receipt code, same receipt board, same ballot secrecy. There is no
  Abstain (owner decision 2026-11-13, W7 Q37).
- **Storage.** Ballots keep `candidate_id` pointing at the single candidate and gain a
  `choice` column (`CHECK (choice IN ('setuju','tidak_setuju'))`, NULL for normal
  multi-candidate ballots; migration `0012_ballot_choice.sql`). Design explains why this
  preserves secrecy and backward compatibility.
- **Winning rule.** A member of the frozen Hak pilih who did not vote counts as Tidak
  Setuju at close. Elected when Setuju is greater than (Tidak Setuju + tidak memilih) —
  more than half of Hak pilih; tie (Setuju equal to Tidak Setuju + tidak memilih): the
  result shows "Seri, keputusan diserahkan kepada panitia" and the system records no
  decision; otherwise "Tidak terpilih". With no ballots cast every eligible member counts
  as Tidak Setuju, so the outcome is "Tidak terpilih" (owner decision 2026-11-13, W7
  Q37/Q38). The outcome exists only after voting closes; while voting is open or the
  election is still Draf/terjadwal the results show counts with the outcome
  "Menunggu penutupan pemungutan suara". Re-election is out of scope.
- **No nomor urut in single candidate mode.** The candidate has no displayed nomor urut
  anywhere: ballot, confirmation sheet ("Pilihan Anda: Setuju terhadap <nickname>"),
  candidate card and profile page, results, Dasbor and the Admin Voting candidate form.
  The schema keeps `candidates.number` NOT NULL UNIQUE CHECK > 0; a candidate registered
  while the mode is on is stored with a fixed internal nomor (1) that is never rendered,
  and the profile URL drops the number segment (`/kandidat/<nickname>`).
- **Results and Dasbor.** Setuju, Tidak Setuju and Tidak memilih (dihitung Tidak Setuju)
  counts with their shares of Hak pilih — overall and per korda, plus the outcome line;
  participation statistics unchanged; the under-10-ballots per-korda suppression
  unchanged. Tidak memilih is derived from the frozen Hak pilih minus participation, never
  per person, so ballot secrecy is untouched. Public results after Diumumkan show the same
  presentation.
- **Audit.** Mode toggles are recorded as Admin Voting actions and the Kunci entry records
  the frozen mode value; vote audit entries keep recording no choice in either mode.

## Capabilities

### New Capabilities

_None — the mode lives inside existing capabilities._

### Modified Capabilities

- `voting-and-receipts`: the single-candidate ballot with the two answers, the extended
  ballot storage (`choice`), unchanged receipts/board/confirmation, and Uji Coba with a
  choice.
- `election-lifecycle`: the Draf-only switch in Pengaturan, the mode-aware readiness check,
  and the frozen mode value at Kunci & Jadwalkan.
- `candidate-management`: refusing a second candidate while the mode is on; the number-free
  candidate form with the stored internal nomor; the nickname-only profile URL.
- `admin-dashboard`: Dasbor choice tallies with their shares of Hak pilih, the outcome
  line (with "Menunggu penutupan pemungutan suara" before close), and the per-korda
  breakdown in single candidate mode.
- `public-site`: published results show the same tallies and outcome line, including
  Tidak memilih counted as Tidak Setuju.
- `audit-log`: audit entries for the toggles and the frozen mode value.

## Impact

- **DB:** migrations `0011_single_candidate_mode.sql` (`elections.single_candidate_mode`)
  and `0012_ballot_choice.sql` (`ballots.choice`).
- **Server:** `election/lifecycle.ts` (switch, readiness, lock detail),
  `election/candidates.ts` (second-candidate refusal), `voting/vote.ts` (choice
  validation and storage), `voting/routes.ts`, `results/queries.ts` (choice tallies and
  outcome), admin routes for the toggle.
- **UI:** `admin/pemilihan.astro` (switch in Pengaturan), `pilih-suara.astro` (two
  answers before the confirmation sheet, no nomor urut), `admin/dasbor.astro` and
  `hasil.astro` and `index.astro` (counts, percentages, outcome line, no nomor urut),
  `admin/kandidat.astro` (form without nomor urut while the mode is on),
  `kandidat/[slug].astro` and `kandidat/index.astro` and `components/CandidateCard.astro`
  (nickname-only profile URL `/kandidat/<nickname>` and number-free cards).
- **Tests:** `test/schema.test.ts` (migrations), `test/election-lifecycle.test.ts`
  (switch, readiness, lock freeze), `test/candidates.test.ts` (second-candidate refusal),
  `test/vote-api.test.ts` (two answers, secrecy, refusal when mode off),
  `test/results-api.test.ts` (tallies, Tidak memilih, outcome line, suppression),
  `test/receipt-board.test.ts` (verification unchanged).
- **Risk:** a mode toggled late or misread between Draf and Kunci. Mitigated by the
  Draf-only switch, the mode-aware readiness check listing its state, the frozen value in
  the lock audit, and refusal messages that name the mode. Tied results are only ever
  presented — the system records no decision, so no invented outcome can enter the audit
  chain. Counting non-voters as Tidak Setuju is arithmetic on the frozen Hak pilih and
  participation totals, never a per-person lookup.
- **No change** to ballot secrecy mechanics, receipt codes, the receipt board, eligibility
  (roll + `can_vote`), one-vote-per-member, participation statistics or multi-candidate
  elections.

