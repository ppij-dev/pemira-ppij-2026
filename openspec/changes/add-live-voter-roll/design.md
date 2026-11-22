# Design: Tidak Membekukan DPT (live voter roll) and a live public turnout stat

## Context

One election per site; stages Draf → Terjadwal → Dibuka → Ditutup → Diumumkan are
computed from the clock on every request, with no cron and no background jobs (hard rule
"stage is computed from the clock"). Kunci & Jadwalkan runs a final full Service API sync
and freezes the roll: `elections.frozen_at` / `frozen_hak_pilih` are set, "No sync SHALL
run after lock", and `authorizeVoter` refuses anyone not on the frozen roll
(`not_in_roll`) and refuses everything while `frozen_at` is NULL (`not_locked`). The
`voters` table stores one row per roll member (member_id, name, nickname, komsat_path,
status, synced_at, member_number, category, can_vote) and is written only by syncs.
`syncPemilih` already supports incremental `changed_since` syncs driven by the
`pemilih_last_sync` watermark (the portal's `as_of`, never the local clock) and full
rebuilds; each run writes one `pemilih_sync` audit entry. The Service API client paginates
`/v1/service/members` with a 10 s per-request timeout and a cached token; there is no
per-member lookup endpoint available to this system. Dasbor refreshes by button; the site
has no polling and no WebSockets (hard rule "manual refresh only"). The closing audit
snapshot is finalized on the first read after close: `ensureClosingSnapshot` in
`board.ts` CAS-guarded on `closing_snapshot_hash IS NULL` with an audit-tip guard, and
Tutup Sekarang writes the same fields inside its own batch.

Owner decisions (2026-11-19) are fixed: the "Tidak Membekukan DPT" switch with the
`single_candidate_mode` lifecycle (Draf-only, audited, frozen at Kunci); live two-way
eligibility at vote time; Hak pilih live while open and saved at close with the saved
number used everywhere afterwards; the public landing stat with a live update mechanism
(polling vs WebSocket is explicitly asked); the stat labels "Jumlah Pemilih" and "Suara
Masuk" (Q202); a clear hook so the direct-invite change can add +1 Hak pilih per active
invite link; copy in Bahasa Indonesia, no emoji.

## Goals / Non-goals

- **Goal:** with the switch on, the roll follows the portal during voting in both
  directions, the closing denominator is fixed exactly once, and the public sees two live
  aggregate numbers — with the switch off, byte-for-byte today's behaviour.
- **Non-goal:** any change to ballot secrecy, receipts, participation/ballot storage, the
  confirmation sheet, Uji Coba, or the multi-candidate ballot.
- **Non-goal:** a real-time push channel for anything other than the landing stat. Dasbor
  and results keep manual refresh; no WebSocket server, no Durable Objects, no cron.
- **Non-goal:** a per-member portal lookup. The Service API contract available to this
  system has no single-member read; the design must work with list + `changed_since`.

## Decisions

### D1: Switch column on `elections`, frozen at Kunci

`elections.live_voter_roll INTEGER NOT NULL DEFAULT 0 CHECK (live_voter_roll IN (0, 1))`
(migration `0015_live_voter_roll.sql`) — the same pattern as `preview_mode` and
`single_candidate_mode`. The lifecycle layer already refuses setting writes when
`status_lock != 'draft'`, which was the whole "frozen at Kunci" rule; the toggle endpoint
mirrors the single-candidate-mode toggle (PUT route, one audit
entry per accepted toggle: "Tidak Membekukan DPT diaktifkan" / "Tidak Membekukan DPT
dinonaktifkan"). Amended by the owner decision of 2026-11-22 (D10 below): after Kunci
the switch is no longer strictly read-only — it can be turned off while the election is
locked and running, which freezes the roll. The lock audit detail records
`live_voter_roll: true/false` beside
`single_candidate_mode`, so the frozen value is provable from the audit chain. The switch
is independent of `single_candidate_mode` and `preview_mode`; combinations are allowed.

### D2: Kunci in live mode locks without freezing

While the switch is on, a successful Kunci & Jadwalkan sets `status_lock='locked'` and
leaves `frozen_at` and `frozen_hak_pilih` NULL. It still runs the final full Service API
sync (`syncPemilih` with `full: true`): the live view must start complete, and a failed
full read still blocks locking exactly as today, which doubles as a portal-reachability
proof at lock time. The lock audit detail additionally records the starting view count
(`portal_view_count`). Test votes are still deleted, colors still assigned — every other
lock side effect unchanged. `authorizeVoter`'s `not_locked` refusal (`frozen_at IS NULL`)
is skipped only when `live_voter_roll = 1`; with the switch off the refusal is unchanged.
The `adopt-fork-improvements`/`enforce-regular-member-category` rule "No sync SHALL run
after lock" is deliberately amended by this change for this mode only: the automatic
refreshes in D4 replace it.

### D3: The `voters` table becomes the live portal view

No new mirror table. In live mode the existing `voters` rows are the live view; the
frozen roll and the live view are never needed simultaneously (the switch is frozen at
Kunci), so one table carries both meanings and every consumer of the roll (Pemilih page,
per-korda eligible counts, live Hak pilih) keeps working. Rows keep their existing shape;
`synced_at` doubles as the per-row freshness stamp.

**Refresh mechanics.** A helper `ensurePortalViewFresh(db, cfg, now)` runs before the
roll lookup in `authorizeVoter` (live mode, stage Terjadwal or Dibuka):

It is also the single refresh for every read that shows Hak pilih — the public
`/api/turnout` endpoint, the server-rendered landing strip, Dasbor, the Pemilih page and
the results — through one wrapper, `refreshPortalViewForRead(db, cfg, now)`. Those readers
only refresh while they would show the live count: a read in Terjadwal or Dibuka in live
mode outside Mode Pratinjau. Reads wait at most `PORTAL_VIEW_READ_WAIT_MS` (1 s) for a
refresh in progress and otherwise answer from the last known view; the refresh keeps
running in the isolate so the next read shows it, and a refresh that never lands only
costs another attempt (idempotent UPSERTs against the same watermark). Without this, the
denominator on the landing page, Dasbor, the Pemilih page and the results stayed at the
Kunci snapshot until a member voted, which is exactly what the owner saw in rehearsal.

Mode Pratinjau wins inside the helper too (D3 precedence below), so a rehearsal election
never refreshes from the portal even when the switch was left on.

- If the watermark `pemilih_last_sync` is older than **TTL = 30 s**, run one incremental
  `changed_since` sync. It reuses `syncPemilih`'s incremental path (same eligibility
  rule: ACTIVE + `can_vote = 1` in, everyone else out) with a new option that suppresses
  the `pemilih_sync` audit entry — automatic refreshes must not flood the hash chain (see
  D8). The watermark is advanced to the portal's `as_of` exactly as today.
- **Failure cooldown:** if the last refresh attempt failed less than 15 s ago, skip the
  refresh and serve the current view. This bounds the added vote latency to at most one
  10 s-timeout portal attempt every 15 s across voters, instead of stacking timeouts on
  every vote during an outage. The cooldown lives in isolate memory; Workers may run
  several isolates, so occasional duplicate refreshes can happen — they are idempotent
  UPSERTs against the same watermark, so they are harmless, only slightly wasteful.
- **Portal down (timeout, 5xx, no grant): stale-while-unavailable.** Serve the last known
  view regardless of its age: a member present and eligible in it may vote, a member
  absent or ineligible in it is refused. Rationale: the alternative (fail-closed on
  refresh failure) makes a portal outage stop the whole election, recreating exactly the
  dependency the frozen roll exists to remove; the stale window is bounded by TTL + outage
  length, and the fail-closed rule for absence means an outage never widens who may vote —
  it can only delay a removal by the outage's length. This behaviour was accepted by the
  owner (open question 2 answered as recommended, 2026-11-19).
- **Newly registered member:** appears in the view on the next successful refresh —
  "immediately" therefore means within one refresh cycle, worst case about TTL + refresh
  duration (≈ 30–45 s). A sub-second guarantee is impossible without a per-member portal
  endpoint, which the Service API does not offer to this system.
- **Lost eligibility:** the same refresh removes the row or stores `can_vote = 0` /
  non-ACTIVE status; the next vote-time check refuses with the existing messages
  (`not_active`, `not_regular_member`) — the rules are read from the view row, unchanged.
- **Votes already cast stay:** participation and ballots are never touched by view
  changes; `count_matches` stays true.
- **Scope and session rules unchanged:** affiliation-in-scope and session checks run
  before the view lookup, exactly as today.

**Mode Pratinjau precedence.** When `preview_mode = 1`, today's flow is kept byte-for-byte
(`autoRegisterPreviewVoter` for rehearsal votes in Draf). The live check applies only when
`preview_mode = 0 AND live_voter_roll = 1`. The two modes are never both interpreted; a
preview election keeps rehearsing against auto-registered rows even if the switch was
left on.

### D4: Hak pilih live while open, saved once at close

**Live figure.** While `live_voter_roll = 1` and the stage is Dibuka, Hak pilih is
computed from the view: `COUNT(voters WHERE can_vote = 1)` minus Admin Voting rows when
the participation setting excludes them — the same formula the Draf fallback and the Kunci
freeze already use. The live Hak pilih computation lives in exactly one helper
(`liveHakPilih`) so every consumer agrees and the direct-invite change has a single place
to add its term (see D7). Consumers resolve the denominator once, in one place in `results/queries.ts`:

- switch off → `frozen_hak_pilih` (today's path, untouched);
- switch on, Dibuka → the live count;
- switch on, Ditutup/Diumumkan → `closing_hak_pilih` (the snapshot below).

**Snapshot definition (no cron).** The closing stage is computed from the clock, so there
is no instant at which "close" happens. The snapshot is therefore defined declaratively:
`closing_hak_pilih` holds the live count taken at finalization time, and finalization is
the first read that observes the election closed. Concretely, `ensureClosingHakPilih(db,
now)` in `board.ts`, beside `ensureClosingSnapshot`:

- Guards on `closing_hak_pilih IS NULL AND status_lock = 'locked' AND (closed_early_at IS
  NOT NULL OR julianday(closes_at) <= julianday('now'))` — written only in live mode
  (`live_voter_roll = 1`); with the switch off the columns stay NULL forever and nothing
  is written.
- One D1 batch: the guarded UPDATE plus a tip-guarded system audit entry "Hak pilih akhir
  disimpan" with detail `{"hak_pilih": N}` — the same CAS + audit-tip pattern as
  `ensureClosingSnapshot`, so concurrent first reads produce exactly one winner and one
  audit entry; losers read the stored value.
- Callers: `getPublicBoard`, the results/dashboard queries, the Hitung Abstain state
  read, and the public turnout endpoint — anything that reads Hak pilih after close
  finalizes first, so no consumer can see "closed but unsaved".
- **Tutup Sekarang** computes and stores the snapshot inside `closeEarly`'s existing
  batch (the same place it writes `closing_snapshot_hash`), with the same audit entry; the
  first-read path then finds it set and returns immediately.
- **Umumkan and Hitung Abstain use the saved number.** `getAbstainCount` (single candidate
  mode) computes its pending count from `closing_hak_pilih` instead of
  `frozen_hak_pilih` when the snapshot exists; it only runs after close, so the snapshot
  always exists by then. `publishResults` needs no extra gate: the first read that led
  there already finalized. Dasbor, Hasil, the landing result card and the turnout
  endpoint all read the same resolved denominator.

**Edge: the live count can shrink below Suara Masuk mid-vote** (members removed while
their votes remain). Display the numbers as-is, clamp `unused_count` at zero and cap
percentages at 100 (the clamp already exists); the closing snapshot resolves the final
denominator, so published figures never show the artifact (accepted as recommended,
2026-11-19).

### D5: Public turnout stat on the landing page

**Labels.** "Jumlah Pemilih" for Hak pilih and "Suara Masuk" for participation (owner
decision Q202, 2026-11-19). "Jumlah Pemilih" is the term the site already uses for the
roll, and "Suara Masuk" matches the participation figure the receipt board already shows
after close.

**Placement and visibility.** A compact two-figure strip rendered above the schedule
panel ("Jadwal pemungutan") on `index.astro`, shown in every election — both switch states
— from Terjadwal onwards: Terjadwal, Dibuka, Ditutup and Diumumkan; hidden only in Draf
(owner decision Q205). In Terjadwal, Jumlah Pemilih comes from the synced view and Suara
Masuk shows 0. The strip shows counts
only: no candidate figures, no choices, no korda breakdown, no per-person anything. The
existing rule "before Diumumkan, candidate vote counts are visible only to Admin Voting"
is unchanged — these two aggregates are the only new public numbers, and they are
explicitly permitted by the owner's decision.

**Endpoint.** `GET /api/turnout`, public (like `/api/votes/board`), returning
`{ stage, eligible_count, votes_count, updated_at }` — `votes_count` is the non-test
participation count (equal to the ballot count by the count invariant), `eligible_count`
the resolved denominator of D4, `updated_at` the response time. Counts only; it refuses
nothing and exposes nothing else. Lightly rate-limited with the existing `rate_limits`
pattern (per IP, generous enough for polling: 30/min, same as receipt checks).

**Update mechanism: short polling over WebSocket/Durable Objects.** The client polls the
endpoint every **15 s** while Dibuka and every **60 s** otherwise (Terjadwal, Ditutup,
Diumumkan — the number can change once more when the snapshot lands), pauses on
`visibilitychange` hidden tabs, and applies
a small jitter so viewers do not synchronize. Changes animate with a number-flip
transition in the browser. The deployment runs on the Workers Paid plan (owner decision
Q204), which settles the polling budget. Comparison for ~300 voters:

- **Short polling (recommended, chosen).** One tiny endpoint; two indexed COUNT queries per hit;
no new infrastructure; works unchanged on any plan; degrades to a stale number, never to a
broken page. Load: worst case 300 viewers × 4 req/min ≈ 20 req/s while Dibuka — trivial
for the Workers Paid plan the owner is on (Q204). Latency: a new vote shows within one
interval, which the flip animation makes feel deliberate rather than laggy.
- **WebSocket / Durable Objects.** Push gives sub-second updates — unnecessary for a
counter. Costs: DOs require a Workers paid plan and billed duration; hibernation and room
per-election management add real complexity; the vote batch would need to publish to the
DO, coupling the secrecy-critical write path to a fan-out service; reconnect/heartbeat
logic and a second failure mode appear. The project's hard rule forbids WebSockets today
for exactly these reasons. Revisit only if the owner later demands sub-5-second updates.

This is a deliberate amendment of the "manual refresh only / no polling" rule, limited to
this one public stat; Dasbor and results keep button refresh, and no other page polls.

### D6: Payload and UI surfaces

`ResultsPayload`/`DashboardPayload` gain `live_voter_roll: boolean`; `eligible_count`
carries the resolved denominator of D4. Dasbor shows a small note while the mode is on —
"Roll mengikuti portal (tidak dibekukan)" — so nobody mistakes live figures for a frozen
roll; the Pemilih page shows the view's last refresh time (the watermark time, JST). The
turnout strip renders from the endpoint data; after Diumumkan it keeps showing the same
saved figures (polling can stop once the stage is Diumumkan and the numbers are final).

**Stale-view banner on Dasbor (owner accepted, 2026-11-19).** While the switch is on and
voting is open, Dasbor shows a warning banner once the portal view has not refreshed
successfully for more than 5 minutes, naming the last refresh time — so a long portal
outage is visible to the committee without the system stopping anything (stale-while-
unavailable keeps working underneath). The banner disappears on the next successful
refresh.

### D7: Hook for the direct-invite change

Both Hak pilih producers — the live count in D4 and the closing snapshot — funnel through
one aggregation helper (`liveHakPilih`, written once and used everywhere) and one snapshot
function (close). The direct-invite change adds its "+ live non-cancelled links" term
exactly there: live Hak pilih = portal-eligible members + live non-cancelled invite
links, and the snapshot must include the links active at
finalization time. To keep that addition single-point, the snapshot's audit detail is
already shaped as a JSON object, so a future `{"hak_pilih": N, "portal": P, "invite": M}`
part split needs no format change. Coordination notes, agreed across worktrees:
migrations `0015` and `0016` are claimed by this change — the direct-invite change starts
at `0017`; this change does not create any invite table, column or endpoint; the
direct-invite change alone decides what "active" means for its links and supplies the
count function this design leaves as the documented extension point.

### D8: Audit entries

- Toggle: one Admin Voting entry per accepted toggle ("Tidak Membekukan DPT
  diaktifkan/dinonaktifkan"), as today for switches.
- Lock: the existing "Pemilihan dikunci" entry records `live_voter_roll` and
  `portal_view_count` in its detail.
- Close: one system entry "Hak pilih akhir disimpan" with `{"hak_pilih": N}` from the
  snapshot batch (early close included).
- Automatic refreshes: **no audit entries.** At one refresh per 15 s across voters the
  chain would grow by hundreds of system entries per hour for bookkeeping, and each entry
  weakens the signal-to-noise of the audit view. The refresh watermark time is visible on
  the Pemilih page instead. Manual syncs (including any future manual refresh button)
  keep their audited `pemilih_sync` entry. (Silent refreshes accepted by the owner,
  2026-11-19.)

### D10: Freeze mid-vote with the same switch (owner decision 2026-11-22)

The committee may need to stop following the portal in the middle of voting (the owner's
case: voting 23–25 Nov with the switch on, frozen by hand on the 24th). No new button:
while the election is locked and running (stage Terjadwal or Dibuka, never after close,
never in Mode Pratinjau), turning the existing "Tidak Membekukan DPT" switch in
Pengaturan OFF means *Bekukan DPT sekarang*:

- **Confirmation dialog.** The page opens a dialog that states the current Hak pilih
  (the live count from the same `resolveHakPilih` helper every other consumer uses) and
  that the action is one-way. Nothing is sent until the Admin Voting confirms.
- **Final portal refresh.** The freeze first runs one full `syncPemilih` through the same
  path as Kunci & Jadwalkan. A failed sync refuses the freeze with a clear error and
  leaves the roll live — a freeze from a stale view is exactly the dependency the mode
  exists to avoid, so the portal must be reachable and current at freeze time.
- **One guarded batch.** Success writes `frozen_at`, `frozen_hak_pilih` (the Kunci
  formula: eligible roll rows minus excluded Admin Voting) and `live_voter_roll = 0` in
  one UPDATE guarded on stage, switch state, NULL `frozen_at` and preview-off, plus a
  tip-guarded audit entry "DPT dibekukan" with detail `{frozen_hak_pilih, frozen_at,
  stage_before}` — the same CAS + guarded-audit pattern as `countAbstain`, so a refused
  request records nothing and a concurrent double-freeze happens exactly once.
- **One-way.** There is no unfreeze: `live_voter_roll = 0` ends automatic refreshes for
  the rest of the election (D3's guard already skips non-live elections), Hak pilih comes
  from `frozen_hak_pilih` through the existing frozen branch of `resolveHakPilih`,
  `authorizeVoter` checks the frozen roll with no refresh, and invite links keep flowing
  through the same `directInviteTerm` helper as any frozen roll. Kembali ke Draf already
  clears `frozen_at`/`frozen_hak_pilih`, so the switch is usable again after a return.
- **UI state.** While locked after the freeze, the switch shows OFF and disabled with the
  note "Daftar Pemilih dibekukan pada <waktu JST>"; turning it back on is only possible
  in Draf, as before. Dasbor swaps its live note for a frozen-roll note; the Pemilih page
  names the freeze time.

### D9: Copy (Bahasa Indonesia, no emoji)

- Switch: "Tidak Membekukan DPT" (the owner's exact words), helper text: only switchable
  on while Draf; while on, the roll follows the portal during voting (new eligible members
  can vote at once, lost eligibility blocks voting), Hak pilih is fixed when voting
  closes, and turning the switch off mid-vote freezes the DPT now, one-way (D10).
- Toggle audit actions: "Tidak Membekukan DPT diaktifkan" / "Tidak Membekukan DPT
  dinonaktifkan"; mid-vote freeze audit action: "DPT dibekukan" (D10).
- Freeze dialog: title "Bekukan DPT sekarang"; body states the current Hak pilih, the one
  final portal refresh, and that the action is one-way and cannot be undone; confirm
  button "Bekukan DPT sekarang" (D10).
- Frozen switch note in Pengaturan: "Daftar Pemilih dibekukan pada <waktu JST>." (D10).
- Final-sync refusal: "Sinkronisasi final gagal: <penyebab>" — the same wording as a
  failed Kunci, so the committee reads one familiar message (D10).
- Landing strip labels: "Jumlah Pemilih" and "Suara Masuk", with a subline "Diperbarui
  otomatis setiap 15 detik." while Dibuka.
- Dasbor note: "Roll mengikuti portal (tidak dibekukan). Hak pilih ditetapkan saat
  pemungutan suara ditutup."
- Pemilih page: "Terakhir diperbarui dari portal: <waktu JST>".
- Closing audit entry: "Hak pilih akhir disimpan".
- Vote refusals keep today's messages; the live path reuses `not_in_roll`,
  `not_active` and `not_regular_member` unchanged.

## Risks / Trade-offs

- **Portal availability becomes a voting-path dependency in this mode** — mitigated by
  stale-while-unavailable (an outage can delay a removal or a newly-eligible member's
  first vote by the outage length, but never revoke an already-cast vote and never widen
  eligibility), the 15 s failure cooldown bounding latency, and the closing snapshot which
  removes the portal from the denominator at close.
- **Staleness window (~30–45 s)** for both directions of eligibility change — inherent to
  list+`changed_since` without a per-member endpoint; surfaced honestly in the switch
  helper text rather than promised as instant.
- **Duplicate refreshes across isolates** — idempotent UPSERTs against one watermark;
  slightly wasteful, never inconsistent.
- **Live denominator shrink below Suara Masuk** — displayed as-is with clamps; resolved by
  the snapshot; the audit entry preserves the final number for recounting.
- **Two new public aggregates** — counts only, and the same numbers are already public
  after close on the receipt board; the owner's decision extends their visibility to the
  open stage, nothing else becomes public earlier.
- **Migration interaction with the direct-invite worktree** — both branches base on the
  same main; the numbering claim (0015–0016 here, 0017+ there) is recorded in both
  designs' coordination note to prevent a collision on merge.

## Migration plan

1. `0015_live_voter_roll.sql` — add `elections.live_voter_roll` (default off).
2. `0016_closing_hak_pilih.sql` — add `elections.closing_hak_pilih` and
   `closing_hak_pilih_at` (both NULL until the first close-time finalization in live
   mode).

Both are repeat-safe D1 migrations applied by the documented operator flow; no data
backfill is needed (no election has run in this mode before).

## Open questions

_None._ The owner answered on 2026-11-19: the labels are "Jumlah Pemilih" and "Suara
Masuk" (Q202); the deployment is on the Workers Paid plan and polls every 15 s, so the
free-plan budget question is gone (Q204); the strip shows from Terjadwal with the synced
view as Jumlah Pemilih and Suara Masuk 0, hidden only in Draf (Q205); the remaining
questions were accepted as recommended — the ~30–45 s staleness window (no per-member
portal endpoint exists; a per-member lookup stays a ppij-identity wish), the Dasbor
stale-view banner after 5 minutes (D6), silent automatic refreshes (D8), true numbers
with clamped `unused_count` and 100-capped percentages when the live denominator shrinks
mid-vote (D4 edge), and hidden-in-Draf-only visibility.
