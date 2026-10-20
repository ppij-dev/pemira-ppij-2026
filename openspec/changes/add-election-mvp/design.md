# Design: Local-first election MVP (1.0)

## Context

The proposal defines the lean 1.0 journey. Cloudflare Worker, D1 and One Login remain the production
architecture, but overnight development and end-to-end verification run locally. The ppij-identity
Service API is not implemented yet. No Wrangler push or separate Keycloak container is required.
Existing `/setup` guard, email transports, and migrations are partial groundwork, not
evidence that their previously planned UI flows exist. R2 is not used and has been removed;
in 1.0 candidates share `/placeholder-candidate.png` under `public/` and only the logo is configurable
via `SITE_LOGO_PATH`. Per-candidate photos and rich media upload in 1.1 will require a storage decision, as R2 requires a paid plan.

## Goals / Non-Goals

**Goals:** one complete locally rehearsed election; fixed electorate and fresh ACTIVE sign-in;
secret ballot with public hash proof; operator bootstrap; templui-based mobile-first UI with
Tabler icons; deterministic local test dependencies; manual refresh and no background jobs.

**Non-Goals for 1.0:** browser `/setup`, real outgoing email, reminders, photo/media upload,
arbitrary candidate HTML/CKEditor, interactive map, komsat-level results, browser logo crop,
advanced settings and audit CSV. These belong to a separately planned 1.1 change; do not leave
fake-success versions of them in the public product.

## Decisions

### 1. Runtime and local verification

Astro SSR and Hono share one Cloudflare Worker; D1 stores election data. Miniflare runs D1
tests locally and Playwright drives the built local preview. Reuse ppij-identity's warm test
Keycloak (`http://127.0.0.1:38180`) for real OIDC browser flows. Provision an election-specific
realm/client and disposable personas; never alter the shared `ppij` realm or start/stop the warm
stack. A deterministic HTTP Service API fixture implements the same client-facing responses
(cursor paging, `changed_since`, scope and `no_grant`) until the sibling service is available.
Do not read its Postgres tables as an application shortcut. Config and secrets are explicit per
local process: another session's exported environment is not inherited.

### 2. Operator bootstrap

An operator applies D1 migrations, sets the One Login issuer/client, Service API endpoint/client,
scope, base URL, site name/logo path and `APP_MASTER_KEY` through the documented Wrangler/local
config and secrets, then runs a repeat-safe bootstrap command with the first Admin Voting
`member_id`. The bootstrap command supports both local Miniflare (`npm run bootstrap -- <member_id>`)
and remote Cloudflare D1 (`npm run bootstrap -- --remote --database <name> <member_id>`) using shared
SQL statements executed via `wrangler d1 execute --remote --file <tmp>`. The command validates required
configuration, initializes exactly one draft election, creates the labelled Technical Admin and marks
the site initialized. The named admin still needs an ACTIVE, in-scope One Login session for access.
A missing/partial bootstrap returns 503 on public and API routes; `/setup` and `/api/setup/*` return 404
in 1.0. No public endpoint can initialize the site. Keep secret values out of D1 plaintext and logs.
The command supports `--dry-run` to output SQL without execution, short-circuits safely when the site
is already initialized, and aborts if an admin exists without initialized status.
The existing browser-claim guard from task 2.1 must be cut over for 1.0, not left as an alternate
setup route. Its tests need updating to the operator contract. Browser wizard and deploy-button
provisioning are phase 2, not local-development prerequisites.

### 3. Frozen roll and eligibility

In Draf, an Admin Voting explicitly syncs ACTIVE members and units through the Service API.
Kunci & Jadwalkan performs a final successful sync and atomically freezes the in-scope ACTIVE
roll before locking. A failed `no_grant`/transport/page blocks the lock. Later stages never sync.
At vote submission, both membership of that roll and `auth_time` no older than 600 seconds with
an in-scope `affiliation` are required; Admin Voting obey the locked participation setting.
Use the frozen roll's komsat path for the ballot, not a mutable client parameter.

### 4. Election stages and candidates

`status_lock` is draft, locked or published; the clock derives Terjadwal, Dibuka and Ditutup.
Uji Coba data in Draf is deleted at lock. Extend, close early and publish are audited actions.
Candidate records are selected from the Pemilih list, excluding Admin Voting, with unique
number and case-insensitive nickname. Cap candidates at ten to fit the existing unique-color
palette. The 1.0 public sample page renders structured text fields only (plain description,
never interpreted as HTML) and a downloaded local placeholder image; no editor, iframe or
remote image request is necessary.

### 5. Ballot and receipt

`participation(election_id, member_id, member_name, voted_at, is_test)` has a unique
`(election_id, member_id)` key. `ballots(id, election_id, candidate_id, komsat_path,
receipt_hash, is_test) WITHOUT ROWID` has a random UUID id, no member or timestamp. A D1
batch writes both or neither. Never log choice or raw code. Generate 128 random bits and
encode as 26 Crockford Base32 characters (last character uses only the remaining three bits);
display in groups for readability, but normalize separators/case before hashing. Only SHA-256
of the canonical code is persisted. The success page shows it once and keeps it on the device.
`/surat-suara#code` hashes in the browser; the server sees only the hash. After close, the
public board lists receipt hashes sorted by random ballot ID, count check and closing audit
snapshot. Browser-side matching highlights a hash without publishing the code.

### 6. Results and privacy

Admin Voting see an overall tally and a table aggregated by korda, manually refreshed and
audit-logged per tally load. No komsat breakdown or map in 1.0. Suppress a korda row's
candidate counts when it has fewer than ten ballots; the overall tally and turnout totals
remain available. Public tally and korda table appear only after Diumumkan. Hak pilih is the
frozen roll size (minus Admin Voting excluded by the locked setting); count check compares
participation and ballots independently.

### 7. Static branding and email demonstration

The operator sets chapter name and a local logo path; the bundled default is used if absent.
The same asset appears in the header, hero and favicon. No upload/crop or R2 media path is
required for this scope; candidates share `/placeholder-candidate.png` and logo is configured via `SITE_LOGO_PATH` with a file under `public/`. Per-candidate photos and rich media upload (1.1) will need a storage decision as R2 needs a paid plan.
user flows. A local-only email interaction demo may show `Email terkirim (simulasi)` after
clicking, but must not call a delivery endpoint or imply actual sending in production.

### 8. Audit and close snapshot

Audit entries are append-only and SHA-256 chained, with an Admin Voting integrity view. All
admin mutations and tally reads, voting and relevant system events are logged without secrets,
phones, choices or receipt codes. Because closing may be schedule-derived without cron, the
first post-close request finalizes a single idempotent close event/snapshot before serving
other actions; early close finalizes it in the close transaction. Persist the hash of that
event as the closing snapshot, not the perpetually growing audit chain tip. Later audit
entries continue the chain without changing the published snapshot. A repeated concurrent
first read must expose the same snapshot.

## Dependencies and release gates

Local tests use the shared warm Keycloak, fixture Service API, Miniflare and Playwright; they
must cover setup absence, frozen roll, eligibility, concurrent double vote, receipt privacy,
scheduled/early close, published results and audit integrity. Keep one serialized owner gate
after worker-focused checks; do not start duplicate Docker stacks. Real Service API grants,
actual Cloudflare deploy-button provisioning, and a staging election with real identity and
membership data remain explicit release gates before claiming deployability. README and
project context must be reconciled with this temporary operator-first scope.
