# Tasks

## 1. Schema and client contract
- [x] 1.1 Migration `0009_voter_category.sql` (`voters.category`, display only).
- [x] 1.2 Migration `0010_voter_can_vote.sql` (`voters.can_vote`: 1 true, 0 false, null = portal has not decided).
- [x] 1.3 `serviceapi/client.ts`: declare `member_category`, `member_subtype`, `can_vote`, `korda_path`, `valid_until`, `account_activated`; `nickname` nullable; `getMembers({ changedSince, status })` returns `{ items, asOf }` parsed from the envelope; map `401`/`404`/`429` to their own error codes.

## 2. Roll building, freezing and maintenance on can_vote
- [x] 2.1 `syncPemilih` enrols only members the portal marks `can_vote: true`, stores `can_vote` and the display `category`, removes a row whose member is no longer eligible, counts `excluded` (ACTIVE without voting rights), and stores the Service API `as_of` as the watermark.
- [x] 2.2 `syncPemilih({ full: true })` reads every status without `changed_since` and replaces the roll with exactly the eligible set.
- [x] 2.3 `lockElection` uses the full rebuild as its final sync and records `tanpa_hak_pilih`; a failed read blocks locking.
- [x] 2.4 `enrichRollNames` refreshes name, card number, category and `can_vote` of existing rows (all statuses) without changing roll membership.
- [x] 2.5 `admin/sync` status line and audit detail report the excluded count as "tanpa hak pilih".

## 3. Vote-time eligibility on can_vote
- [x] 3.1 `voter.ts`: `VoterRow.can_vote` selected; `can_vote` 1 allows, 0 refuses with `not_regular_member`, null refuses with `category_unknown`; the category is never consulted for eligibility.
- [x] 3.2 Preview auto-register writes `category` `BIASA` and `can_vote` 1 for the rehearsal voter.
- [x] 3.3 `pilih-suara.astro` explains both reasons.

## 4. Portal member data on screen
- [x] 4.1 `lib/memberCategory.ts` (`REGULAR_MEMBER_CATEGORY`, `isRegularMember`, `memberCategoryLabel`) and `lib/formatKomsat.ts` `unitPathLabel()` + `server/lib/units.ts` `loadUnitNames()`.
- [x] 4.2 `akun.astro`: name, card number, unit display name, category; no member UUID.
- [x] 4.3 `admin/pemilih.astro`: card number and a category chip whose state follows `can_vote`, unit display names in the table and the filter, and an amber notice counting rows the portal has not decided.
- [x] 4.4 `admin/index.astro`: admin and invitation rows show the roll name and card number, with a text fallback instead of the id.
- [x] 4.5 `admin/kandidat.astro`: candidate list shows the card number (or "Tanpa nomor kartu") and official unit names.
- [x] 4.6 `audit/routes.ts` and `admin/audit.astro`: `target_label` ("Nama · Nomor kartu") and `komsat_label` (unit name) instead of raw ids and paths.

## 5. Candidate reference rules
- [x] 5.1 `election/candidates.ts`: resolve by card number; in preview mode only, a roll row without a card number also resolves by `member_id`; otherwise one identical refusal message.
- [x] 5.2 `admin/kandidat.astro`: in preview mode the datalist offers `member_id` for rows without a card number and the hint says so; outside preview the form stays card-number only.
- [x] 5.3 Candidate update with no reference keeps the recorded member without a card number.

## 6. Tests and verification
- [x] 6.1 `test/member-category.test.ts`: predicate and labels.
- [x] 6.2 `test/serviceapi-sync.test.ts`: `can_vote` enrolment/exclusion, full rebuild, `as_of` watermark, category + `can_vote` refresh.
- [x] 6.3 `test/vote-api.test.ts`: `can_vote` 0 and null refusals; `can_vote` is the source of truth over the category.
- [x] 6.4 `test/candidates.test.ts`: card-number reference, preview-only `member_id`, refusal for a carded row.
- [x] 6.5 `test/election-lifecycle.test.ts` and `test/preview-mode.test.ts`: freeze rebuild stores only `can_vote` 1; auto-register sets `can_vote` 1; durable (non-expiring) preview schedule.
- [x] 6.6 `npm run check` (typecheck) and the focused vitest files; grep proof that no template renders a member id as text.
