# Proposal: Enforce Anggota Biasa eligibility and show portal member data

## Why

Two gaps make the Pemilih roll diverge from the portal:

1. **Eligibility.** PPIJ's AD/ART (ART Bab II Pasal 2–3) makes only *Anggota Biasa*
   (regular members) voters; *Anggota Luar Biasa* may not vote or stand. The identity
   Service API has exposed the member's AD/ART category since `add-member-category`
   (`member_category`: `BIASA` | `LUAR_BIASA` | null, plus the derived `can_vote`), but
   the election system still rolls up every `ACTIVE` member and lets any of them vote.
2. **Display.** Everywhere the site and the admin show a member it uses values the portal
   does not own: the raw `member_id` UUID, the raw `komsat_path` split into a guessed
   name, or the id as a name fallback (`Anggota <id>`, `COALESCE(v.name, i.member_id)`).
   The Service API contract says consumers must use the official `name` fields and never
   derive display names from `path`.

## What Changes

- **Roll building (`syncPemilih`)** writes `voters.category` from `member_category` and
  only enrols `ACTIVE` members whose category is `BIASA`. Any other returned member is
  removed from the roll when present and counted as `excluded` in the sync summary and
  the audit detail.
- **Roll freezing (`lockElection`)** replaces the final incremental sync with one full
  read of the portal (`status=ALL`, no `changed_since`) that rebuilds the roll to exactly
  the `ACTIVE` `BIASA` members in scope, so Kunci cannot freeze a roll carrying a
  non-voter, including rows imported before the category existed.
- **Vote time (`authorizeVoter`)** rejects a member whose stored category is not `BIASA`
  with a clear Bahasa Indonesia message (`not_regular_member`), and a member whose
  category the portal has not determined yet with `category_unknown`. Preview mode keeps
  auto-registering rehearsal voters as `BIASA` from claims.
- **Roll maintenance (`enrichRollNames`)** also refreshes the category of existing roll
  rows (all statuses) without adding or removing members, so a frozen roll can be brought
  up to date.
- **Sync watermark** stores the Service API `as_of` of the sync instead of the local
  clock, so a change written while a sync runs is never skipped.
- **Client contract fixes**: `nickname` is nullable, `member_category` /
  `member_subtype` / `can_vote` / `korda_path` / `valid_until` / `account_activated` are
  declared, `status` can be requested, and `as_of` is parsed. `401`/`404`/`429` map to
  their own error codes.
- **Display**: new `unitPathLabel()` resolves `komsat_path` / korda / affiliation paths
  through the synced `units.name` (the official portal name) with a path fallback, and
  every member-facing screen shows name, card number, unit names and category — never a
  UUID. The Pemilih table swaps the `ID` column for `Nomor kartu` + `Kategori`; the
  account page shows the card number, unit and category; the candidate form and list use
  the card number (candidate create/update resolve card number or member id); the audit
  stream resolves member targets to `Nama · Nomor kartu` and komsat paths to unit names.
- **Migration `0009_voter_category.sql`** adds `voters.category` (null = the portal has
  not determined the category yet).

## Capabilities

### New Capabilities
_None — this is a rule inside the existing roll and eligibility capabilities._

### Modified Capabilities
- `voter-roll`: the roll holds only `ACTIVE` `BIASA` members; Kunci rebuilds it from the
  portal; sync keeps the portal's `as_of`; roll maintenance refreshes category.
- `auth-and-eligibility`: a vote also requires the stored category `BIASA`.

## Impact

- **DB:** migration `0009_voter_category.sql` (`voters.category`).
- **Server:** `serviceapi/client.ts`, `serviceapi/sync.ts`, `voting/vote.ts`,
  `election/lifecycle.ts`, `election/candidates.ts`, `audit/routes.ts`, new
  `lib/units.ts`.
- **UI:** `akun.astro`, `admin/pemilih.astro`, `admin/index.astro`, `admin/kandidat.astro`,
  `admin/audit.astro`, `kandidat/[slug].astro`, `kandidat/index.astro`, `index.astro`,
  `pilih-suara.astro`, `components/CandidateCard.astro`, `lib/formatKomsat.ts`,
  new `lib/memberCategory.ts`.
- **Tests:** `test/serviceapi-sync.test.ts` (category enrolment, full rebuild, watermark),
  `test/vote-api.test.ts` (vote-time category), `test/preview-mode.test.ts` (durable
  schedule, category on auto-register), `test/election-lifecycle.test.ts` (freeze
  rebuild), new `test/member-category.test.ts` (labels and predicate).
- **Risk:** a wrong category removes a vote. Mitigated by the portal-derived value, the
  `excluded` count shown to Admin Voting, the `category_unknown` message that asks the
  committee to fix portal data, and the fact that preview mode is unaffected.
- **No change** to ballot secrecy, phone/email rules, or the identity repository.
