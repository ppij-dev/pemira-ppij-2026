# Proposal

## Why

PPI Jepang (national, Korda and Komsat) needs an open-source e-voting system (`ppij-dev/ppij-election-system`) that a chapter's volunteer committee can deploy to Cloudflare's free tier with one button and run without a developer. Eligibility comes from PPIJ One Login and the membership registry instead of Google Forms and spreadsheets, and every ballot is secret, one per member and traceable by its voter.

## What Changes

- **Operator bootstrap for 1.0**: an operator configures Wrangler bindings/secrets and applies D1 migrations, then initializes the site, its single draft election, scope and first Admin Voting with a documented local/remote command. Uninitialized sites return 503; `/setup` is unavailable. Browser setup and one-button installation are phase 2 (1.1), not a prerequisite for a local election.
- **Roles**: Admin Voting (equal-rights committee members, ACTIVE and in scope) and Pemilih. The first admin is labelled Technical Admin without extra rights. Admin Portal means an admin of ppij-identity, not this site. Invitations use copyable single-use links; no email delivery in 1.0.
- **Eligibility**: a voter must be on the Pemilih roll frozen by Kunci & Jadwalkan and have a One Login sign-in no older than 10 minutes with an ACTIVE affiliation inside scope. Newly active members after lock cannot vote.
- **Roll**: manually synced in Draf from the Service API; Kunci performs one final sync and freezes the ACTIVE members in scope. Until ppij-identity's Service API is available, local tests use a deterministic HTTP fixture; a failed final sync blocks Kunci.
- **Election**: one election per site, Draf, Terjadwal, Dibuka, Ditutup, Diumumkan; schedule-derived stage, Uji Coba, extend, early close and irreversible publication, without polling or background jobs.
- **Candidates**: one non-admin member from the Pemilih list per candidate, unique number and nickname, plain-text description and a structured public sample page. A downloaded local placeholder image is used; no rich HTML, video, photo uploads or editor in 1.0.
- **Ballot and proof**: nickname confirmation, one atomic secret ballot, a 128-bit receipt encoded as 26 Crockford characters, and only its SHA-256 hash stored. The browser hashes a code before lookup; after close the public board lists hashes, never recoverable codes.
- **Essential UI**: templui-based mobile-first pages with Tabler icons; candidate page, voter flow, receipt check, Admin Voting election controls, manually refreshed Dasbor, fixed-electorate statistics, count check, overall tally and a korda-level results table. Regional results under 10 ballots are suppressed; public tally appears only after publication.
- **Branding**: operator-supplied local logo asset and configured chapter name on public pages; no browser upload or crop. The local email-button demonstration shows an explicitly simulated toast, never a delivery claim or actual send.
- **Audit**: append-only hash chain for admin, voter and system actions, an integrity view for admins, and a fixed closing snapshot hash on the public board. No audit CSV or advanced filters in 1.0.

**1.1 / phase 2**: browser `/setup` and deploy-button rehearsal; real email delivery, reminders, rich candidate editor/media, interactive regional map and detailed komsat tally, browser logo upload/crop, expanded settings, audit filters/CSV. Existing email transport code may remain but is not wired into 1.0 user flows.

## Capabilities

### New Capabilities
- `system-onboarding`: operator bootstrap, uninitialized-site guard and first Admin Voting; browser setup follows in phase 2.
- `auth-and-eligibility`: One Login, fresh sign-in and frozen-roll eligibility, admin roles, copyable invitations and recovery.
- `voter-roll`: manual Draf sync and final frozen roll; no contacts or reminders in 1.0.
- `election-lifecycle`: one election, scheduled stages, readiness checks, Uji Coba, extension, early close and publication.
- `candidate-management`: structured basic candidate records and public page.
- `voting-and-receipts`: one secret ballot, browser-side receipt hashing and public hash board.
- `admin-dashboard`: manual refresh, overall tally, korda results, statistics and count check.
- `public-site`: landing page, published results, local logo and search-engine blocking.
- `instance-settings`: operator-managed configuration and static branding; no email delivery.
- `audit-log`: hash-chained entries, integrity view and closing snapshot.

### Modified Capabilities
- (none — nothing is archived yet; earlier drafts of `voting-and-turnout` are replaced by `voting-and-receipts` and `admin-dashboard`)

## Impact

- **Repository**: Hono + Astro Worker with D1; existing R2/email utilities remain unused by the 1.0 journey. Manual bootstrap must replace the wizard dependency in the current setup guard and OIDC configuration loader. README must describe the operator path and frozen-roll rule instead of promising browser installation.
- **Local integration**: reuse the already warm ppij-identity test Keycloak at `127.0.0.1:38180` with an isolated election realm/client and personas; never start or stop its shared stack. Miniflare provides local D1/R2. A deterministic Service API HTTP fixture covers `changed_since`, paging, scope and `no_grant`; no direct Postgres shortcut.
- **Release boundary**: development and full browser rehearsal are local, without Wrangler push. A real ppij-identity grant, deploy-button provisioning and Cloudflare staging rehearsal remain unverified release gates, not claims established by local tests.
