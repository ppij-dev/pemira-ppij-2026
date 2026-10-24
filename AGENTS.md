# AGENTS.md — ppij-election-system

<!-- kot-optimize:begin -->
## Verification tiers
- Worker: build, vet or typecheck, and the focused tests for the code you changed (the narrowest test command for the code you changed, 120s max). Do not run the full suite, E2E or image builds.
- Gate (parent or one verifier, serialized): `scripts/gate.sh`. It holds a lock, applies per-stage timeouts, and runs cheap checks first.
- Run a one-second syntax or type check before any slow command.
- Every long command has an explicit timeout. On timeout, report and stop; do not raise the limit.
- Containers: use a unique compose project name and ports per worktree. Never reuse shared container names.
- Commit after each green step so another worker can resume from git.

## Delegation
- One worker = one verifiable unit (one task id, one layer). Backend and UI are separate workers.
- A brief carries file paths with line ranges, the decision already made, acceptance, and "no redesign".
- After delegating a slice the parent does not edit or test it; it reviews the diff or sends a fix to the worker.
- Reviewers get the diff plus 3 to 5 specific questions and a turn cap.

These tiers override any definition-of-done line elsewhere in this file for subagent workers.
<!-- kot-optimize:end -->

Standalone, forkable, self-installable e-voting product (`git@github.com:ppij-dev/ppij-election-system.git`).
Any organization in the PPIJ ecosystem (PPIJ Pusat, a Korda, or a Komsat) can fork and self-host its own instance on Cloudflare.

## Stack & Architecture
- **Runtime & Hosting**: Cloudflare Pages / Workers, Cloudflare D1 (SQLite); only D1 is provisioned (unused adapter KV session and Images bindings are disabled in `astro.config.mjs` via `session: false` and `imageService: "passthrough"`; session state uses sealed cookies and images are static files under `public/`). Candidates share `/placeholder-candidate.png` under `public/` and only the site logo is configurable via `SITE_LOGO_PATH` (per-candidate photos and rich media upload deferred to 1.1; R2 is not used, and rich media will require a storage decision as R2 requires a paid plan).
- **Backend API & Auth BFF**: **Hono** running on Cloudflare Workers (`/api/*`).
- **Frontend UI**: **Astro** + templui/shadcn-inspired CSS theme + `@tabler/icons`, mobile-first layout with fixed bottom navigation.
- **Identity & Eligibility**: Connects to **PPIJ OneLogin** (`sso.ppijepang.app`, realm `ppij`) via OIDC; eligibility needs the Pemilih roll frozen at Kunci & Jadwalkan plus the `affiliation` claim (present only while membership is ACTIVE). The Pemilih roll comes from the ppij-identity Service API (`add-service-api`; in local 1.0 via deterministic HTTP fixture — contacts/reminders deferred to 1.1).

## Workflow
- Spec-driven with OpenSpec. No feature code without an approved change in `openspec/changes/`.
- **Lean 1.0** is `openspec/changes/add-election-mvp` (revised 2026-10-20): local-first development and rehearsal — no Wrangler push, no real Service API grant (deterministic HTTP fixture), no outgoing email. Deferred to a later 1.1 change: browser `/setup` + deploy-button rehearsal, real email/reminders, rich candidate editor/media, Leaflet map + komsat results, logo upload/crop, audit filters/CSV.
- 1.0 deferrals are product boundaries, not optional extras: never ship a fake-success path for a deferred feature (e.g. an email button claiming delivery).
- Start a change: `/opsx:propose "<idea>"`. Implement: `/opsx:apply`. Finish: `/opsx:archive`.
- Copywriting: Bahasa Indonesia first; voice **friendly, helpful, secure** (see `../.agents/product-marketing.md`); no emoji; Tabler icons only. UI components/patterns: **shadcn-inspired local components under `src/components/ui/`** — the npm package `templui` is Go/templ-only, never add it as a dependency; "templui/shadcn-inspired" in specs means the visual language, not a package.
- Local identity testing reuses the shared warm ppij-identity Keycloak (`127.0.0.1:38180`) with an isolated election-test realm/client and personas; never start/stop that stack or alter the shared `ppij` realm. Each session passes its own explicit config — another session's exported environment variables are not inherited.

## Roles (exact words)
- **Admin Voting**: election committee on this site; equal rights; ACTIVE member in scope; installer labelled **Technical Admin**.
- **Admin Portal**: admin of the membership portal (ppij-identity), never of this site.
- **Pemilih**: voter.

## Hard rules
1. **One-time setup (lean 1.0: operator bootstrap)**: browser `/setup` is deferred to 1.1. For 1.0 the operator applies D1 migrations, sets required Wrangler/local config and secrets (One Login issuer/client, Service API endpoint/client, scope, base URL, site name/logo, `APP_MASTER_KEY`), then runs the documented repeat-safe bootstrap command with the first Admin Voting `member_id` (one draft election, Technical Admin label, site initialized). Until bootstrap completes, public pages/APIs return 503; `/setup` and `/api/setup/*` return 404. After bootstrap, `/setup` stays 404 forever; changes go through Pengaturan.
2. **Eligibility at the moment of voting**: a vote is accepted only when the member is on the Pemilih roll frozen at Kunci & Jadwalkan and the session comes from a One Login sign-in at most 10 minutes old whose `affiliation` lies inside the site's scope.
3. **Ballot secrecy**: `participation` (who, when) and `ballots` (candidate, komsat path, receipt hash; random ID, no timestamp, `WITHOUT ROWID`) are written in one D1 batch with nothing linking them. New receipts are 80 random bits encoded as 16 Crockford Base32 characters (four groups of four, normalized before hashing); previously issued 26-character receipts remain valid without truncation; only the SHA-256 of the canonical code is stored. After close the public board lists receipt **hashes**; the browser hashes the code locally, so raw codes are never sent to or stored by the server.
4. **One vote per member**: `PRIMARY KEY(election_id, member_id)` on `participation`, plus nickname typing in the UI and on the server.
5. **Never log** ballot choices, receipt codes, secrets or phone numbers. Phones from the Service API are used per click and never stored.
6. **Manual refresh only**: no polling, no WebSockets, no background jobs; stage is computed from the clock on each request.
7. **Audit**: append-only, hash-chained; every Admin Voting action including each tally view is recorded.
8. **Candidate content (lean 1.0)**: candidates are structured fields only — number, name, nickname, komsat, escaped plain-text description, assigned color and a bundled local placeholder image (no remote placeholder host). No CKEditor/HTML/photo/video until the 1.1 change; when that lands, rich content is shown only inside a sandboxed iframe (`allow-scripts allow-popups`, never `allow-same-origin`).
9. Staging server `ssh ppio` is shared with live PPIO apps — never touch those.
