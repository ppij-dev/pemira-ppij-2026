# Tasks — lean 1.0 local MVP

Execution contract: plan → one verifiable unit → review → focused check, then the next
dependency. One worker owns one task/layer and its changed files; backend and UI
workers may run in parallel only after their API contract is fixed. Workers run a quick
type/syntax check, focused build/tests (120 s maximum), and commit each green unit.
They do not start/stop the shared ppij-identity Docker stack, run full E2E, or run
`scripts/gate.sh`. The integration owner reviews the changes, runs targeted local
Playwright journeys after backend/UI integration, and hands the serialized gate to
the owner. Do not rely on another session's exported `ENVIRONMENT` or other shell
variables; pass explicit local config. No Wrangler push during local development.

Critical path: operator bootstrap → real warm Keycloak sign-in plus Service API fixture
→ frozen roll/candidates/lock → vote/receipt → publish/results/audit → local rehearsal.
The sibling `add-service-api` is unfinished; fixture behavior must match its HTTP
contract, not read its Postgres database. Shared Keycloak is already warm on loopback
port 38180; create a unique election-test realm and clients/personas without changing
the shared `ppij` realm or creating another container.

## 1. Existing foundation (completed, not a claim of end-to-end readiness)

- [x] 1.1 Astro + Hono, D1 binding (R2 removed in 5.10), Tailwind, Tabler, Miniflare, Playwright and documented Deploy button; real-account provisioning remains unverified.
- [x] 1.2 Initial D1 schema with unique participation and `ballots WITHOUT ROWID`; amend it for the 1.0 plain description, frozen count and closing snapshot.
- [x] 1.3 Encryption helpers, clock stage and audit-chain writer with focused tests.
- [x] 1.4 noindex header, robots.txt and meta tag with tests.
- [x] 1.5 First-browser `/setup` guard and tests (former 2.1); 1.0 cutover in 2.1 makes that browser path obsolete.
- [x] 1.6 One Login BFF primitives and route tests (former 3.1); runtime config loader still missing.
- [x] 1.7 Email providers/templates and isolated tests (former 9.3); no outgoing-email user flow in 1.0.

## 2. Bootstrap and local identity — first runnable slice

- [x] 2.1 Backend: replace the browser setup path with documented repeat-safe operator bootstrap and runtime config loader for Wrangler/local secrets, scope, base URL, name/logo, first Technical Admin and one draft election; uninitialized 503, `/setup` 404, no public init route. Update old guard tests and prove a second bootstrap cannot duplicate or expose a partial site.
- [x] 2.2 Test harness: reuse the warm Keycloak through an isolated election realm/client with ACTIVE, suspended and out-of-scope personas; no compose up/down. Focused OIDC integration checks cover callback and stale/fresh `auth_time` with explicit per-process settings; the integration owner drives the browser journey.
- [x] 2.3 Backend: Admin Voting middleware, equal rights, candidate exclusion, copy-link single-use 72 h invitation, removal/last-one guard and operator recovery command. Test in-scope/expired access, forwarded link, candidate conflict, recovery and audit without email.
- [x] 2.4 UI: templui-based responsive shell and Tabler navigation, sign-in, uninitialized page and Admin Voting switch. Integrate against 2.1–2.3; focused UI check, with parent-owned Playwright sign-in journey. Invitation picking UI follows the roll in 3.3.

## 3. Frozen electorate and election preparation

- [x] 3.1 Backend: deterministic local Service API HTTP fixture plus actual client-credentials client and paged `changed_since` sync; in-scope ACTIVE roll, status removals, unit paths, `no_grant` and failed-page behavior. Test Draf-only manual sync and final sync; a failed final sync must leave Kunci uncommitted.
- [x] 3.2 Backend: basic candidate CRUD from the roll (number/nickname uniqueness, admin block, escaped plain description, Draf-only edits, 2–10 readiness), election schedule/Uji Coba, final roll freeze, delete test votes, distinct colors, extension/early close/publication and locked Hak pilih. Test state transitions, races, invariants and audit.
- [x] 3.3 UI: Pemilih list/search and manual sync, admin invitation picking, candidate editor, Pemilihan readiness/actions and structured public sample page with a downloaded local placeholder. Use templui and Tabler, no rich HTML or remote image fetch; parent-owned Playwright exercises prepare and lock on phone viewport after 3.1–3.2.

## 4. Secret ballot and proof

