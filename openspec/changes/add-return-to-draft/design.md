# Design: Kembali ke Draf

## Context

One election per site (`elections`). Stages are computed from the clock on every request
(`src/server/lib/stage.ts`): Draf (`status_lock='draft'`), then after Kunci & Jadwalkan
(`status_lock='locked'`) Terjadwal (now < opens_at), Dibuka, Ditutup, and after
"Publikasikan" (`status_lock='published'`) Diumumkan. Pengaturan (the settings area of
`admin/pemilihan.astro`) hosts the Draf-only settings; every accepted Admin Voting action
appends a hash-chained audit entry. Ballots are secret: `participation` (who, when) and
`ballots` (random id, candidate, komsat path, receipt hash, `WITHOUT ROWID`, no timestamp)
are written in one D1 batch with nothing linking them; only Uji Coba rows carry
`is_test=1`, and Kunci purges exactly those. Real votes cast after a lock are `is_test=0`,
including in Mode Pratinjau, where Pemilih auto-register and vote exactly like a real
election. The vote API refuses anything outside stage Dibuka, and
`PRIMARY KEY(election_id, member_id)` on `participation` enforces one vote per member.

Owner decisions (2026-11-13, W11) are fixed: one new state move only, in Pengaturan,
labelled "Kembali ke Draf"; preview mode allows it at any locked stage, a real election
only before voting opens; votes already cast are kept; any Admin Voting may use it after
typing a confirmation phrase; each use appends an audit entry with the stage it left and
the kept counts; on return the schedule stays, settings become editable, readiness is
recomputed, and there is no polling. Bahasa Indonesia copy without emoji.

## Goals / Non-goals

- **Goal:** let the panitia undo a premature Kunci — fix schedule, candidates or settings —
  without losing the honesty of votes already cast: kept votes stay counted and
  participation stays true.
- **Non-goal:** retracting a published (Diumumkan) election; after publication the
  election is final.
- **Non-goal:** undoing a real election once voting has opened — kept-vote semantics exist
  for Mode Pratinjau rehearsal, where resetting without losing cast votes matters.
- **Non-goal:** any new polling, WebSockets or background jobs; everything is computed on
  request and refreshed by navigation (manual refresh only).

## Decisions

### D1: One server function, one route, the existing admin guard

`returnToDraft(db, now, phrase, actor)` in `src/server/election/lifecycle.ts`, exposed as
`POST /api/election/return-to-draft` behind the same Admin Voting session guard as the
other lifecycle routes. The phrase is re-checked on the server: comparison is
case-insensitive after collapsing whitespace, consistent with the existing nickname
confirmation pattern; anything else is HTTP 400 and records nothing. The UI never trusts
the button alone — the dialog is a speed bump, the server is the gate.

