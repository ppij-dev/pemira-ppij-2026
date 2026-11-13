# Design: Single candidate mode

## Context

One election per site (`elections`), stages from Draf to Diumumkan computed from the clock.
Draf-only settings live on the elections row and are frozen at Kunci & Jadwalkan
(`preview_mode`, `allow_admin_voting`); Pengaturan (the settings area of the Persiapan
Pemilihan page, `admin/pemilihan.astro`) edits them with an audit entry each. Ballots are
secret: `participation` (who, when) and `ballots` (random id, candidate, komsat path,
receipt hash, `WITHOUT ROWID`, no timestamp) are written in one D1 batch with nothing
linking them. Results are computed as set-based SQL over candidates and korda buckets with
a per-korda suppression under 10 ballots. The vote API takes `candidate_id` plus
`confirmation_text` (nickname, case/space-insensitive).

Owner decisions (2026-11-13) are fixed: the switch, its Draf-only editability, the Kunci
refusal unless exactly one candidate, the second-candidate refusal, the three ballot
answers, keeping `candidate_id` plus a `choice` column, the Setuju > Tidak Setuju winning
rule, the tie wording, and Bahasa Indonesia copy with no emoji.

## Goals / Non-goals

- **Goal:** run a one-candidate election end to end — prepare, vote, tally, publish — with
  every existing secrecy, receipt and eligibility guarantee intact.
- **Non-goal:** re-election after a tie or a rejected candidate (out of scope; the system
  only presents the outcome and records no decision).
- **Non-goal:** any change to multi-candidate elections. With the switch off, behavior,
  storage and payloads are byte-for-byte today's.

## Decisions

### D1: Mode column on `elections`, frozen at Kunci

`elections.single_candidate_mode INTEGER NOT NULL DEFAULT 0 CHECK (single_candidate_mode
IN (0, 1))` — the same pattern as `preview_mode`. Rationale: one election per site already
carries its Draf-only switches there; the lifecycle layer already refuses setting writes
when `status_lock != 'draft'`, which is exactly the "frozen at Kunci" rule; and the Kunci
audit detail already records frozen values (`frozen_hak_pilih`, deleted test votes), so
recording the mode there needs no new mechanism.

### D2: Ballot storage keeps `candidate_id` and adds `choice`

While the mode is on, the ballot stores the single candidate in `candidate_id` (as today)
and the answer in a new column: `ballots.choice TEXT CHECK (choice IN
('setuju','tidak_setuju','abstain'))`, NULL for normal multi-candidate ballots. Both
columns are added by new migrations; no table is rebuilt, `WITHOUT ROWID` is untouched.

**Why this keeps ballot secrecy.** `choice` is ballot content, not voter content: it adds
no member reference, no timestamp and no ordering hint. Ballots keep their random id, no
time column and `WITHOUT ROWID`, and continue to be written in the same single D1 batch as
the participation row with nothing linking them, so "no column, ordering or timestamp
connects a ballot to a member" still holds. An abstain is indistinguishable from any other
ballot at the storage layer — the choice is only ever read as an aggregate count.

**Why this is backward compatible.** Existing ballots all read NULL in `choice`; every
existing query (tally by candidate, per-korda buckets, count check) keeps working
unchanged, because in normal mode nothing writes or reads `choice`. Single-mode queries
are additive (aggregate `GROUP BY choice` when the mode is on). The CHECK constraint lives
on the column itself, so no trigger or application-only rule is needed, and NULL passes
the constraint, which is exactly the multi-candidate case.

**Alternatives rejected.** A separate referendum/answer table would fork the receipt,
board, count-check and results code paths and duplicate the secrecy invariants; encoding
the three answers as pseudo-candidates would corrupt candidate semantics (numbers,
nicknames, colors, the 2–10 rule) and the audit trail.

### D3: Winning rule and the outcome line

The outcome is a pure function of the real (non-test) ballots:

- `setuju_count > tidak_setuju_count` → outcome "Terpilih" (the single candidate is
  elected).
- `tidak_setuju_count > setuju_count` → outcome "Tidak terpilih".
- equal (including zero ballots cast, where both are 0) → outcome "Seri, keputusan
  diserahkan kepada panitia".

