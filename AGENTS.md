# AGENTS.md — ppij-election-system

Standalone, forkable, self-installable e-voting product (`git@github.com:ppij-dev/ppij-election-system.git`).
Any organization in the PPIJ ecosystem (PPIJ Pusat, a Korda, or a Komsat) can fork and self-host its own instance on Cloudflare.

## Stack & Architecture
- **Runtime & Hosting**: Cloudflare Pages / Workers, Cloudflare D1 (SQLite), Cloudflare R2 (media storage for candidate profiles & CKEditor uploads).
- **Backend API & Auth BFF**: **Hono** running on Cloudflare Workers (`/api/*`).
- **Frontend UI**: **Astro** + templui/shadcn-inspired CSS theme + `@tabler/icons`, mobile-first layout with fixed bottom navigation.
- **Identity & Eligibility**: Connects to **PPIJ OneLogin** (`sso.ppijepang.app`, realm `ppij`) via OIDC; eligibility comes from the `affiliation` claim (present only while membership is ACTIVE). The Pemilih list, membership changes and per-click contacts come from the ppij-identity Service API (`api.ppijepang.app/v1/service`, change `add-service-api`).

## Workflow
- Spec-driven with OpenSpec. No feature code without an approved change in `openspec/changes/`.
- Start a change: `/opsx:propose "<idea>"`. Implement: `/opsx:apply`. Finish: `/opsx:archive`.
- Copywriting: Bahasa Indonesia first; voice **friendly, helpful, secure** (see `../.agents/product-marketing.md`); no emoji; Tabler icons only.

## Roles (exact words)
- **Admin Voting**: election committee on this site; equal rights; ACTIVE member in scope; installer labelled **Technical Admin**.
- **Admin Portal**: admin of the membership portal (ppij-identity), never of this site.
- **Pemilih**: voter.

## Hard rules
1. **One-time setup**: Deploy to Cloudflare button, then `/setup` on the `.dev` address within 60 minutes of the first visit, claimed by the first browser. The last step binds the first Admin Voting through One Login. Afterwards `/setup` returns 404 forever; changes go through Pengaturan.
2. **Eligibility at the moment of voting**: a vote is accepted only when the session comes from a One Login sign-in at most 10 minutes old whose `affiliation` lies inside the site's scope. The Pemilih list never decides eligibility.
3. **Ballot secrecy**: `participation` (who, when) and `ballots` (candidate, komsat path, receipt hash; random ID, no timestamp, `WITHOUT ROWID`) are written in one D1 batch with nothing linking them. Only the SHA-256 of the receipt code is stored.
4. **One vote per member**: `PRIMARY KEY(election_id, member_id)` on `participation`, plus nickname typing in the UI and on the server.
5. **Never log** ballot choices, receipt codes, secrets or phone numbers. Phones from the Service API are used per click and never stored.
6. **Manual refresh only**: no polling, no WebSockets, no background jobs; stage is computed from the clock on each request.
7. **Audit**: append-only, hash-chained; every Admin Voting action including each tally view is recorded.
8. **Candidate content** is shown only inside a sandboxed iframe (`allow-scripts allow-popups`, never `allow-same-origin`).
