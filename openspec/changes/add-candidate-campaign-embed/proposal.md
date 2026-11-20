# Proposal: Portal kampanye kandidat (embedded campaign page on the candidate profile)

## Why

Owner decision (2026-11-20) for the live election: a candidate's team already runs its own
campaign site outside this app — the example is `https://ereksoforppi.netlify.app/`
("Portal Kampanye Erekso", a 1.8 MB single page that sends no `X-Frame-Options` and no CSP
`frame-ancestors`, so it can be framed). Panitia does not want to copy that content into
our candidate article, and 1.1 rich media upload is not available in this release. The
owner therefore asked for one optional external link per candidate, shown on the public
profile page as an embedded page, so a voter can read the whole campaign without leaving
the profile.

This is the owner-approved exception to hard rule 8 ("no rich media until a 1.1 change").
It is narrower than the deferred rich editor: the app stores **no** candidate content
here — only a validated `https://` address — and the page is rendered by the candidate's
own site inside a sandboxed iframe, never by us.

## What Changes

- **New optional candidate field `campaign_url`** (`candidates.campaign_url`, migration
  `0018_candidate_campaign_url.sql`). Empty means "no portal"; empty is the default, so
  every existing candidate stays byte-for-byte as today.
- **Server-side `https`-only validation.** The value is trimmed, must start with
  `https://`, must parse as an absolute URL with a host, may not carry credentials
  (`user:password@`), may not carry whitespace or control characters, and is limited to
  300 characters. `http://`, `javascript:`, `data:`, `mailto:`, protocol-relative and
  host-less values are refused with a Bahasa Indonesia message that names the accepted
  shape.
- **Admin Voting sets it in the candidate form, only in Draf.** Same rule as every other
  candidate field: create and update are refused outside Draf, and the value is frozen at
  Kunci & Jadwalkan. Each create or change that carries a campaign URL appends the normal
  hash-chained audit entry with the URL in `detail_json` (`{"campaign_url": "..."}`); an
  unchanged value adds no extra entry.
- **The profile page embeds it.** `/kandidat/<slug>` — and the same page opened from an
  invitation link — gains a "Portal kampanye" section when the field is set: an iframe
  with `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` (never
  `allow-same-origin`, never `allow-top-navigation`), `referrerpolicy="no-referrer"`,
  `loading="lazy"` and a title. It is tall on a 390 px phone, and a visible "Buka di tab
  baru" link (`rel="noopener noreferrer"`, at least 44 px) sits outside the frame, so a
  site that refuses framing or fails to load still leaves the voter the link.
- **A short attribution note** says the content comes from the candidate's team, not from
  panitia, and the section is not shown at all when the field is empty.
- **No frame on the ballot, the confirmation sheet or the invitation welcome page.** The
  invitation welcome page keeps linking to the profile view instead of embedding, so that
  page stays light.
- **No CSP or framing header of ours blocks it.** The app ships no `Content-Security-Policy`
  and no `X-Frame-Options` (checked: `src/middleware.ts`, `src/fetch.ts`,
  `src/server/middleware/noindex.ts`, no `public/_headers`), so nothing needs widening
  today; when a CSP is introduced it must allow `frame-src https:` for this section.
- **Hard rule 8 is updated** in `AGENTS.md` to record the approved exception: one
  `https`-only campaign URL per candidate, embedded only on the profile page, only inside
  a sandboxed iframe without `allow-same-origin`. The rest of rule 8 (no upload, no
  editor, no photo/video upload) stands.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `candidate-management`: the optional `campaign_url` field, its `https`-only validation,
  Draf-only edits, the audit detail, and the freeze at Kunci.
- `public-site`: the "Portal kampanye" section on the candidate profile page (and the
  invitation-mode profile), the exact sandbox attributes, the fallback link, the
  attribution note, and the rule that the ballot, the confirmation sheet and the
  invitation welcome page never embed it.

## Impact

- **DB:** `migrations/0018_candidate_campaign_url.sql` adds one nullable column
  (`campaign_url TEXT`) to `candidates`. Additive, no backfill, no other table touched.
- **Server:** `src/server/election/candidates.ts` (validation helper, insert/update, list
  columns, audit detail), `src/server/election/profile.ts` (`campaign_url` in the profile
  projection). No new endpoint: the existing `POST/PUT /api/election/candidates` carries
  the field.
- **UI:** `src/pages/admin/kandidat.astro` (one form field, the Ubah prefill, the save
  payload) and `src/pages/kandidat/[slug].astro` (the "Portal kampanye" section).
  `src/pages/undangan/[kode].astro` is unchanged on purpose: it already links to the
  profile view and must not embed.
- **Tests:** `test/candidates.test.ts` (URL validation, Draf-only, freeze, audit detail,
  list/profile projection), a new `test/campaign-embed-ui.test.ts` (page source: exact
  sandbox attributes, never `allow-same-origin`, `referrerpolicy`, `loading`, title, the
  new-tab link, the attribution note, no section when empty, no embed on the ballot,
  confirmation sheet or invitation page), and `test/schema.test.ts` (migration, nullable
  column, no constraint surprises).
- **Risk:** an embedded third-party page is content we do not control. Mitigated by
  `https`-only, a size limit, `sandbox` without `allow-same-origin` (so the framed page
  cannot reach our origin, cookies or storage), no top navigation, `no-referrer`, and the
  fact that the page is shown only on the public profile, never in the voting flow. A
  candidate team can change what its site serves after Kunci; the field itself is frozen
  at Kunci, and the note says the content belongs to the candidate's team.
- **No change** to ballot secrecy, receipts, eligibility, the frozen roll, results,
  candidate deletion rules or the 1.0 deferrals for rich media upload.

## Open questions

_None._ The owner's decision of 2026-11-20 fixes the behaviour: one external campaign page
per candidate, embedded on the profile page, link always available, no embed in the voting
flow or on the invitation welcome page.