- [x] 4.1 Backend: fresh-affiliation-and-frozen-roll vote authorization, nickname confirmation, 5/min session limit, atomic participation/ballot D1 batch with random ballot ID, 409 concurrent duplicate, and no choice/code in logs or audit. Test suspended, after-lock joiner, stale sign-in, mismatch, closed vote and double submit.
- [x] 4.2 Backend: 128-bit/26-character Crockford receipt generation and normalization, hash-only lookup with 30/min IP limit, post-close hash board, independent count check and idempotent closing audit snapshot. Test code entropy/round trip, secrecy, unknown hash, scheduled-close concurrency and unchanged snapshot after later audit entries.
- [x] 4.3 UI: templui/Tabler mobile Pilih Suara confirmation, success/copy/local storage, Bukti Suara and `/surat-suara#code` browser hashing, hash-board local highlight and stage messages. Parent-owned Playwright covers vote, repeat vote, different device and no raw code in server URL.

## 5. Results, audit and integrated rehearsal

- [x] 5.1 Backend: manually refreshed Dasbor overall tally, turnout and participation/ballot count check, frozen Hak pilih and korda-level candidate counts suppressed below ten ballots; audit each tally load and keep public counts hidden until Diumumkan. Test small korda, tampered D1 count and no vote-choice exposure.
- [x] 5.2 UI: Dasbor countdown/refresh, warning and korda table; stage-aware branded landing page, candidate cards, public results/Hasil tab and static logo/favicon. Local email interaction, if shown, says "Email terkirim (simulasi)" and sends nothing. Parent-owned Playwright covers Draf, Terjadwal, Dibuka, Ditutup, Diumumkan and mobile result privacy.
- [x] 5.3 Backend: chronological Audit API and chain-integrity check including closing snapshot; test tampered/deleted rows, later append, secret masking and admin-only access.
- [x] 5.4 UI: read-only Audit page with integrity status, integrated against 5.3; focused UI check and parent-owned browser verification of intact/broken chain.
- [x] 5.5 Integration owner: document operator bootstrap, explicit local settings and frozen-roll eligibility in README; run one local election rehearsal using warm Keycloak, Service API fixture, Miniflare and targeted Playwright (setup absent → candidates → Uji Coba → final sync/Kunci → three distinct voters → extend/close → publish → counts, hashes and audit). Review each worker commit and hand the owner a ready-for-gate report with branch and commands run.
- [x] 5.6 Remote operator bootstrap: `npm run bootstrap -- --remote --database <name> <member_id>` runs the same statements as the local path through `wrangler d1 execute --remote`; shared statement builder, idempotent, `--dry-run`, README and spec wording about "--remote unsupported" updated; verify with a focused unit test using an injected executor (no real remote call).
- [x] 5.7 Deploy-button configuration prompt: only true secrets (`ONELOGIN_CLIENT_SECRET`, `SERVICE_API_CLIENT_SECRET`, `APP_MASTER_KEY`) are masked; non-secret settings (issuer, client IDs, service URL, scope, base URL, name, logo path) are visible, editable plain `vars`; README and local `.dev.vars.example` guidance stay consistent; verify against Cloudflare docs and a focused check that local dev and the bootstrap CLI still read all required keys.
- [x] 5.8 Configurable site logo: header, landing and favicon use `SITE_LOGO_PATH` (stored as `system_config.site_logo_path`) instead of hardcoded `/logo.svg`, favicon `type` derived from extension; Okayama logo `ppi-okayama-logo.webp` shipped as a local static asset; verify with a focused check of rendered pages and no third-party image request.
- [x] 5.9 Deploy to Cloudflare badge in README with the repo URL, plus honest guidance on the two install paths (button: prompted secrets and provisioned D1; "import repository" in the dashboard: no prompt, set secrets manually); README wording that calls the button a 1.1 feature is corrected; verify the badge URL form against Cloudflare docs.
- [x] 5.10 Remove R2: drop the `MEDIA` binding and `r2_buckets` from wrangler.jsonc, the `MEDIA` field from `Bindings`, the R2 setup in vitest config, test mocks and every doc/spec mention that says D1 and R2 are provisioned; candidate placeholder and logo images are static files under `public/` shipped with the repo (no upload path; per-candidate photos deferred to 1.1); verify that tsc, build, `wrangler deploy --dry-run` and the focused tests pass with no R2 binding.

## Deferred to a separately planned 1.1 change (not tracked as 1.0 tasks)

Browser `/setup` wizard and one-button install rehearsal; email delivery and personal reminders;
rich candidate editor/media/video/photo; Leaflet map and komsat-level results; browser logo
upload/crop and email preview; expanded settings, audit filters/CSV. Do not ship fake
success paths for these. The checked email transport code remains unused until wired in 1.1.

## Unverified release gates (not part of the no-push local loop)

Real Service API grant and contract test with ppij-identity; Cloudflare deploy-button
provisioning of D1 and secret prompt; staging election with real OIDC and Service API;
serialized owner-run `scripts/gate.sh`. Passing local fixtures does not establish these.
