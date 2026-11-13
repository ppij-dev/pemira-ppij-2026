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
refusal unless exactly one candidate, the second-candidate refusal, the two ballot answers
(Setuju / Tidak Setuju, no Abstain — W7 Q37), keeping `candidate_id` plus a `choice`
column, the winning rule of Setuju against Tidak Setuju plus non-voters (W7 Q38), the
outcome existing only after close, the tie wording, and Bahasa Indonesia copy with no
emoji.

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
IN (0, 1))` — the same pattern as `preview_mode`. Owner decision (2026-11-13, Q35):
enabling the switch is refused while two or more candidates are registered, with a
message naming the candidate count; turning it off stays possible in Draf.
Rationale: one election per site already
carries its Draf-only switches there; the lifecycle layer already refuses setting writes
when `status_lock != 'draft'`, which is exactly the "frozen at Kunci" rule; and the Kunci
audit detail already records frozen values (`frozen_hak_pilih`, deleted test votes), so
recording the mode there needs no new mechanism.

### D2: Ballot storage keeps `candidate_id` and adds `choice`

While the mode is on, the ballot stores the single candidate in `candidate_id` (as today)
and the answer in a new column: `ballots.choice TEXT CHECK (choice IN
('setuju','tidak_setuju'))`, NULL for normal multi-candidate ballots. Both columns are
added by new migrations; no table is rebuilt, `WITHOUT ROWID` is untouched.

**Why this keeps ballot secrecy.** `choice` is ballot content, not voter content: it adds
no member reference, no timestamp and no ordering hint. Ballots keep their random id, no
time column and `WITHOUT ROWID`, and continue to be written in the same single D1 batch as
the participation row with nothing linking them, so "no column, ordering or timestamp
connects a ballot to a member" still holds. A Tidak Setuju ballot is indistinguishable
from any other ballot at the storage layer — the choice is only ever read as an aggregate
count. Non-voters are never read per person: "tidak memilih" is the frozen Hak pilih total
minus the participation total.

**Why this is backward compatible.** Existing ballots all read NULL in `choice`; every
existing query (tally by candidate, per-korda buckets, count check) keeps working
unchanged, because in normal mode nothing writes or reads `choice`. Single-mode queries
are additive (aggregate `GROUP BY choice` when the mode is on). The CHECK constraint lives
on the column itself, so no trigger or application-only rule is needed, and NULL passes
the constraint, which is exactly the multi-candidate case.

**Alternatives rejected.** A separate referendum/answer table would fork the receipt,
board, count-check and results code paths and duplicate the secrecy invariants; encoding
the two answers as pseudo-candidates would corrupt candidate semantics (numbers,
nicknames, colors, the 2–10 rule) and the audit trail.

### D3: Winning rule and the outcome line

At close every member of the frozen Hak pilih who did not vote counts as Tidak Setuju
(owner decision 2026-11-13, W7 Q38). The comparison is therefore against
`tidak_setuju_count + tidak_memilih_count`, and `tidak_memilih_count` is
`eligible_count - participation_count` (never below zero), with no per-person lookup:

- `setuju_count > tidak_setuju_count + tidak_memilih_count` → outcome "Terpilih": the
  candidate has more than half of Hak pilih.
- `setuju_count === tidak_setuju_count + tidak_memilih_count` → outcome "Seri, keputusan
  diserahkan kepada panitia".
- otherwise → outcome "Tidak terpilih".

The counts come from real (non-test) ballots and the frozen Hak pilih. With no ballots
cast every eligible member is Tidak memilih, so the outcome is "Tidak terpilih"; the
earlier "Belum ada suara" case is removed by W7 Q37/Q38. If Hak pilih is zero (no eligible
member at all) the comparison is equal and the outcome is Seri.

**The outcome exists only after voting closes.** While Draf, terjadwal or Dibuka the
results payload carries `outcome: "menunggu_penutupan"` (UI: "Menunggu penutupan
pemungutan suara") together with the running counts; only in Tutup or Diumumkan is the
outcome one of `terpilih | tidak_terpilih | seri`.

"The system records no decision" for a tie means: no outcome column or flag is stored, no
audit entry or admin control exists for deciding a tie, and the published result simply
states the Seri line. Re-election is not modeled anywhere.

Owner decisions (2026-11-13) on the outcome details: Uji Coba may pick either answer;
percentages are shares of Hak pilih per scope (overall and per korda).

### D4: Vote API shape

While the mode is on, the vote request still carries `candidate_id` (it MUST equal the one
registered candidate — kept so the storage contract does not fork) and additionally the
answer as `choice` ∈ `setuju | tidak_setuju`. A request without a valid choice
is refused with HTTP 400 and records nothing, mirroring the existing confirmation-text
refusal. While the mode is off, a request that carries a non-null `choice` is refused the
same way, so multi-candidate behavior stays unchanged. The confirmation sheet is
untouched: the nickname check runs exactly as today, on top of the choice check.

### D5: Results payload

`ResultsPayload`/`DashboardPayload` gain a mode flag plus, when the mode is on,
`outcome` (`terpilih | tidak_terpilih | seri | menunggu_penutupan`) and `setuju_count`,
`tidak_setuju_count`, `tidak_memilih_count` with percentages of Hak pilih — each count's
share of the eligible members in scope (one decimal, like turnout) — overall and inside
each `korda` row. `tidak_memilih_count` is `eligible_count - participation_count` clamped
at zero, so the three counts always add up to Hak pilih and the three percentages always
sum to 100 when Hak pilih is above zero. The `candidates` array is kept (with the single
candidate and its total) so existing consumers and the count check stay intact.
The per-korda suppression (`KORDA_MIN_BALLOTS = 10`) applies unchanged: below 10 ballots a
korda row shows turnout and "Data terlalu sedikit" and no choice breakdown (the three
counts are null there).

### D6: Uji Coba and preview mode

In Draf, Uji Coba is the committee's rehearsal of the real ballot, so while the mode is on
the test-vote flow lets the Admin Voting pick either answer, Setuju or Tidak Setuju (owner
decision 2026-11-13, W7 Q37) and stores it on the test ballot (still deleted at Kunci,
still marked as test data on Dasbor). Preview mode and single candidate mode are
independent switches in Pengaturan: preview still auto-registers voters and skips the
final sync at Kunci; single candidate mode still demands exactly one candidate at Kunci.

### D7: Copy (Bahasa Indonesia, no emoji)

- Switch: "Mode kandidat tunggal" with helper text that it can only be changed while Draf
  and demands exactly one candidate at Kunci & Jadwalkan.
- Ballot answers: "Setuju" and "Tidak Setuju" (the owner's exact words); there is no
  Abstain.
- Outcome lines: "Terpilih", "Tidak terpilih", "Seri, keputusan diserahkan kepada
  panitia", and "Menunggu penutupan pemungutan suara" before voting closes.
- Result labels: "Setuju", "Tidak Setuju", "Tidak memilih (dihitung Tidak Setuju)".
- Refusal to add a second candidate: names the mode, e.g. "Mode kandidat tunggal aktif:
  hanya satu kandidat yang dapat didaftarkan."
- Toggle audit actions: "Mode kandidat tunggal diaktifkan" / "Mode kandidat tunggal
  dinonaktifkan".
- Refusal to enable the switch with 2+ candidates (owner decision 2026-11-13, Q35): a
  clear message naming the count, e.g. "Mode kandidat tunggal tidak dapat diaktifkan:
  saat ini terdaftar 3 kandidat. Sisakan 0 atau 1 kandidat terlebih dahulu."
- Wording: "Admin Voting" for committee members everywhere; "Pemilih" for voters.

### D8: No nomor urut in single candidate mode

Owner decision (2026-11-13): the single candidate has no displayed nomor urut anywhere —
ballot, confirmation sheet, candidate card, profile page, results, Dasbor and the Admin
Voting candidate form.

**Storage.** The schema stays untouched: `candidates.number` keeps `NOT NULL UNIQUE CHECK
(number > 0)`. While the mode is on, a candidate registered through the form is stored
with the fixed internal nomor `1` — the mode guarantees at most one candidate, so the
UNIQUE constraint never conflicts. Candidates already registered keep their stored nomor;
nothing is rewritten on toggle or at Kunci. The nomor becomes display data that
single-mode rendering never reads.

**Profile URL.** The numbered route shape `/kandidat/<nomor>-<nickname>` stays for normal
mode. While the mode is on, the single candidate's profile lives at `/kandidat/<nickname>`
(the nickname as the slug segment, resolved by nickname instead of number-plus-nickname),
and every link to the profile — cards, landing page, ballot — uses that number-free form;
the numbered URL is not generated in single mode.

**Confirmation sheet copy.** Per the owner's exact wording, the sheet states the chosen
answer: "Pilihan Anda: Setuju terhadap <nickname>" or "Pilihan Anda: Tidak Setuju terhadap
<nickname>". The Abstain wording of the earlier revision is withdrawn (W7 Q37).

## Risks / Trade-offs

- **Mode mishandled between Draf and Kunci** — mitigated by the mode-aware readiness check
  listing its state on the Persiapan Pemilihan page and by the frozen value in the lock
  audit detail.
- **`choice` widens the ballot schema** — closed by the CHECK constraint, NULL-for-normal
  compatibility, and the secrecy argument in D2.
- **Counting non-voters as Tidak Setuju could look like per-person data** — it is only
  `eligible_count - participation_count` on frozen totals, never a join between
  participation and ballots, so the secrecy invariants of D2 still hold.

## Migration plan

1. `0011_single_candidate_mode.sql` — add the elections column (default off).
2. `0012_ballot_choice.sql` — add `ballots.choice` with the two allowed answers (NULL for
   existing ballots). No environment has applied this migration yet, so it is edited in
   place to the two-value CHECK (W7 Q37).

Both are repeat-safe D1 migrations applied by the documented operator flow; no data
backfill is needed (no election has run in this mode before).

## Open questions

_None._ The earlier questions are owner decisions: Q35 (the switch refuses to turn on with
2+ candidates), W7 Q37 (no Abstain — only Setuju / Tidak Setuju) and W7 Q38 (non-voters
count as Tidak Setuju, outcome only after close).

