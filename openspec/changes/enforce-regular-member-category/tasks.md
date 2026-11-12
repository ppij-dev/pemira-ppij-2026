# Tasks

## 1. Schema and client contract
- [x] 1.1 Migration `0009_voter_category.sql`: `voters.category` (null = portal has not determined it).
- [x] 1.2 `serviceapi/client.ts`: declare `member_category`, `member_subtype`, `can_vote`, `korda_path`, `valid_until`, `account_activated`; `nickname` nullable; `getMembers({ changedSince, status })` returns `{ items, asOf }` parsed from the envelope; map `401`/`404`/`429` to their own error codes.

## 2. Roll building, freezing and maintenance
- [x] 2.1 `syncPemilih` enrols only `ACTIVE` `BIASA`, stores `category`, removes a row whose member is no longer eligible, counts `excluded`, and stores the Service API `as_of` as the watermark.
- [x] 2.2 `syncPemilih({ full: true })` reads every status without `changed_since` and replaces the roll with exactly the eligible set.
- [x] 2.3 `lockElection` uses the full rebuild as its final sync; a failed read blocks locking.
- [x] 2.4 `enrichRollNames` refreshes name, card number and category of existing rows (all statuses) without changing roll membership.
- [x] 2.5 `admin/sync` result and its audit detail report the excluded count; admin Pemilih shows it in the status line.

## 3. Vote-time eligibility
- [x] 3.1 `voter.ts`: `VoterRow.category` selected; `not_regular_member` and `category_unknown` refusals with Bahasa Indonesia messages.
- [x] 3.2 Preview auto-register writes `category` `BIASA` for the rehearsal voter.
- [x] 3.3 `pilih-suara.astro` explains both new reasons.

## 4. Portal member data on screen
- [x] 4.1 `lib/memberCategory.ts` (`REGULAR_MEMBER_CATEGORY`, `isRegularMember`, `memberCategoryLabel`) and `lib/formatKomsat.ts` `unitPathLabel()` + `server/lib/units.ts` `loadUnitNames()`.
- [x] 4.2 `akun.astro`: name, card number, unit display name, category; no member UUID.
- [x] 4.3 `admin/pemilih.astro`: card number and category columns, unit display names in the table and the filter.
- [x] 4.4 `admin/index.astro`: admin and invitation rows show the roll name and card number, with a text fallback instead of the id.
- [x] 4.5 `admin/kandidat.astro` and `election/candidates.ts`: add/edit a candidate by card number, list shows the card number; `CandidateCard.astro` and the public candidate pages use `unitPathLabel`.
- [x] 4.6 `audit/routes.ts` and `admin/audit.astro`: `target_label` ("Nama · Nomor kartu") and `komsat_label` (unit name) instead of raw ids and paths.

## 5. Tests and verification
- [x] 5.1 `test/member-category.test.ts`: predicate and labels.
- [x] 5.2 `test/serviceapi-sync.test.ts`: category enrolment/exclusion, full rebuild, `as_of` watermark, enrich category.
- [x] 5.3 `test/vote-api.test.ts`: `LUAR_BIASA` and undetermined refusals; seeds carry a category.
- [x] 5.4 `test/election-lifecycle.test.ts` and `test/preview-mode.test.ts`: freeze rebuild and category on auto-register; durable (non-expiring) preview schedule.
- [x] 5.5 `npm run check` (typecheck) and the focused vitest files; grep proof that no template renders a member id as text.
