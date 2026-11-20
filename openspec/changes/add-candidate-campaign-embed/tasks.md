# Tasks: Portal kampanye kandidat (campaign embed)

Ordered, small, testable. Each numbered group lands its own tests before the next begins
(worker verification tier: build or typecheck plus the focused tests of the changed code,
120 s max per command). Spec source of truth: the deltas in `specs/` of this change. Copy is
Bahasa Indonesia, no emoji; Tabler icons only; no polling and no client retry script.

## 1. Schema: the `campaign_url` column (candidate-management)

- [x] 1.1 Failing test first in `test/schema.test.ts`: migration
      `0018_candidate_campaign_url.sql` adds a nullable `campaign_url` column to
      `candidates`, existing rows read `NULL`, the column accepts a 300-character value and
      the other candidate columns are untouched.
- [x] 1.2 Write `migrations/0018_candidate_campaign_url.sql` (one additive
      `ALTER TABLE candidates ADD COLUMN campaign_url TEXT;`) and wire it into the schema
      test's migration list; run the group's tests green.

## 2. Backend: validation, Draf-only edit, audit detail (candidate-management, audit-log)

- [x] 2.1 Failing tests first in `test/candidates.test.ts`: create and update accept a
      canonical `https://` address up to 300 characters and store it; `http://`,
      `javascript:`, `data:`, `mailto:`, protocol-relative, host-less, credentialed,
      whitespace-carrying and oversized values are refused with HTTP 400 and write nothing;
      an omitted field keeps the stored value and an empty string clears it.
- [x] 2.2 Failing tests for the lifecycle and the audit: create and update are refused
      outside Draf with nothing written, the stored URL is frozen after Kunci, a create or
      an update that changes the URL appends exactly one entry whose `detail_json` holds
      `campaign_url`, and an unrelated edit keeps the detail empty.
- [x] 2.3 Implement `CAMPAIGN_URL_MAX_CHARS`, `normalizeCampaignUrl`, the insert/update
      columns, `campaign_url` in `listCandidates` and in `PROFILE_COLUMNS`
      (`src/server/election/profile.ts`); run the group's tests green.

## 3. UI: the Admin Voting field and the profile section (candidate-management, public-site)

- [x] 3.1 Add the "Portal kampanye (opsional)" field to `src/pages/admin/kandidat.astro`
      with its help text, prefill it from the Ubah button (`data-campaign-url`) and send it
      in the create/update payload.
- [x] 3.2 Add the "Portal kampanye" section to `src/pages/kandidat/[slug].astro`: heading,
      attribution note, iframe with the exact sandbox attributes, `referrerpolicy`,
      `loading`, title and responsive height, plus the visible "Buka di tab baru" link and
      the "no section when empty" condition.
- [x] 3.3 Failing render tests first in a new `test/campaign-embed-ui.test.ts`: the profile
      page source carries the exact sandbox attribute string, never `allow-same-origin` and
      never `allow-top-navigation`, has `referrerpolicy="no-referrer"`, `loading="lazy"`, a
      title, the new-tab link with `rel="noopener noreferrer"` and the attribution note, and
      renders the section only when the URL is set; the admin form has the field; the
      ballot, the confirmation sheet and the invitation welcome page contain no campaign
      iframe while the welcome page links to the profile view. Run them green.

## 4. Hard rule 8 and strict validation (docs)

- [x] 4.1 Update hard rule 8 in `AGENTS.md` to record the owner-approved exception: one
      `https`-only campaign URL per candidate, edited in Draf, embedded only on the
      candidate profile page inside a sandboxed iframe
      (`allow-scripts allow-popups`, never `allow-same-origin`), and the requirement that a
      future CSP allows `frame-src https:`; the deferred rich editor and media upload stay
      deferred.
- [x] 4.2 Run `openspec validate add-candidate-campaign-embed --strict` and fix whatever it
      reports.

## 5. Wrap-up: verification, local proof, commit

- [x] 5.1 Run `npm run check`, the touched test files and the full `vitest run`.
- [x] 5.2 Start `wrangler dev` on this worktree's own state directory and a free port (not
      4391, 4441, 4477, 4599, 4720 or 4891) against local D1, apply the migrations, set a
      candidate's `campaign_url` to `https://ereksoforppi.netlify.app/`, and take 390 px and
      desktop screenshots of the profile page with the embed actually loaded; store them
      under `design/screenshots/campaign-embed/`.
- [x] 5.3 Confirm on the built pages that the section is absent for an empty URL, that the
      fallback link works, and that the ballot and confirmation sheet show no campaign
      iframe; commit path-scoped on `task/campaign-embed` without pushing.
