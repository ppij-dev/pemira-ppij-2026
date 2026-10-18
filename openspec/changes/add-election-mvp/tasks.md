# Tasks

Dependencies: One Login client from ppij-identity (MVP task 2.6). Service API (`add-service-api`, Phase 1.3)
is needed for groups 5 and 8 against real data; until then tests use a recorded Service API fixture.

## 1. Scaffolding, data model and shared pieces

- [x] 1.1 Astro + Hono Worker project (`wrangler.jsonc` with D1 and R2 bindings, Tailwind theme, `@tabler/icons`, Vitest + Miniflare, Playwright) and a Deploy to Cloudflare button; verify `npm run build` and that the button provisions D1 and R2 on a test account, and record whether it can set `APP_MASTER_KEY` (button secret support verified against docs in `docs/deploy-button.md`; test-account provisioning still open)
- [x] 1.2 D1 migration with `system_config`, `admin_voting`, `invitations`, `elections`, `candidates`, `voters`, `membership_changes`, `participation`, `ballots` (WITHOUT ROWID), `reminders`, `audit_log`; verify schema tests including the unique participation constraint and absence of member columns in `ballots`
- [x] 1.3 AES-256-GCM secret helpers, `stage(now)` function and audit-chain writer; verify unit tests for round-trip encryption, every stage transition and chain breakage detection
- [x] 1.4 robots.txt, `X-Robots-Tag` middleware and meta tag in the base layout; verify tests for both headers and robots.txt

## 2. Setup

- [x] 2.1 `/setup` guard: not-installed page (503), first-visit claim cookie, 60-minute window (423 with recovery command), second-browser block, 404 after completion; verify integration tests for each scenario in `system-onboarding`
- [ ] 2.2 Steps for One Login (discovery check, callback URL), scope picker, Service API check (member count, `no_grant` warning), base URL and email test; verify API tests for valid and unreachable issuer and Service API states
- [ ] 2.3 Final step: One Login sign-in, in-scope check, first Admin Voting with Technical Admin label, initialized flag; custom-domain redirect; verify tests for in-scope and out-of-scope installers and the redirect
- [ ] 2.4 Setup wizard UI in Bahasa Indonesia (copy via `copywriting`); verify the full flow in a Playwright test

## 3. Sign-in, eligibility and Admin Voting

- [ ] 3.1 One Login BFF routes (login with PKCE and optional `max_age`, callback, logout, `/api/me`) keyed on `member_id`; verify session tests
- [ ] 3.2 Eligibility check (`auth_time` ≤ 600 s, affiliation under scope, setting for Admin Voting) and fresh-login redirect for Pilih Suara; verify tests for new member, out of scope, inactive, stale sign-in during confirmation
- [ ] 3.3 Admin Voting access check on every sign-in, equal rights, invitation (pick from Pemilih list, 72 h single-use, bound to `member_id`, copy link), removal with last-one guard, candidate block, Admin Portal label; verify tests for every scenario in `auth-and-eligibility`
- [ ] 3.4 Recovery Wrangler command and help page; verify the command creates a working invitation in a Miniflare test

## 4. Election lifecycle

- [ ] 4.1 Pemilihan page and API: schedule, readiness checks, Kunci & Jadwalkan (delete test data, draw colors, freeze), extend with reason, Tutup Sekarang, Umumkan Hasil; verify tests for every scenario in `election-lifecycle`
- [ ] 4.2 Uji Coba marking of test votes and yellow banner; verify a test vote is shown as test data and removed at lock

## 5. Pemilih list and reminders

- [ ] 5.1 Service API client (client credentials token cache, `changed_since` sync of `anggota.dasar`, `organisasi`, `anggota.riwayat`) and "Sinkronkan Data Pemilih"; verify tests against the recorded fixture, including `no_grant`
- [ ] 5.2 Pemilih page with search and filters (komsat, sudah/belum memilih); verify it never exposes choices
- [ ] 5.3 WhatsApp reminder (per-click contact lookup, `wa.me` number normalization, nothing stored) and email reminder with 24 h throttle; verify tests for `090-1234-5678` → `819012345678`, throttle, and that D1 holds no phone after a reminder
- [ ] 5.4 Perubahan Keanggotaan panel with per-komsat totals and detail list; verify tests for assisted additions with vote counts and for suspensions

## 6. Candidates

- [ ] 6.1 Candidate API: pick from Pemilih list, number and nickname uniqueness, Admin Voting block, YouTube parsing, Draf-only edits (409 otherwise); verify API tests
- [ ] 6.2 R2 media upload with magic-byte check and `/api/media/:key`; browser crop to 3:4 600×800 ≤200 KB; verify upload tests and a Playwright crop test
- [ ] 6.3 CKEditor with source view and image upload; content served sandboxed at `/kandidat/:slug/konten` with auto height; verify a Playwright test that a script in content cannot call the vote API with the viewer's session
- [ ] 6.4 Public candidate page `/kandidat/<nomor>-<nickname>` with "Pilih Sekarang" while open; verify rendering test

## 7. Voting and receipts

- [ ] 7.1 Vote API: eligibility, stage check, nickname match (400), atomic batch with komsat path and receipt hash, 409 on repeat, rate limit; verify tests for first vote, concurrent double vote, mismatch, closed election, and no member data in ballots
- [ ] 7.2 Receipt code generation, success screen, local storage, `/surat-suara#code` page hashing in the browser, receipt lookup with rate limit; verify tests that the code never reaches server logs or the request path
- [ ] 7.3 Voter UI: bottom navigation, Pilih Suara cards, confirmation sheet, state messages, Bukti Suara tab, Mode Pemilih / Mode Admin; verify Playwright tests on phone viewports
- [ ] 7.4 Public receipt board after close (codes in random order, count check, final audit hash, per-komsat change totals); verify tests before and after close

## 8. Dasbor and public site

- [ ] 8.1 Dasbor API and UI: manual refresh, countdown, statistics with new-member split, count check, committee warning, "Salin Teks Pengumuman"; verify tests including "Tidak sesuai" after a direct D1 insert
- [ ] 8.2 Tally chart and regional map with 10-ballot floor; every tally load audit-logged; verify tests for folding a 4-ballot komsat into its korda and for the audit entry
- [ ] 8.3 Landing page (hero, candidate cards, countdown, call-to-action by state, extension notice) and results view plus Hasil tab after publication; verify Playwright tests for each stage

## 9. Settings, branding and email

- [ ] 9.1 Pengaturan sections with masked secrets, stage rules, Uji Koneksi for One Login and Domain during voting; verify tests for each rule
- [ ] 9.2 Identitas: logo crop and two sizes, name, checkbox, organisation website, live email preview, Kirim Email Tes; verify size limits and preview in Playwright
- [ ] 9.3 Email providers (ZeptoMail, Resend, Mailgun, SMTP 465/587) and the four templates in one layout under 20 KB; verify tests with a mock transport and a size check per template (copy via `copywriting`)

## 10. Audit page

- [ ] 10.1 Audit API with filters and cursor, page with URL filters, expandable diffs, masked secrets and chain check; verify tests for filters and a broken chain
- [ ] 10.2 Browser CSV export with UTF-8 BOM and export audit entry; verify the downloaded file in Playwright

## 11. End-to-end

- [ ] 11.1 Full election rehearsal on a staging Cloudflare account with the staging One Login and Service API: deploy, setup, candidates, Uji Coba, lock, vote from three accounts, extend, close, publish; verify every count matches and the audit chain is intact