The function runs as a single D1 batch: the `UPDATE elections … WHERE id=? AND
status_lock='locked'` guard makes a concurrent double-submit a 409 ("Pemilihan sudah
Draf" / "Pemilihan bukan Terjadwal/Dibuka/Ditutup" per stage), mirroring how
`lockElection` and `publishResults` protect themselves. Stage is computed from the clock
at request time; no cron, no polling.

### D2: Stage matrix — preview permissive, real conservative, published final

| Stage | Mode Pratinjau | Pemilihan riil |
| --- | --- | --- |
| Draf | refused (already Draf) | refused (already Draf) |
| Terjadwal | allowed | allowed (now < opens_at) |
| Dibuka | allowed | refused (voting opened) |
| Ditutup | allowed | refused |
| Diumumkan | refused | refused |

Guard: `status_lock='locked' AND (preview_mode=1 OR now < opens_at)`. A real election at
Terjadwal has zero ballots by construction (voting requires stage Dibuka), so the kept
votes, and with them every kept-vote consequence below, are a Mode Pratinjau concern; the
spec states the rules once, for both modes, because the server does not branch on them.

**Diumumkan is excluded everywhere (owner recommendation adopted).** After results are
announced the election is public record: the receipt board lists hashes against the
closing snapshot and members may have acted on the outcome. Silently retracting that into
an editable Draf would let a posted result quietly change. If a published election truly
must be rerun, that is a new, explicit decision for the owner — out of scope here.

### D3: What is cleared, what is kept

Cleared on return (all stage data of the abandoned locked run):

- `status_lock` → `'draft'`.
- `frozen_hak_pilih`, `frozen_at` → NULL (the old freeze is meaningless once settings are
  editable; the next Kunci freezes anew).
- `closed_early_at`, `closing_snapshot_hash`, `closing_snapshot_at` → NULL. These describe
  the abandoned closing: `stage()` checks `closed_early_at` before the clock, so leaving
  it set would make a re-locked election instantly Ditutup; the snapshot hash anchors the
  receipt board of the aborted close and must not anchor a different run. The audit
  entries of the abandoned run stay in the chain — audit is append-only.

Kept (preparation data, not run data): title, description, `opens_at`/`closes_at`
(schedule kept per owner decision), `preview_mode`, `single_candidate_mode` (constrained
by D5), `allow_admin_voting`, the `voters` table and `pemilih_last_sync`. The stale roll
is harmless: readiness reports the last sync as usual, and the next Kunci always runs a
fresh full sync in a real election (existing behavior), so Hak pilih is frozen anew.
Kept votes: `participation`, `ballots` and receipt hashes with `is_test=0` are untouched.

Readiness is recomputed from the elections row on the next page load. Because the
schedule is kept, a real election that returns at Terjadwal usually passes `opens_future`
immediately and can be re-locked; if the panitia edits the schedule first, the checks
follow as today.

### D4: Kept votes and the next Kunci

Rules, stated in the spec and already true of the code except where noted:

1. A member who voted in the earlier open keeps their `participation` row, so the
   one-vote-per-member constraint still refuses a second ballot after the next Kunci.
2. Kept ballots are counted in results regardless of the fresh roll: tally queries read
   ballots and participation directly and never join them to `voters`, so no roll rebuild
   can erase a cast vote.
3. The next Kunci purges only `is_test=1` rows (existing behavior) and freezes Hak pilih
   from the fresh roll — `frozen_hak_pilih` is written anew.
4. Kept receipts stay verifiable: the hash board lists receipt hashes after the next
   close exactly as before, including hashes from the earlier open.

Consequence stated honestly: a member who voted earlier and is absent from the fresh roll
keeps a counted ballot while the denominator (new Hak pilih) shrank, so participation or
a candidate's share can exceed 100 percent. The numbers are reported as they are; the
dialog and audit detail name the kept counts so the panitia knows why.

### D5: Mode kandidat tunggal frozen while non-test ballots exist

`setSingleCandidateMode` refuses **both directions** while `ballots` holds `is_test=0`
rows for the election: the switch is shown read-only in Pengaturan with a message naming
the kept ballots, and the server refuses with 409 before any write.

Why both directions: a ballot's meaning is fixed when it is cast. Under the mode, a
ballot stores a Setuju/Tidak Setuju `choice`; turning the mode off would leave stored
choices with no ballot question to attach them to. Turning it on with kept candidate-pick
ballots (`choice` NULL) would drag those ballots into a Setuju/Tidak Setuju tally they
never answered. Rewriting stored ballots into the other shape is impossible without
linking ballots to voters — exactly what ballot secrecy forbids — so the only safe rule
is: no change while kept ballots exist. The rule is symmetric and has no per-direction
edge cases to get wrong in a hurry.

`is_test=1` ballots never lock the switch: Uji Coba is rehearsal data purged at the next
Kunci, and after a return there are no test rows left from before anyway (the previous
Kunci purged them), so the panitia can keep rehearsing without losing the switch.

### D6: Candidate protection while ballots reference them

`ballots.candidate_id` references `candidates(id)` (enforced FK), so a plain delete of a
referenced candidate already fails at the storage layer — the change adds an explicit
check so the panitia gets a clear 409 ("Kandidat tidak dapat dihapus: N suara tersimpan
menunjuk kandidat ini") instead of a constraint error. "Replaced" means changing the
underlying member: `updateCandidate` resolves a new member reference, and while kept
ballots point at the candidate the member identity is frozen too — the ballots were cast
for that person. Other edits stay open: name, nickname, description, intro, nomor urut
(under the existing mode rules) and all rendering concerns, because they do not change
who the ballots were cast for.

Known limitation, accepted: if a kept-ballot candidate's member later joins Admin
Voting, readiness (`admin_candidate`) blocks the next Kunci and the candidate cannot be
replaced while ballots exist. The escape hatch is the existing admin management — remove
that member from the Admin Voting list — not a spec exception.

### D7: Audit entry and refused attempts

Each accepted use appends one entry through the normal `buildAuditInsert` hash chain
(the same path as every Admin Voting action): action **"Pemilihan dikembalikan ke
Draf"**, actor = the Admin Voting who pressed it, detail JSON `{"stage_before":
"scheduled|open|closed", "preview_mode": true|false, "kept_ballots": N,
"kept_participation": N}`. The counts are read inside the return batch's transaction
window, so they match the rows the batch keeps. Refused attempts — wrong phrase, wrong
stage, non-Admin session, already Draf — record nothing, matching every existing action
(refusals raise before the audit insert).

### D8: Copy (Bahasa Indonesia, no emoji)

- Button: **"Kembali ke Draf"**, in Pengaturan, visible only when the stage matrix
  allows it.
- Helper text: "Kembalikan pemilihan ke Draf untuk mengubah pengaturan. Suara yang
  sudah masuk tetap tersimpan."
- Dialog: states the consequence and asks for the phrase — "Tindakan ini mengembalikan
  pemilihan ke Draf. Suara yang sudah masuk (N suara) tetap tersimpan dan tidak dapat
  dicabut. Ketik KEMBALI KE DRAF untuk mengonfirmasi." (without the count sentence when
  no ballots are kept).
- Success feedback: "Pemilihan kembali ke Draf. N suara tetap tersimpan." (without the
  count sentence when zero).
- Server refusals: wrong phrase "Frasa konfirmasi tidak sesuai."; real election after
  open "Kembali ke Draf hanya tersedia sebelum pemungutan suara dibuka."; Diumumkan
  "Hasil sudah diumumkan; pemilihan tidak dapat kembali ke Draf."; already Draf
  "Pemilihan sudah berada di Draf."; mode switch with kept ballots "Mode kandidat
  tunggal tidak dapat diubah: N suara tersimpan harus tetap dihitung dengan aturan yang
  sama."; candidate delete with ballots "Kandidat tidak dapat dihapus: N suara tersimpan
  menunjuk kandidat ini."; candidate replace with ballots "Kandidat tidak dapat
  diganti: N suara tersimpan menunjuk kandidat ini.".
- Wording: "Admin Voting" for committee members, "Pemilih" for voters, stage labels as
  today (Draf, Terjadwal, Dibuka, Ditutup, Diumumkan).

## Risks / Trade-offs

- **Panitia expects a clean slate** — kept votes surprise them. Mitigated by the dialog
  naming the kept count before confirmation, the success feedback repeating it, the audit
  detail recording it, and every constrained action refusing with a message that names
  the kept ballots.
- **Participation above the new Hak pilih after a roll change** — a stated consequence
  of keeping ballots and freezing Hak pilih anew (D4); the numbers are reported as they
  are and the design forbids silently dropping kept ballots, which would break receipt
  honesty.
- **Preview Ditutup returned with `closed_early_at` left behind** — closed by D3: the
  return clears the early-close and snapshot fields in the same batch, and a test pins
  that a re-locked election reopens instead of sitting in Ditutup.
- **Phrase check too lenient (case-insensitive)** — consistent with the nickname
  confirmation the product already uses; the phrase is a speed bump against slips, not a
  secret, and the server-side stage guard carries the real protection.

## Migration plan

None. The action writes only existing `elections` columns; no migration is added and no
backfill is needed (no election has returned to Draf before).

## Open questions

_None._ The earlier questions are owner decisions (2026-11-13, W11): the action lives in
Pengaturan; preview allows any locked stage while a real election allows only before
voting opens; votes are kept with the stated consequences; any Admin Voting with the
typed phrase; audit with stage and kept counts; and Diumumkan excluded (the brief's
recommendation, adopted as the decision).
