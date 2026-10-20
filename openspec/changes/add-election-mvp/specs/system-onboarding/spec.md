# Spec Delta

## Purpose
Allows an operator to initialize one election site safely from configuration and D1 without
a public browser setup flow in 1.0.

## ADDED Requirements

### Requirement: Operator bootstrap
The system SHALL provide a documented repeat-safe operator command that, after D1 migrations
and required Wrangler/local configuration and secrets, creates exactly one draft election,
records the site's scope and base URL, binds the first Admin Voting by `member_id` with the
Technical Admin label, and marks the site initialized. Secret values SHALL not appear in
plaintext D1 rows or logs. The label SHALL grant no extra permissions.

#### Scenario: First bootstrap
- **WHEN** the operator supplies valid configuration and an initial `member_id` on a migrated empty D1 database
- **THEN** the site has one draft election and that member is labelled Technical Admin

#### Scenario: Repeated or partial bootstrap
- **WHEN** the same command is rerun or required configuration is missing
- **THEN** it does not create a second election or expose a partially initialized public site

#### Scenario: Remote bootstrap
- **WHEN** the operator runs remote bootstrap with `--remote --database <name> <member_id>`
- **THEN** it executes the same initialization statements against the remote D1 database via `wrangler d1 execute --remote`, safely short-circuiting if already initialized or aborting on partial state

### Requirement: No public setup in 1.0
Before bootstrap completes, public pages and APIs SHALL return HTTP 503 with a Bahasa Indonesia
not-ready message, except static assets. `/setup` and `/api/setup/*` SHALL return 404 both
before and after bootstrap; no unauthenticated request SHALL initialize the site.

#### Scenario: Visitor before initialization
- **WHEN** a visitor opens the landing page before bootstrap completes
- **THEN** it returns 503 without election data

#### Scenario: Setup URL
- **WHEN** anyone opens `/setup` in 1.0
- **THEN** it returns 404 and does not claim a browser or start a setup window

### Requirement: Admin identity after bootstrap
The named first Admin Voting SHALL sign in through One Login and have an ACTIVE affiliation
inside the configured scope before admin access is granted.

#### Scenario: Named member outside the scope
- **WHEN** the bootstrapped `member_id` signs in without an in-scope ACTIVE affiliation
- **THEN** the site remains initialized but admin routes refuse access with HTTP 403
