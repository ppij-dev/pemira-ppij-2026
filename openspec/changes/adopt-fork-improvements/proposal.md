# Proposal: Adopt fork improvements (preview mode, receipt v2, candidate content, account home)

## Why

The Pemira 2026 national instance (`pemira-ppij-2026`) ran a live preview election
and evolved the product under real use: a Service-API-free preview mode (the
upstream Service API does not exist yet), an easier receipt format, a safer vote
guard for operator schedules, a two-step ballot confirmation, an account home,
and a candidate content model with photos and Markdown profiles. These changes
are battle-tested there but upstream still carries the pre-fork behavior, so
every future fork sync re-imports divergent code. This change adopts the tested
implementations into upstream so the forks return to branding-only divergence.

## What Changes

- **Preview mode (`preview_mode` on elections)**: when enabled in Draf, ACTIVE
  in-scope members auto-register into the roll from their One Login claims and
  can vote immediately; Kunci skips the Service API final sync and allows a
  current `opens_at`. For rehearsals; the official frozen-roll flow is
  unchanged when the flag is off.
- **Receipt format v2**: codes are 80-bit, 16 Crockford characters, displayed
  as `XXXX-XXXX-XXXX-XXXX`. Legacy 26-character codes remain verifiable.
- **Vote write guard**: `opens_at`/`closes_at` compared as instants
  (`julianday`), fixing rejection of operator schedules saved with a
  `+09:00` offset.
- **Session validity replaces the 10-minute rule**: a valid sealed session
  (max 7 days) is sufficient to vote; only a future `auth_time` is rejected.
  Spec delta against the MVP's fresh-login requirement.
- **Two-step ballot confirmation**: a radio candidate list in a bottom sheet
  (mobile and desktop) followed by an explicit confirmation; the nickname is
  still sent as `confirmation_text` and validated server-side.
- **Account home `/akun`**: identity, election status, Admin Voting entry, and
  Keluar; header avatar chip; admin pages redirect unsigned visitors to One
  Login via middleware; failed sign-ins get one recovery card (adopts
  `recover-login-session`); `no-store` on auth redirects.
- **Candidate content**: `short_intro` column, per-candidate photos via
  `photo_key`, Markdown `description` rendering (escape-first) with
  click-to-load YouTube embeds and a photo lightbox, name ≤ 60 / nickname ≤ 24
  validation, dedicated listing cards.
- **UI**: human countdown ("X hari HH:MM:SS"), unit display names
  (`formatUnitPath`), white profile canvas, committee privacy copy.
- Data stays fork-local: seeded candidates, logos, wrangler values are not
  part of upstream.

## Capabilities

### Modified
- `voting-and-receipts`: preview-mode eligibility, receipt format v2 with
  legacy verification, instant-based open guard, session-validity eligibility.
- `candidate-management`: photos, `short_intro`, Markdown profiles, length
  validation, listing card component.
- `auth-and-eligibility`: account home, middleware redirect, recovery card
  adoption, no-store redirects.

## Impact

- Code: `src/server/voting/*`, `src/server/election/*`, `src/server/auth/*`,
  `src/pages/*` (public, admin, akun), `src/layouts/*`, `src/middleware.ts`,
  `src/lib/*`, `src/styles/global.css`.
- Migrations: `0006_preview_mode.sql`, `0007_candidate_short_intro.sql`.
- Tests: `preview-mode`, `lib/markdown` added; `vote-api`, `receipt-board`,
  `auth-session`, `candidates`, `election-lifecycle` updated.
- Dependencies: none added.
