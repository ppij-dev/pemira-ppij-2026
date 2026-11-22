# Proposal: Single candidate mode (Setuju / Tidak Setuju)

## Why

Some PPIJ elections present exactly one candidate. For those, the meaningful question to
the voter is approval of that one person, not a race between rivals — but today the system
cannot run such an election at all: Kunci & Jadwalkan requires 2–10 candidates and every
ballot is a pick between candidate cards. Owner decision (2026-11-13): add an explicit
**single candidate mode** that Admin Voting turns on in Pengaturan while Draf; while it is
on, Kunci & Jadwalkan demands exactly one candidate, and the ballot asks
Setuju or Tidak Setuju about that candidate. A member of the Hak pilih who did not vote by
the deadline counts as Abstain. The system does not decide the outcome: it
shows only the counts and their shares of Hak pilih, and the committee draws the
conclusion. Ballot secrecy, receipts, eligibility and participation rules are unchanged.

> **Superseded decisions.** The owner's decision of 2026-11-16 replaced the earlier W7
> Q37 (no Abstain) and W7 Q38 (non-voters count as Tidak Setuju, with a terpilih / tidak
> terpilih / seri outcome). The owner's decision of **2026-11-22** then restored W7 Q37's
> ballot: Abstain is no longer an answer a voter can pick, in the ballot, the confirmation
> sheet, the member vote path or the invitation vote path, and the server refuses it with
> 400 `invalid_choice`. Abstain now means only the members of Hak pilih who did not vote,
> counted by Hitung Abstain after voting closes, which is the part of the 2026-11-16
> decision that holds. Where this change still mentions the older rules they are marked as
> superseded; the 2026-11-22 decision is the one that holds.

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
  voter sees the single candidate and chooses exactly one of Setuju or Tidak Setuju before
  the same confirmation sheet (typing the candidate's nickname) and the same "Kirim Suara",
  on the member path and the invitation path alike. The server refuses `abstain` (and any
  other value) with 400 `invalid_choice` and records nothing. Same eligibility (frozen or
  live roll + `can_vote`), same one-vote-per-member, same one-time receipt code, same
  receipt board, same ballot secrecy. Multi-candidate elections have no answer choice at
  all. (Owner decision 2026-11-22; supersedes the three-answer ballot of 2026-11-16.)
- **Storage.** Ballots keep `candidate_id` pointing at the single candidate and gain a
  `choice` column (migration `0012_ballot_choice.sql` allowed `setuju` and `tidak_setuju`;
  migration `0013_ballot_choice_abstain.sql` rebuilds the column CHECK to `setuju`,
  `tidak_setuju`, `abstain`, NULL for normal multi-candidate ballots). Design explains why
  this preserves secrecy and backward compatibility.
- **Non-voters count as Abstain, only after Hitung Abstain; the system decides nothing.**
  A member of the frozen Hak pilih who has not voted by the deadline counts as Abstain,
  but only once Admin Voting runs "Hitung Abstain" by hand after voting closes (owner
  decision Q193: not automatic). The count is the frozen Hak pilih minus participation,
  stored once with the time (migration `0014_abstain_counted.sql`), never per person.
  Umumkan is refused in single candidate mode until it has run, and Kembali ke Draf
  clears it. Before it runs, results show Abstain as the answers cast plus a line
  "N tidak memilih (belum dihitung)". The system shows no terpilih /
  tidak terpilih / seri outcome and no "Menunggu penutupan pemungutan suara" wording in
  any stage; it presents only the counts and their shares of Hak pilih. Re-election is out
  of scope. (Owner decision 2026-11-16; supersedes the winning rule, W7 Q37/Q38.)
- **No nomor urut in single candidate mode.** The candidate has no displayed nomor urut
  anywhere: ballot, confirmation sheet ("Pilihan Anda: Setuju terhadap <nickname>", likewise Tidak Setuju or Abstain),
  candidate card and profile page, results, Dasbor and the Admin Voting candidate form.
  The schema keeps `candidates.number` NOT NULL UNIQUE CHECK > 0; a candidate registered
  while the mode is on is stored with a fixed internal nomor (1) that is never rendered,
  and the profile URL drops the number segment (`/kandidat/<nickname>`).
- **Results and Dasbor.** Setuju, Tidak Setuju and Abstain counts with their shares of
  Hak pilih — overall and per korda. Abstain is the non-voters only (Hak pilih minus
  participation, stored by Hitung Abstain) and is shown as one figure; the "Abstain
  diberikan" part is gone because no ballot carries that answer any more. Legacy ballots
  that still hold it count inside the total and are never broken out. No outcome line. Participation statistics unchanged; the
  under-10-ballots per-korda suppression unchanged. "Tidak memilih" is derived from the
  frozen Hak pilih minus participation, never per person, so ballot secrecy is untouched.
  Public results after Diumumkan show the same presentation.
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
- `admin-dashboard`: Dasbor choice tallies with their shares of Hak pilih (Abstain = tidak
  memilih), no outcome line, and the per-korda breakdown in single candidate mode.
- `public-site`: published results show the same tallies and no outcome line, including
  non-voters counted as Abstain.
- `audit-log`: audit entries for the toggles and the frozen mode value.

## Impact

- **DB:** migrations `0011_single_candidate_mode.sql` (`elections.single_candidate_mode`),
  `0012_ballot_choice.sql` (`ballots.choice`) and `0013_ballot_choice_abstain.sql`
  (rebuilds `ballots` so `choice` also allows `abstain`).
- **Server:** `election/lifecycle.ts` (switch, readiness, lock detail),
  `election/candidates.ts` (second-candidate refusal), `voting/vote.ts` (choice
  validation and storage), `voting/routes.ts`, `voting/choice.ts`, `results/queries.ts` (choice tallies, no
  outcome), admin routes for the toggle.
- **UI:** `admin/pemilihan.astro` (switch in Pengaturan), `pilih-suara.astro` (two
  answers before the confirmation sheet, no nomor urut), `admin/dasbor.astro` and
  `hasil.astro` and `index.astro` (counts, percentages, no outcome line, no nomor urut),
  `admin/kandidat.astro` (form without nomor urut while the mode is on),
  `kandidat/[slug].astro` and `kandidat/index.astro` and `components/CandidateCard.astro`
  (nickname-only profile URL `/kandidat/<nickname>` and number-free cards).
- **Tests:** `test/schema.test.ts` (migrations), `test/election-lifecycle.test.ts`
  (switch, readiness, lock freeze), `test/candidates.test.ts` (second-candidate refusal),
  `test/vote-api.test.ts` (two answers, `abstain` and unknown choices refused, secrecy,
  refusal when mode off), `test/invite-vote.test.ts` (invitation path), `test/results-api.test.ts` (tallies, non-voters as Abstain, no outcome,
  suppression),
  `test/receipt-board.test.ts` (verification unchanged).
- **Risk:** a mode toggled late or misread between Draf and Kunci. Mitigated by the
  Draf-only switch, the mode-aware readiness check listing its state, the frozen value in
  the lock audit, and refusal messages that name the mode. The system states
  no outcome at all, so no invented decision can enter the audit chain or the public
  page. Counting non-voters as Abstain is arithmetic on the frozen Hak pilih and
  participation totals, never a per-person lookup.
- **No change** to ballot secrecy mechanics, receipt codes, the receipt board, eligibility
  (roll + `can_vote`), one-vote-per-member, participation statistics or multi-candidate
  elections.

