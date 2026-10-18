# Proposal

## Why

PPI Jepang (national, Korda and Komsat) needs an open-source e-voting system (`ppij-dev/ppij-election-system`) that a chapter's volunteer committee can deploy to Cloudflare's free tier with one button and run without a developer. Eligibility comes from PPIJ One Login and the membership registry instead of Google Forms and spreadsheets, and every ballot is secret, one per member and traceable by its voter.

## What Changes

- **Deploy and one-time setup**: a "Deploy to Cloudflare" button, then a WordPress-style `/setup` on the `.pages.dev` / `.workers.dev` address (60-minute window, first-browser claim) for One Login, scope, Service API, domain and email. The final step binds the first **Admin Voting** (labelled **Technical Admin**) through One Login; `/setup` then disappears for good.
- **Roles**: **Admin Voting** (the election committee, all with equal rights, each an ACTIVE member inside the site's scope) and **Pemilih** (voters). **Admin Portal** means admins of the membership portal (ppij-identity), never of this site.
- **Eligibility at the moment of voting**: a member may vote when they are on the Pemilih roll frozen at **Kunci & Jadwalkan** and a fresh One Login sign-in (at most 10 minutes old) shows them ACTIVE inside the site's scope. Members who become ACTIVE after the lock cannot vote this election.
- **Pemilih roll from the Service API** (`ppij-identity` change `add-service-api`, Phase 1.3): synced on demand in Draf via "Sinkronkan Data Pemilih"; **Kunci & Jadwalkan** runs one final sync and freezes the roll (a snapshot of the ACTIVE members in scope at that moment). After the lock there is no sync in any stage. The frozen roll fixes the Hak pilih count and feeds the map, the Pemilih page and reminders. Phone numbers are fetched per click and never stored.
- **One election per site**: Draf, Dibuka, Ditutup, Diumumkan. Opening and closing follow the schedule with no background job; **Kunci & Jadwalkan** runs readiness checks; **Uji Coba** test votes in Draf; extend or close early with a reason; **Umumkan Hasil** publishes results.
- **Candidates**: one member each, picked from the Pemilih list, never an Admin Voting; number typed by the committee; free HTML page (CKEditor, embeds) rendered in a sandboxed frame; random color from 10 white-text-safe colors at Kunci.
- **Voting**: nickname typing to confirm, atomic one-time ballot in D1, receipt code with a `/surat-suara#<code>` page and email, public receipt board after close. Ballots record the voter's komsat for the regional map, never the member.
- **Dasbor for Admin Voting**: countdown, regional map, live tally, voter statistics against the frozen roll, count check (Surat Suara Terkirim vs Jumlah Suara di Kotak), all refreshed by a button. No polling or WebSockets.
- **Reminders**: WhatsApp link per voter, personal reminder email when there is no phone, copyable group announcement. No bulk email.
- **Public site**: promotional landing page (hero, candidates, countdown then results, call to vote) and the whole site hidden from search engines.
- **Pengaturan**: Identitas (logo crop, name, organisation website, live email preview), Pemilihan, One Login, Cakupan, Domain, Email, Data Pemilih.
- **Audit**: append-only, hash-chained log of Admin Voting, voter and system actions with a filterable read-only page and browser-built CSV export.

## Capabilities

### New Capabilities
- `system-onboarding`: Deploy button flow, `/setup` window and claim, configuration steps, binding the first Admin Voting, permanent disable and recovery.
- `auth-and-eligibility`: One Login sign-in, fresh-login rule, eligibility at vote time, Admin Voting roles, invitations, removal and recovery.
- `voter-roll`: Pemilih roll synced from the Service API, frozen at Kunci & Jadwalkan, with per-voter reminders.
- `election-lifecycle`: single election stages, schedule-driven status, readiness checks, Uji Coba, extension, early close and publication.
- `candidate-management`: candidate records, sandboxed rich pages, photos, colors and the edit lock.
- `voting-and-receipts`: Pilih Suara flow, nickname confirmation, atomic ballot, receipt code, receipt page, Bukti Suara tab and public board.
- `admin-dashboard`: Dasbor countdown, map, tally, statistics, count check and manual refresh.
- `public-site`: landing page, results view, Hasil tab, search-engine blocking.
- `instance-settings`: Pengaturan sections, branding and logo processing, email delivery and templates.
- `audit-log`: hash-chained audit entries, audit page, filters and CSV export.

### Modified Capabilities
- (none — nothing is archived yet; earlier drafts of `voting-and-turnout` are replaced by `voting-and-receipts` and `admin-dashboard`)

## Impact

- **Repository**: greenfield Hono + Astro on Cloudflare Workers/Pages with D1 and R2, `wrangler` config, D1 migrations and a Deploy to Cloudflare button.
- **ppij-identity**: needs a One Login client per site (login, `max_age`) and a Service API client with grants `organisasi`, `anggota.dasar` and `anggota.kontak` (change `add-service-api`, Phase 1.3). Signing in works without the Service API, but voting needs a frozen roll: without a grant Kunci cannot run the final sync and the election cannot be locked. The Pemilih roll, map and reminders need the Service API.
- **README**: tells installers "Kontak PPIJ Portal admin untuk meminta realm config untuk service" and shows the recovery command.
