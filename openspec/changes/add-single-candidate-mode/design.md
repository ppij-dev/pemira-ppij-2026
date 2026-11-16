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
refusal unless exactly one candidate, the second-candidate refusal, keeping `candidate_id`
plus a `choice` column, and Bahasa Indonesia copy with no emoji.

**Superseded by the owner's decision of 2026-11-16.** The earlier W7 Q37 (two answers, no
Abstain) and W7 Q38 (non-voters count as Tidak Setuju; terpilih / tidak terpilih / seri
outcome, "Menunggu penutupan" before close) no longer hold. The new decisions: the ballot
has three answers (Setuju, Tidak Setuju, Abstain); a member of the frozen Hak pilih who has
not voted by the deadline counts as Abstain; and the system does not decide the outcome —
it shows only counts and shares of Hak pilih.

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
and the answer in a column `ballots.choice`, NULL for normal multi-candidate ballots.
Migration `0012_ballot_choice.sql` added it with `CHECK (choice IN ('setuju',
'tidak_setuju'))`. Abstain (owner decision 2026-11-16) needs the CHECK widened to
`('setuju','tidak_setuju','abstain')`; SQLite cannot alter a CHECK in place, and 0012 may
already be applied somewhere so it is never edited. Migration
`0013_ballot_choice_abstain.sql` therefore rebuilds `ballots` (create the new table with
the same columns, copy rows, drop the old table, rename, recreate the two indexes). The
rebuild keeps `WITHOUT ROWID`, the random text primary key, the `receipt_hash UNIQUE`
constraint and the absence of any member or time column, so the secrecy argument below is
unchanged.

**Why this keeps ballot secrecy.** `choice` is ballot content, not voter content: it adds
no member reference, no timestamp and no ordering hint. Ballots keep their random id, no
time column and `WITHOUT ROWID`, and continue to be written in the same single D1 batch as
the participation row with nothing linking them, so "no column, ordering or timestamp
connects a ballot to a member" still holds. A Tidak Setuju or Abstain ballot is indistinguishable
from any other ballot at the storage layer — the choice is only ever read as an aggregate
count. Non-voters are never read per person: "tidak memilih" is the frozen Hak pilih total
minus the participation total, and they count as Abstain.

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

### D3: Counts only; the system states no outcome

Owner decision 2026-11-16 (supersedes W7 Q37/Q38 and the earlier winning rule). A member
of the frozen Hak pilih who did not vote by the deadline counts as Abstain. The totals
are:

- `setuju_count`: Setuju ballots.
- `tidak_setuju_count`: Tidak Setuju ballots.
- `abstain_cast_count`: ballots with choice `abstain`.
- `tidak_memilih_count`: `eligible_count - participation_count`, never below zero, with
  no per-person lookup, shown as "tidak memilih (dihitung Abstain)".
- `abstain_count`: `abstain_cast_count + tidak_memilih_count`, the total Abstain.

Setuju + Tidak Setuju + `abstain_count` equals Hak pilih (when participation does not
exceed it), so the three percentages, each a share of Hak pilih, add up to 100. The counts
come from real (non-test) ballots and the frozen Hak pilih. With no ballots cast every
eligible member is tidak memilih, so Abstain equals Hak pilih.

**The system does not decide.** There is no outcome in the payload, no terpilih /
tidak terpilih / seri computation, no "Menunggu penutupan pemungutan suara" wording, and
`singleCandidateOutcome` is deleted. Nothing is stored or audited as a decision; the
committee reads the counts and shares and draws its own conclusion. Re-election is not
modeled anywhere.

**Only after Hitung Abstain (owner decision Q193, see D9).** The `abstain_count` and
`tidak_memilih_count` rules above describe the state after Admin Voting has run Hitung
Abstain. Before it runs, `abstain_count` is `abstain_cast_count` only and
`tidak_memilih_count` is the live `eligible_count - participation_count` shown as
"N tidak memilih (belum dihitung)".

Owner decisions (2026-11-13) that still hold: Uji Coba may pick any answer; percentages
are shares of Hak pilih per scope (overall and per korda).

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
`setuju_count`, `tidak_setuju_count`, `abstain_count` (cast plus tidak memilih),
`abstain_cast_count`, `tidak_memilih_count` and the percentages `setuju_percentage`,
`tidak_setuju_percentage`, `abstain_percentage` of Hak pilih — each count's share of the
eligible members in scope (one decimal, like turnout) — overall and inside each `korda`
row. There is no `outcome` field. `tidak_memilih_count` is `eligible_count -
participation_count` clamped at zero, so the three headline counts add up to Hak pilih and
the three percentages sum to 100 (up to rounding) when Hak pilih is above zero. The `candidates` array is kept (with the single
candidate and its total) so existing consumers and the count check stay intact.
The per-korda suppression (`KORDA_MIN_BALLOTS = 10`) applies unchanged: below 10 ballots a
korda row shows turnout and "Data terlalu sedikit" and no choice breakdown (the three
counts are null there).

### D6: Uji Coba and preview mode

