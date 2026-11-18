# Proposal: Tidak Membekukan DPT (live voter roll) and a live public turnout stat

## Why

Today Kunci & Jadwalkan freezes the Pemilih roll: only members on the frozen roll can
vote, and Hak pilih is fixed from that moment. That is right for most elections, but the
owner wants a mode where the roll keeps following the portal while voting is open: a
member who registers on the portal mid-voting can vote at once, and a member who loses
eligibility mid-voting can no longer vote (owner decision 2026-11-19). Admin Voting turns
this on with a **"Tidak Membekukan DPT"** switch in Pengaturan, editable only in Draf,
audited on every toggle, and frozen at Kunci & Jadwalkan — the same pattern as
`single_candidate_mode`. Because the roll no longer freezes at Kunci, Hak pilih must be
live while voting is open and then be fixed and saved once, when voting closes, so
shares, Dasbor, results and Hitung Abstain all use one stable denominator afterwards.

The owner also wants the landing page to show a live participation figure — **[Jumlah
Pemilih] [Suara Masuk]** — above the schedule panel, in every election while voting is
open and after close, updating with a number-flip animation. Counts only, never choices,
with every existing rule about what stays hidden before Diumumkan untouched. Today the
site has no polling at all (hard rule "manual refresh only"), so this change also picks
the update mechanism and records why.

## What Changes

- **Switch in Pengaturan (Draf only).** A "Tidak Membekukan DPT" switch sits beside the
  single-candidate-mode switch. It can be toggled only while Draf; each toggle is recorded
  in the audit log; the value is frozen at Kunci & Jadwalkan and written into the lock
  audit entry's detail. New column `elections.live_voter_roll` (migration
  `0015_live_voter_roll.sql`), mirroring the `single_candidate_mode` pattern. The two
  switches are independent; both may be on.
- **Kunci & Jadwalkan no longer freezes the roll while the switch is on.** `frozen_at` and
  `frozen_hak_pilih` stay NULL. Kunci still runs the final full Service API sync so the
  live view starts complete and the portal's reachability is proven at lock time, but
  nothing is frozen; the lock audit detail records `live_voter_roll: true` and the
  starting view count. With the switch off, locking is byte-for-byte today's.
- **Eligibility is checked live against the portal at vote time, both ways.** While voting
  is open with the switch on, the frozen-roll refusal disappears: the vote-time check
  reads a live portal view kept in the existing `voters` table and refreshed on demand
  with the Service API `changed_since` watermark (TTL 30 s). A member who has just
  registered on the portal and is eligible can vote after the next refresh — within one
  refresh cycle, roughly half a minute. A member who stops being eligible (INACTIVE or
  `can_vote` false) is refused at the next check. Votes already cast stay. When the
  portal is unreachable, the last known view is used (stale-while-unavailable); members
  absent or ineligible in that view are still refused, so an outage never widens who may
  vote. The rules themselves are unchanged: ACTIVE Anggota Biasa (`can_vote = 1`) only,
  the Admin Voting participation setting, scope via the session affiliation, and the
  session freshness rules. Mode Pratinjau keeps today's rehearsal flow; the live check
  governs real votes when preview mode is off.
- **Hak pilih is live while voting is open, then fixed and saved at close.** While Dibuka,
  every Hak pilih figure (Dasbor, results, landing stat) is the live count of the portal
  view. At close the count is fixed and saved once into `elections.closing_hak_pilih` and
  `closing_hak_pilih_at` (migration `0016_closing_hak_pilih.sql`). There is no cron: the
  closing stage is computed from the clock, and the snapshot is written by the first read
  that observes the election closed — the same guarded first-read finalization pattern as
  `ensureClosingSnapshot` in `board.ts` — or inline in the Tutup Sekarang batch for an
  early close. After the snapshot exists, shares, Dasbor, results, Hitung Abstain and
  Umumkan all use the saved number. Kembali ke Draf clears the saved columns with the
  other closing data. With the switch off, nothing changes: Hak pilih keeps coming from
  `frozen_hak_pilih`.
- **Public turnout stat on the landing page.** Above the schedule panel, a two-figure
  strip shows **Jumlah Pemilih** (Hak pilih) and **Suara Masuk** (participation; owner
  decision Q202). It shows in every election — not only this mode — while voting is open
  and after close, and is hidden in Draf and Terjadwal. Counts only, never choices or
  candidate figures; the rule that candidate counts are hidden before Diumumkan is
  unchanged. The figures update live with a number-flip animation via short polling of a
  new public counts-only endpoint (GET `/api/turnout`), 15 s while Dibuka and 60 s after
  close, paused while the tab is hidden. Short polling is chosen over WebSocket/Durable
  Objects; the comparison and reasoning are in design.md. Dasbor keeps its manual
  refresh-by-button; polling is limited to this one public stat.
