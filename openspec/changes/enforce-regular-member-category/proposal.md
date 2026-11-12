# Proposal: Enforce portal voting rights and show portal member data 1:1

## Why

Two gaps make the Pemilih roll diverge from the portal:

1. **Eligibility.** PPIJ's AD/ART (ART Bab II Pasal 2–3) makes only *Anggota Biasa*
   (regular members) voters; *Anggota Luar Biasa* may not vote or stand. The identity
   Service API has exposed `member_category` (`BIASA` | `LUAR_BIASA` | null) and the
   portal's own `can_vote` decision since `add-member-category`, but the election system
   still rolled up every `ACTIVE` member and let any of them vote. Owner decision
   (2026-11-12, Q6): **Pemira trusts the portal's `can_vote` flag** instead of deriving
   `ACTIVE` + `BIASA` itself, and keeps `member_category` for display only.
2. **Display.** Everywhere the site and the admin show a member it used values the portal
   does not own: the raw `member_id` UUID, the raw `komsat_path` split into a guessed
   name, or the id as a name fallback (`Anggota <id>`, `COALESCE(v.name, i.member_id)`).
   The Service API contract says consumers must use the official `name` fields and never
   derive display names from `path`.

## What Changes

- **`can_vote` is the eligibility source of truth.** `syncPemilih` writes
  `voters.can_vote` (`1` true, `0` false, `null` = the portal has not decided) and
  enrols only rows the portal marks `can_vote: true`. A returned member who is no longer
  eligible is removed from the roll when present, and is counted as `excluded`
  (active members without voting rights) in the sync summary and the audit detail.
  `voters.category` is stored beside it for display only.
- **Roll freezing (`lockElection`)** replaces the final incremental sync with one full
  read of the portal (`status=ALL`, no `changed_since`) that rebuilds the roll to exactly
  the `can_vote: true` members in scope, so Kunci cannot freeze a roll carrying a
  non-voter, including rows imported before `can_vote` existed.
- **Vote time (`authorizeVoter`)** requires stored `can_vote = 1`. `can_vote = 0` is
  refused with `not_regular_member` ("Hanya Anggota Biasa yang berhak memilih pada
  pemilihan ini."), and `can_vote` null (the portal has not determined the category) is
  refused with `category_unknown` ("Kategori keanggotaan Anda belum ditentukan portal
  PPIJ. Hubungi panitia pemilihan."). Preview mode keeps auto-registering rehearsal
  voters as `BIASA` with `can_vote = 1` from claims, and heals a pre-existing rehearsal
  row whose `can_vote` the portal never set.
- **Roll maintenance (`enrichRollNames`)** also refreshes `category` and `can_vote` of
  existing roll rows (all statuses) without adding or removing members, so a frozen roll
  can be brought up to date.
- **Sync watermark** stores the Service API `as_of` of the sync instead of the local
  clock, so a change written while a sync runs is never skipped.
- **Client contract fixes**: `nickname` is nullable, `member_category` /
  `member_subtype` / `can_vote` / `korda_path` / `valid_until` / `account_activated` are
  declared, `status` can be requested, and `as_of` is parsed. `401`/`404`/`429` map to
  their own error codes.
- **Display**: new `unitPathLabel()` resolves `komsat_path` / korda / affiliation paths
  through the synced `units.name` (the official portal name) with a path fallback, and
  every member-facing screen shows name, card number, unit names and category — never a
  UUID. The Pemilih table swaps the `ID` column for `Nomor kartu` + a `Kategori` chip
  whose state follows `can_vote` (label from `category`, amber "Belum ditentukan", red
  "Tidak berhak memilih"); the account page shows the card number, unit and category; the
  audit stream resolves member targets to `Nama · Nomor kartu` and komsat paths to unit
  names.
- **Candidate reference (owner decision 2026-11-12, Q7)**: a candidate is added by card
  number. In **preview mode only**, a roll row without a card number may be referenced by
  `member_id`, because preview voters are registered from One Login claims and never
  synced with the portal; outside preview a `member_id` reference is refused with one
  identical message, so membership is never confirmed by UUID. A candidate update with no
  reference keeps the recorded member without needing a card number.
- **Migration `0009_voter_category.sql`** adds `voters.category` (display);
  **`0010_voter_can_vote.sql`** adds `voters.can_vote` (null = the portal has not
  decided).

## Capabilities

### New Capabilities
_None — this is a rule inside the existing roll and eligibility capabilities._

### Modified Capabilities
- `voter-roll`: the roll holds only members the portal marks `can_vote: true`; Kunci
  rebuilds it from the portal; sync keeps the portal's `as_of`; roll maintenance refreshes
  category and voting rights; the candidate form resolves card numbers, with a preview-only
  `member_id` fallback for rows without one.
- `auth-and-eligibility`: a vote also requires stored `can_vote = 1`.

## Impact

- **DB:** migrations `0009_voter_category.sql` (`voters.category`) and
  `0010_voter_can_vote.sql` (`voters.can_vote`).
- **Server:** `serviceapi/client.ts`, `serviceapi/sync.ts`, `voting/vote.ts`,
  `election/lifecycle.ts`, `election/candidates.ts`, `audit/routes.ts`, new
  `lib/units.ts`.
- **UI:** `akun.astro`, `admin/pemilih.astro`, `admin/index.astro`, `admin/kandidat.astro`,
  `admin/audit.astro`, `kandidat/[slug].astro`, `kandidat/index.astro`, `index.astro`,
  `pilih-suara.astro`, `components/CandidateCard.astro`, `lib/formatKomsat.ts`,
  new `lib/memberCategory.ts`.
- **Tests:** `test/serviceapi-sync.test.ts` (can_vote enrolment, full rebuild, watermark,
  category/can_vote refresh), `test/vote-api.test.ts` (vote-time can_vote incl. the
  category-only display case), `test/preview-mode.test.ts` (durable schedule, can_vote on
  auto-register), `test/election-lifecycle.test.ts` (freeze rebuild), `test/candidates.test.ts`
  (card-number reference, preview-only member id), `test/member-category.test.ts` (labels).
- **Risk:** a missing or wrong `can_vote` blocks a vote. Mitigated by the portal being the
  single decision point, the `excluded` count shown to Admin Voting, the amber
  "belum ditentukan" notice on the Pemilih page that names the fix (Admin Portal sets the
  category, then "Perbarui Nama & Kategori dari Portal"), and preview mode being
  unaffected.
- **No change** to ballot secrecy, phone/email rules, or the identity repository.
