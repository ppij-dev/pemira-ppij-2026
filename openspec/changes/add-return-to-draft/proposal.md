# Proposal: Kembali ke Draf (return a locked election to Draf)

## Why

After "Kunci & Jadwalkan" the only way back to preparation was a database edit: a panitia
that notices a wrong schedule, a typo in a candidate, or a misconfigured rehearsal right
after locking is stuck. Owner decision (2026-11-13, W11): add one explicit action,
**"Kembali ke Draf"**, in Admin Voting > Pemilihan (Pengaturan) — the only new state move.
It is allowed while the election is locked in Mode Pratinjau (Terjadwal, Dibuka or Ditutup)
and in a real election only before voting opens (now < opens_at, stage Terjadwal, so with
zero ballots); it is refused once results are Diumumkan, even in preview mode, because
announced results are final public record. Votes already cast are **kept** — participation,
ballots and receipts stay — and the spec pins the consequences: a member who voted cannot
vote again after the next Kunci; candidates referenced by ballots cannot be deleted or
replaced; the next Kunci freezes Hak pilih anew without erasing earlier votes; and the
single candidate mode switch cannot change while kept ballots exist. Ballot secrecy,
receipts, the audit hash chain and manual refresh are unchanged.

## What Changes

- **New Pengaturan action "Kembali ke Draf".** Shown on the Persiapan Pemilihan page
  (Pengaturan) while the election is locked and the stage allows it; any Admin Voting may
  use it after typing the confirmation phrase **"KEMBALI KE DRAF"** in a dialog (the
  server re-checks the phrase; case-insensitive, whitespace-collapsed, consistent with the
  nickname confirmation pattern). Refused otherwise — wrong phrase, non-Admin session,
  wrong stage — with nothing recorded but the refusal response.
- **Stage rules.** Allowed: preview mode at Terjadwal, Dibuka or Ditutup; real election at
  Terjadwal only (now < opens_at, therefore zero ballots). Refused: Draf (nothing to
  return), any real election after voting opened, and **Diumumkan in every mode** (owner
  recommendation adopted: after publication the election is final).
- **State reset.** `status_lock` returns to `'draft'`; `frozen_hak_pilih`, `frozen_at`,
  `closed_early_at`, `closing_snapshot_hash` and `closing_snapshot_at` are cleared (the
  closed-early and snapshot fields describe the abandoned closing and must not make a
  re-locked election instantly Ditutup). Schedule, title, description, Mode Pratinjau,
  Mode kandidat tunggal and Izinkan Admin Voting memilih stay; Pengaturan becomes editable
  again; readiness is recomputed on the next load (manual refresh only, no polling).
- **Kept votes.** Participation, ballots and receipt hashes of the earlier open are kept
  untouched (nothing links them, so secrecy is unchanged). Members who already voted stay
  marked as voted and cannot vote again after the next Kunci; kept receipts stay
  verifiable. At the next Kunci & Jadwalkan the roll is rebuilt and Hak pilih is frozen
  anew, kept ballots are counted regardless of the fresh roll, kept participation rows
  stay, and only Uji Coba (test) data is purged as today.
- **Candidate protection while ballots reference them.** A candidate that kept ballots
  point at cannot be deleted and cannot have its member replaced; other edits (name,
  nickname, nomor urut rules, description, intro, color) stay allowed.
- **Mode kandidat tunggal frozen while kept ballots exist.** The Draf-only switch refuses
  both directions while non-test ballots exist, because a ballot's meaning
  (candidate pick vs Setuju/Tidak Setuju) is fixed when it is cast and cannot be
  re-interpreted without breaking anonymity. Uji Coba test votes never lock the switch.
- **Audit.** Each accepted use appends one audit entry through the normal hash-chained
  path — "Pemilihan dikembalikan ke Draf" — recording the actor, the stage it left
  (Terjadwal/Dibuka/Ditutup), whether Mode Pratinjau was on, and the kept ballot and
  participation counts. Refused attempts record nothing, like every existing action.

## Capabilities

### New Capabilities

_None — the action lives inside existing capabilities._

### Modified Capabilities

- `election-lifecycle`: the Pengaturan action with its stage matrix, the typed-phrase
  confirmation, the state reset on return, kept votes surviving the next Kunci with Hak
  pilih frozen anew, and the single-candidate-mode switch frozen while kept ballots exist.
- `voting-and-receipts`: a member who voted in the earlier open cannot vote again after
  the next Kunci; kept ballots, participation rows and receipt hashes stay and stay
  verifiable; secrecy untouched.
- `candidate-management`: candidates referenced by kept ballots cannot be deleted or have
  their member replaced; other edits remain allowed.
- `audit-log`: one hash-chained audit entry per accepted "Kembali ke Draf" with the stage
  left and the kept counts; refused attempts record nothing.

## Impact

- **DB:** no migration — the action only writes existing `elections` columns
  (`status_lock`, `frozen_hak_pilih`, `frozen_at`, `closed_early_at`,
  `closing_snapshot_hash`, `closing_snapshot_at`).
- **Server:** `src/server/election/lifecycle.ts` (new return-to-draft function with stage
  guards and kept counts), `src/server/election/routes.ts` (POST route under the existing
  Admin session guard), `src/server/election/candidates.ts` (delete/replace guards reading
  kept ballots), `src/server/election/lifecycle.ts` `setSingleCandidateMode` (refusal while
  non-test ballots exist). Kunci (`lockElection`) needs no change: it already purges only
  test data and freezes from the fresh roll.
- **UI:** `src/pages/admin/pemilihan.astro` — the "Kembali ke Draf" button in Pengaturan
  with its stage visibility rules and the confirmation dialog (typed phrase, kept-votes
  warning), result feedback with kept counts; manual refresh only.
- **Tests:** `test/election-lifecycle.test.ts` (stage matrix, phrase, reset, re-Kunci with
  kept votes, switch lock), `test/vote-api.test.ts` (cannot vote twice across a return and
  re-lock), `test/candidates.test.ts` (delete/replace guards), `test/audit-chain.test.ts`
  or the existing audit tests (entry content and hash chain).
- **Risk:** a panitia misunderstanding kept votes as reset votes. Mitigated by the dialog
  warning naming the kept count, the audit detail carrying the counts, and refusal messages
  on the constrained actions (candidate delete/replace, mode switch) that name kept
  ballots. A member dropped from the fresh roll keeps their ballot counted (stated rule),
  which can push participation above the new Hak pilih — the numbers are reported as they
  are, and the design documents this consequence.
- **No change** to ballot secrecy mechanics, receipt codes, the receipt board, eligibility
  rules, the Kunci & Jadwalkan flow itself, or polling-free behavior.