- **Hook for invite links.** The direct-invite change will add +1 to Hak pilih per
  generated link. All Hak pilih aggregation funnels through one documented extension
  point (the live count helper and the closing snapshot), so that change adds its
  "active invite links" count in exactly one place for both the live figure and the
  closing snapshot. Migrations `0015` and `0016` are claimed by this change; the
  direct-invite change should start at `0017`.
- **Audit.** Switch toggles are recorded as Admin Voting actions; the Kunci entry records
  the frozen switch value and the starting view count; the closing snapshot writes one
  system audit entry ("Hak pilih akhir disimpan") with the saved number. Automatic
  refreshes of the portal view write no audit entries (they would flood the hash chain);
  the last refresh time is visible on the Pemilih page instead.

## Capabilities

### New Capabilities

_None — the mode and the stat live inside existing capabilities._

### Modified Capabilities

- `election-lifecycle`: the Draf-only switch, the no-freeze locking rule while it is on,
  the closing Hak pilih finalization on first read after close, and the Kembali ke Draf
  reset of the saved columns.
- `voter-roll`: the live portal view during voting (refresh cadence, portal-down
  behaviour, watermark handling) and the Pemilih page showing the last refresh time.
- `voting-and-receipts`: vote-time live eligibility in this mode; secrecy, receipts,
  confirmation, one-vote-per-member and rate limits unchanged.
- `public-site`: the landing turnout stat above the schedule panel, its visibility rules
  and the counts-only public endpoint behind it.
- `admin-dashboard`: Hak pilih and turnout figures are live while voting is open in this
  mode and come from the saved snapshot afterwards, with a visible "roll follows the
  portal" note.
- `audit-log`: audit entries for the toggles, the frozen switch value in the lock detail,
  and the closing Hak pilih snapshot entry.

## Impact

- **DB:** migrations `0015_live_voter_roll.sql` (`elections.live_voter_roll`) and
  `0016_closing_hak_pilih.sql` (`elections.closing_hak_pilih`, `closing_hak_pilih_at`).
  `0015`–`0016` are claimed by this change; the direct-invite change starts at `0017`.
- **Server:** `election/lifecycle.ts` (switch, no-freeze locking, early-close snapshot,
  Kembali ke Draf reset), `voting/vote.ts` (live eligibility path in `authorizeVoter`),
  `voting/board.ts` (`ensureClosingHakPilih` first-read finalization beside
  `ensureClosingSnapshot`), `serviceapi/sync.ts` (refresh without audit entries, reusable
  incremental sync), `results/queries.ts` (Hak pilih resolution live vs saved),
  `results/routes.ts` (public counts-only `/api/turnout`).
- **UI:** `admin/pemilihan.astro` (switch with helper text), `admin/dasbor.astro` (live
  figures note), `admin/pemilih.astro` (last refresh time), `index.astro` (stat strip
  with number-flip animation), `hasil.astro` (saved-number shares).
- **Tests:** `test/schema.test.ts` (migrations), `test/election-lifecycle.test.ts`
  (switch, no-freeze lock, closing snapshot, Kembali ke Draf reset), `test/vote-api.test.ts`
  (live eligibility both ways, portal-down stale path, rules unchanged),
  `test/results-api.test.ts` (live vs saved Hak pilih, Hitung Abstain on the saved
  number), `test/receipt-board.test.ts` (finalization idempotence), new turnout endpoint
  tests, focused render checks.
- **Risk:** the portal is the availability single point while voting is open in this mode.
  Mitigated by stale-while-unavailable (an outage never removes anyone's ability to vote
  who could vote at the last refresh, and never widens eligibility), a refresh cooldown
  that bounds added latency, and the saved closing snapshot which removes the portal from
  the denominator once voting closes. A second risk is the live Hak pilih shrinking below
  Suara Masuk mid-vote; shares are capped at 100 and the closing snapshot resolves the
  final denominator. Public exposure grows by exactly two aggregate numbers; no choice,
  candidate or korda data moves earlier.
- **No change** to ballot secrecy mechanics, receipt codes, the receipt board, one-vote-
  per-member, confirmation by nickname, Uji Coba, multi-candidate behaviour with the
  switch off, or the manual-refresh rule for Dasbor and results.
