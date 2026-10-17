# Design: Self-Hostable PPIJ Election System MVP

## Context

Greenfield repository; see `proposal.md` for motivation. Constraints:
- Volunteer committees rotate yearly with little budget: the site must run on Cloudflare's free tier
  (Workers, D1, R2) and be deployable by a non-developer.
- Identity and membership live in `ppij-identity`: One Login (`sso.ppijepang.app`, realm `ppij`) and the
  Service API (`api.ppijepang.app/v1/service`, change `add-service-api`, Phase 1.3). Per `sso-contract.md`
  the `affiliation` claim is present only while membership is ACTIVE.
- A fresh deploy is public on `*.pages.dev` / `*.workers.dev` before anyone configures it.

## Goals / Non-Goals

**Goals:**
- One-button deploy, browser-only setup, no background jobs, no WebSockets.
- Secret ballot by construction: no stored link between member and ballot.
- Cheap on Worker CPU and D1: manual refresh, browser-side image processing and CSV export.

**Non-Goals:**
- Several elections per site, paired candidates, blank ("kotak kosong") option, ranked voting.
- Bulk email, scheduled reminders, 2FA for Admin Voting, two-person approval.
- Hiding the live tally from Admin Voting (accepted risk, see below).
- Editable landing-page HTML (later change).

## Decisions

### 1. Stack: Astro + Hono in one Worker, D1, R2
Astro (SSR, Cloudflare adapter) renders pages with a templui/shadcn-inspired Tailwind theme and
`@tabler/icons`; Hono serves `/api/*` in the same Worker with bindings `DB` (D1) and `MEDIA` (R2).
Leaflet + OpenStreetMap for the map, Chart.js for the tally, CKEditor 5 for candidate content.
- *Alternative:* Go + Postgres on a VPS. Rejected: costs money and maintenance per chapter.

### 2. Deploy button and `/setup`
The README's "Deploy to Cloudflare" button provisions D1 (migrations) and R2 from `wrangler.jsonc`.
`APP_MASTER_KEY` (AES-256-GCM for secrets in D1) is requested by the button as a Worker secret if the
button supports secrets (to verify in task 1.1). If it does not, the Worker generates a key on first boot
and keeps it in `system_config`; that only loses protection against a leak of the D1 database alone.
Setup state lives in `system_config`. The claim cookie holds a random token whose hash is stored; the
window is 60 minutes from `first_boot_at`; recovery is
`npx wrangler d1 execute DB --remote --command "UPDATE system_config SET first_boot_at = NULL WHERE initialized = 0"`.
- *Alternative:* a setup token printed by a CLI script. Rejected: not usable by non-developers; the
  residual risk is low because `workers.dev`/`pages.dev` names are covered by wildcard certificates and
  do not appear in certificate logs.

### 3. Eligibility from the token, the Pemilih list from the Service API
Voting reads only the session: `auth_time` within 600 s and `affiliation` under the scope path. The
Service API feeds `voters` (member_id, name, nickname, komsat_path, status, synced_at) and
`membership_changes` (type, source, actor, from/to, at) through `changed_since` syncs; units and map
points come from `organisasi`. Contacts are fetched per click with `on_behalf_of = <Admin Voting member_id>`
and never written to D1.
- *Alternative:* a frozen roll exported at opening. Rejected by the committee: members approved during
  voting must be able to vote.

### 4. Stage computed from the clock
`elections(status_lock: draft|locked|published, opens_at, closes_at, closed_early_at NULL)`. Stage =
draft → Draf; locked and now < opens_at → Terjadwal; locked and opens_at ≤ now < closes_at and no
early close → Dibuka; otherwise Ditutup; published → Diumumkan. Every handler calls one `stage(now)`
function; there is no cron.

### 5. Ballot secrecy in D1
```text
participation(election_id, member_id, member_name, voted_at, is_test, PRIMARY KEY(election_id, member_id))
ballots(id TEXT PRIMARY KEY, election_id, candidate_id, komsat_path, receipt_hash UNIQUE, is_test) WITHOUT ROWID
```
`env.DB.batch([insertParticipation, insertBallot])` runs as one transaction; a duplicate member fails the
whole batch. `ballots.id` is a random UUID and the table has no rowid and no timestamp, so neither
insertion order nor time links a ballot to a participation row. Results and the public board order by
`id` (random). Receipt: 16 random bytes, Crockford base32 grouped `XXXX-XXXX-XXXX-XXXX`; stored as
SHA-256. `/surat-suara#code` hashes in the browser (Web Crypto) and calls `GET /api/receipts/:hash`.

### 6. Regional results with a 10-ballot floor
Ballots store the voter's komsat path from the session. Aggregation per komsat; komsats under 10 ballots
are merged into their korda and flagged. Applied identically on Dasbor and in published results.

### 7. Candidate content isolation
Content is stored as-is and served from `/kandidat/:slug/konten` with
`Content-Security-Policy: sandbox allow-scripts allow-popups`, embedded by an iframe with the same sandbox
attribute. Without `allow-same-origin` the frame has an opaque origin: `SameSite=Lax` session cookies are
not sent from it and it cannot read the parent. Height is reported with `postMessage` and accepted only
from that frame.
- *Alternative:* HTML sanitizing with an allowlist. Rejected: the committee wants arbitrary embeds.

### 8. Images in the browser
Logo and candidate photos are cropped and resized with a canvas in the browser; the server only checks
type from magic bytes and size, then writes to R2 and serves through `/api/media/:key` with long caching.

### 9. Audit chain
`audit_log(seq INTEGER PRIMARY KEY, at, actor_type, actor_member_id, actor_name, action, target, komsat_path,
detail_json, prev_hash, hash)` with `hash = SHA-256(prev_hash || canonical row)`. Inserted in the same batch
as the action it records where possible. The page verifies the chain in pages of 500. CSV export calls the
same JSON endpoint with a cursor and assembles the file in the browser.

### 10. Email
One HTML layout (table-based, inline styles, logo as 192×192 PNG URL, no tracking pixel) rendered by the
Worker for four templates. HTTP providers via `fetch`; SMTP via `cloudflare:sockets` on 465/587. Reminder
throttle: `reminders(member_id, channel, sent_at)` with one email per 24 h.

## Risks / Trade-offs

- [Live tally plus the who-voted list can reveal a single vote when votes are sparse] → Accepted as a
  committee-trust issue; every tally view is audit-logged so comparisons leave a trail.
- [An Admin Portal can create members during voting who then vote] → Visible in the membership-change
  panel with the acting Admin Portal named; the identity side can tighten this later.
- [An Admin Portal can suspend or move members to keep them from voting, or slow renewals] → Visible in the
  same panel; no prevention in the MVP.
- [The Cloudflare account owner can edit D1 directly] → The count check and the audit chain detect edits;
  the final chain hash is published at close.
- [A stranger reaches a fresh `.dev` URL first] → 60-minute window, single-browser claim, and the last step
  requires an in-scope One Login account.
- [Service API not granted yet] → Signing in and voting still work; only the Pemilih list, map, reminders
  and membership-change panel are empty.
- [Phone number not on WhatsApp] → WhatsApp shows its own error; the email icon is used when no phone exists.

## Migration Plan

1. Chapter asks the PPIJ Portal admin for a One Login client (redirect URI from setup) and a Service API grant.
2. Deploy with the button, open `/setup` within 60 minutes, configure and sign in as the first Admin Voting.
3. Prepare candidates, run Uji Coba, sync the Pemilih list, then Kunci & Jadwalkan.
Rollback: before Kunci, delete and redeploy; after Kunci, close early and publish nothing.
