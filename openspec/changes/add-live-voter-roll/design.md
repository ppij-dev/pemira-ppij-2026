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
`status_lock != 'draft'`, which is the whole "frozen at Kunci" rule; the toggle endpoint
mirrors the single-candidate-mode toggle (PUT route, Draf-only refusal message, one audit
entry per accepted toggle: "Tidak Membekukan DPT diaktifkan" / "Tidak Membekukan DPT
dinonaktifkan"). The lock audit detail records `live_voter_roll: true/false` beside
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
roll lookup in `authorizeVoter` (live mode, stage Dibuka only):

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
  it can only delay a removal by the outage's length. This is the recommended behaviour
  (owner asked to pick: cache-with-fallback over hard timeout).
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
freeze already use. One helper owns it so every consumer agrees (see D7 for the invite
hook). Consumers resolve the denominator once, in one place in `results/queries.ts`:

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
denominator, so published figures never show the artifact.

### D5: Public turnout stat on the landing page

**Labels.** "Jumlah Pemilih" for Hak pilih and "Suara Masuk" for participation (owner
decision Q202, 2026-11-19). "Jumlah Pemilih" is the term the site already uses for the
roll, and "Suara Masuk" matches the participation figure the receipt board already shows
after close.

**Placement and visibility.** A compact two-figure strip rendered above the schedule
panel ("Jadwal pemungutan") on `index.astro`, shown in every election — both switch states
— while the stage is Dibuka, Ditutup or Diumumkan; hidden in Draf and Terjadwal. In a
Draf-stage preview election nothing shows (nothing is open yet). The strip shows counts
only: no candidate figures, no choices, no korda breakdown, no per-person anything. The
existing rule "before Diumumkan, candidate vote counts are visible only to Admin Voting"
is unchanged — these two aggregates are the only new public numbers, and they are
explicitly permitted by the owner's decision while open and after close.

**Endpoint.** `GET /api/turnout`, public (like `/api/votes/board`), returning
`{ stage, eligible_count, votes_count, updated_at }` — `votes_count` is the non-test
participation count (equal to the ballot count by the count invariant), `eligible_count`
the resolved denominator of D4, `updated_at` the response time. Counts only; it refuses
nothing and exposes nothing else. Lightly rate-limited with the existing `rate_limits`
pattern (per IP, generous enough for polling: 30/min, same as receipt checks).

**Update mechanism: short polling over WebSocket/Durable Objects.** The client polls the
endpoint every **15 s** while Dibuka and every **60 s** after close (the number can change
once more when the snapshot lands), pauses on `visibilitychange` hidden tabs, and applies
a small jitter so viewers do not synchronize. Changes animate with a number-flip
transition in the browser. Comparison for ~300 voters:

- **Short polling (recommended).** One tiny endpoint; two indexed COUNT queries per hit;
no new infrastructure; works unchanged on any plan; degrades to a stale number, never to a
broken page. Load: worst case 300 viewers × 4 req/min ≈ 20 req/s while Dibuka — trivial
for Workers (paid: 10 M req/month for $5/mo; free tier 100 k req/day can be exceeded by a
large election-day audience, see open question 1). Latency: a new vote shows within one
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

### D7: Hook for the direct-invite change

Both Hak pilih producers — the live count in D4 and the closing snapshot — funnel through
one aggregation helper (live) and one snapshot function (close). The direct-invite change
adds its "+1 per active invite link" exactly there: live Hak pilih = portal-eligible
members + active invite links, and the snapshot must include the links active at
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
  keep their audited `pemilih_sync` entry. If the owner wants automatic refreshes audited
  after all, a throttled "portal view refreshed" entry (at most one per 10 minutes with
  counts) is the prepared fallback — see open question 4.

### D9: Copy (Bahasa Indonesia, no emoji)

- Switch: "Tidak Membekukan DPT" (the owner's exact words), helper text: only editable
  while Draf; while on, the roll follows the portal during voting (new eligible members
  can vote at once, lost eligibility blocks voting) and Hak pilih is fixed when voting
  closes.
- Toggle audit actions: "Tidak Membekukan DPT diaktifkan" / "Tidak Membekukan DPT
  dinonaktifkan".
- Refusal outside Draf: "Pengaturan ini hanya dapat diubah saat Draf."
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

Each with a recommended answer; the owner decides.

1. **Polling budget on the free Workers plan.** 15 s polling for ~300 voters is ~20 req/s
   at peak; a paid plan ($5/mo, 10 M requests) shrugs it off, but the free tier's 100 k
   requests/day can be exceeded by a full-day open stage with many concurrent viewers.
   *Recommendation:* keep 15 s and require the Workers paid plan for elections using this
   mode (the deployment already assumes D1 + Workers; $5/mo is the cheapest safe answer);
   drop to 30 s only if the owner wants to stay on the free tier.
2. **Is ~30–45 s staleness acceptable for "can vote immediately"?** A just-registered
   member can vote after the next refresh; instant voting would need a per-member lookup
   endpoint in the Service API, which lives in the ppij-identity repo. *Recommendation:*
   accept the refresh cycle; file the per-member endpoint as a ppij-identity wish, not a
   blocker.
3. **Long portal outage (hours) during an open live-mode election.** Votes keep being
   accepted against the last view. *Recommendation:* add a Dasbor warning banner with the
   last refresh time once the view is more than 5 minutes stale, so the committee notices
   without the system stopping anything.
4. **Silent automatic refreshes.** No audit entry per refresh avoids flooding the hash
   chain; the trade-off is that roll changes during voting leave no per-change audit
   trail. *Recommendation:* keep them silent (the watermark time is visible on the Pemilih
   page; the closing snapshot entry fixes the final number in the chain); if the owner
   prefers traceability, add the throttled "portal view refreshed" entry (max one per 10
   minutes) described in D8.
5. **Live denominator shrinking below Suara Masuk mid-vote.** The strip could briefly show
   more votes than voters. *Recommendation:* show the true numbers (trustworthy beats
   tidy), clamp `unused_count` at zero and percentages at 100, and let the closing
   snapshot settle the official denominator; do not hide the strip.
6. **Visibility in Terjadwal.** The brief says the stat shows while open and after close;
   showing "Jumlah Pemilih" already in Terjadwal (from the synced view, Suara Masuk 0)
   would preview the electorate before voting starts. *Recommendation:* follow the brief —
   hidden in Draf and Terjadwal; revisit if the owner wants the electorate visible while
   scheduled.