`abstain_count` is displayed and counts toward votes cast (percentages), but never enters
the comparison. "The system records no decision" for a tie means: no outcome column or
flag is stored, no audit entry or admin control exists for deciding a tie, and the
published result simply states the Seri line. Re-election is not modeled anywhere.

### D4: Vote API shape

While the mode is on, the vote request still carries `candidate_id` (it MUST equal the one
registered candidate — kept so the storage contract does not fork) and additionally the
answer as `choice` ∈ `setuju | tidak_setuju | abstain`. A request without a valid choice
is refused with HTTP 400 and records nothing, mirroring the existing confirmation-text
refusal. While the mode is off, a request that carries a non-null `choice` is refused the
same way, so multi-candidate behavior stays unchanged. The confirmation sheet is
untouched: the nickname check runs exactly as today, on top of the choice check.

### D5: Results payload

`ResultsPayload`/`DashboardPayload` gain a mode flag plus, when the mode is on,
`outcome` (`terpilih | tidak_terpilih | seri`) and `setuju_count`, `tidak_setuju_count`,
`abstain_count` with percentages of votes cast (one decimal, like turnout), overall and
inside each `korda` row. The `candidates` array is kept (with the single candidate and its
total) so existing consumers and the count check stay intact. Percentages use the same
ballot total as the counts themselves, so they always sum to 100 over the three answers.
The per-korda suppression (`KORDA_MIN_BALLOTS = 10`) applies unchanged: below 10 ballots a
korda row shows turnout and "Data terlalu sedikit" and no choice breakdown.

### D6: Uji Coba and preview mode

In Draf, Uji Coba is the committee's rehearsal of the real ballot, so while the mode is on
the test-vote flow lets the Admin Voting pick one of the three answers and stores it on
the test ballot (still deleted at Kunci, still marked as test data on Dasbor). Assumption
flagged for the owner: the brief does not state this; without it the rehearsal cannot
exercise the single-candidate Dasbor. Preview mode and single candidate mode are
independent switches in Pengaturan: preview still auto-registers voters and skips the
final sync at Kunci; single candidate mode still demands exactly one candidate at Kunci.

### D7: Copy (Bahasa Indonesia, no emoji)

- Switch: "Mode kandidat tunggal" with helper text that it can only be changed while Draf
  and demands exactly one candidate at Kunci & Jadwalkan.
- Ballot answers: "Setuju", "Tidak Setuju", "Abstain" (the owner's exact words).
- Outcome lines: "Terpilih", "Tidak terpilih", "Seri, keputusan diserahkan kepada panitia".
- Refusal to add a second candidate: names the mode, e.g. "Mode kandidat tunggal aktif:
  hanya satu kandidat yang dapat didaftarkan."
- Toggle audit actions: "Mode kandidat tunggal diaktifkan" / "Mode kandidat tunggal
  dinonaktifkan".
- Wording: "Admin Voting" for committee members everywhere; "Pemilih" for voters.

## Risks / Trade-offs

- **Mode mishandled between Draf and Kunci** — mitigated by the mode-aware readiness check
  listing its state on the Persiapan Pemilihan page and by the frozen value in the lock
  audit detail.
- **Zero ballots cast shows the Seri line** — the owner rule compares counts, so 0 = 0 is
  a tie. Presented as "Seri, keputusan diserahkan kepada panitia"; flagged as an open
  question in the proposal handoff.
- **`choice` widens the ballot schema** — closed by the CHECK constraint, NULL-for-normal
  compatibility, and the secrecy argument in D2.

## Migration plan

1. `0011_single_candidate_mode.sql` — add the elections column (default off).
2. `0012_ballot_choice.sql` — add `ballots.choice` (NULL for existing ballots).

Both are repeat-safe D1 migrations applied by the documented operator flow; no data
backfill is needed (no election has run in this mode before).

## Open questions

- Should the Seri line differ when no ballots were cast at all? (Assumed: no — 0 = 0 is a
  tie under the owner rule.)
- Should Pengaturan refuse to turn the mode on while two or more candidates already exist?
  (Assumed: no — the brief only refuses Kunci and the second candidate; the committee
  reduces the list to one in Draf.)
- Should Uji Coba in single candidate mode pick a choice as assumed in D6?