In Draf, Uji Coba is the committee's rehearsal of the real ballot, so while the mode is on
the test-vote flow lets the Admin Voting pick any of the three answers, Setuju, Tidak Setuju
or Abstain (owner decisions 2026-11-13 and 2026-11-16) and stores it on the test ballot (still deleted at Kunci,
still marked as test data on Dasbor). Preview mode and single candidate mode are
independent switches in Pengaturan: preview still auto-registers voters and skips the
final sync at Kunci; single candidate mode still demands exactly one candidate at Kunci.

### D7: Copy (Bahasa Indonesia, no emoji)

- Switch: "Mode kandidat tunggal" with helper text that it can only be changed while Draf
  and demands exactly one candidate at Kunci & Jadwalkan.
- Ballot answers: "Setuju", "Tidak Setuju" and "Abstain" (the owner's exact words).
- No outcome lines: the system never says Terpilih, Tidak terpilih, Seri or "Menunggu
  penutupan pemungutan suara".
- Result labels: "Setuju", "Tidak Setuju", "Abstain" (total), with the parts "Abstain
  diberikan" (cast) and "Tidak memilih (dihitung Abstain)".
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
answer: "Pilihan Anda: Setuju terhadap <nickname>", "Pilihan Anda: Tidak Setuju terhadap
<nickname>" or "Pilihan Anda: Abstain terhadap <nickname>" (the Abstain wording is back
by the owner decision of 2026-11-16).

### D9: Hitung Abstain, a manual once-only action (owner decision Q193)

Non-voters are not added to Abstain automatically. After voting closes (deadline passed
or closed early) in single candidate mode, Admin Voting presses "Hitung Abstain" in the
closed-stage actions on Pengaturan ("Tindakan tahap"). Dasbor stays read-only and links
there while the action is pending. The dialog states the number that will be added.

- **Storage:** `elections.abstain_counted_at` (TEXT, NULL until run) and
  `elections.abstain_counted_count` (INTEGER >= 0), migration `0014_abstain_counted.sql`,
  mirroring the `closing_snapshot_*` columns. The count is the frozen Hak pilih minus
  non-test participation at the time of the run: an aggregate, never per person.
- **Once only, atomic:** one D1 batch with an UPDATE gated on `abstain_counted_at IS NULL`,
  `status_lock = 'locked'` and `single_candidate_mode = 1`, plus a guarded audit insert
  that is written only when that UPDATE changed a row. A repeated or concurrent request
  changes nothing and writes no entry.
- **Refusals (HTTP 409, nothing changed or audited):** outside single candidate mode,
  before the stage is Ditutup, after publication, and when it already ran.
- **Audit:** "Hitung Abstain dijalankan", actor recorded, detail
  `{"tidak_memilih_ditambahkan": N}`; no member, ballot or choice reference.
- **Results:** `abstain_counted` and `abstain_counted_at` join the payload. Before the run
  `abstain_count = abstain_cast_count` and `tidak_memilih_count` is the live number; after
  it `tidak_memilih_count` is the stored count and `abstain_count = cast + stored`. Per
  korda, `tidak_memilih_count` is null until the run, then `eligible - used` for that
  korda, still under the 10-ballot suppression. Dasbor, Hasil and the landing card follow.
- **Umumkan gate:** `publishResults` refuses in single candidate mode until the count was
  stored, with a message to run Hitung Abstain first; the publish UPDATE repeats the gate.
- **Reset:** Kembali ke Draf clears both columns together with the other closing data.
  Uji Coba (Draf only) never touches them. Kunci & Jadwalkan leaves them NULL.

## Risks / Trade-offs

- **Mode mishandled between Draf and Kunci** — mitigated by the mode-aware readiness check
  listing its state on the Persiapan Pemilihan page and by the frozen value in the lock
  audit detail.
- **`choice` widens the ballot schema** — closed by the CHECK constraint, NULL-for-normal
  compatibility, and the secrecy argument in D2.
- **Counting non-voters as Abstain could look like per-person data** — it is only
  `eligible_count - participation_count` on frozen totals, never a join between
  participation and ballots, so the secrecy invariants of D2 still hold.

## Migration plan

1. `0011_single_candidate_mode.sql` — add the elections column (default off).
2. `0012_ballot_choice.sql` — add `ballots.choice` with the two answers of the earlier
   decision. Never edited again: it may already be applied.
4. `0014_abstain_counted.sql` — add `elections.abstain_counted_at` and
   `abstain_counted_count` (both NULL until Hitung Abstain runs).
3. `0013_ballot_choice_abstain.sql` — rebuild `ballots` so the CHECK on `choice` allows
   `setuju`, `tidak_setuju`, `abstain` and NULL. Existing rows (NULL, `setuju`,
   `tidak_setuju`) copy over unchanged.

All are repeat-safe D1 migrations applied by the documented operator flow; no data
backfill is needed (no election has run in this mode before).

## Open questions

_None._ Q35 (the switch refuses to turn on with 2+ candidates) still holds. W7 Q37 (no
Abstain) and W7 Q38 (non-voters count as Tidak Setuju, outcome after close) are superseded
by the owner's decision of 2026-11-16 (three answers, non-voters count as Abstain, the
system decides no outcome). Owner decision Q193 refines when non-voters join Abstain: only
after Admin Voting runs Hitung Abstain by hand (D9).
