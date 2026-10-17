# Spec Delta

## Purpose

Lets a chapter deploy its own election site with one button and finish configuration once in the
browser at `/setup`, without command-line steps, while keeping a fresh site safe from strangers.

## ADDED Requirements

### Requirement: Deploy button provisions the site
The repository SHALL offer a "Deploy to Cloudflare" button that creates the Worker, the D1 database with migrations applied and the R2 bucket, so the installer only opens the resulting `.pages.dev` or `.workers.dev` address afterwards.

#### Scenario: Fresh deploy
- **WHEN** an installer clicks "Deploy to Cloudflare" in the README and confirms in Cloudflare
- **THEN** a site is reachable at its `.workers.dev` or `.pages.dev` address with an empty, migrated D1 database and an R2 bucket bound

### Requirement: Setup window and browser claim
While the site is not initialized, the first request to `/setup` SHALL record `first_boot_at` and set an `HttpOnly` claim cookie on that browser. Only the claiming browser SHALL use `/setup`, and only within 60 minutes of `first_boot_at`.

#### Scenario: First visit claims setup
- **WHEN** the installer opens `/setup` on a site that was never visited
- **THEN** the system records `first_boot_at`, sets the claim cookie and shows step 1 of the wizard

#### Scenario: Second browser during the window
- **WHEN** another browser opens `/setup` 10 minutes after the claim
- **THEN** it sees "Pemasangan sedang dilakukan dari perangkat lain" and cannot submit any step

#### Scenario: Window expired
- **WHEN** 60 minutes have passed since `first_boot_at` and setup is not complete
- **THEN** `/setup` returns HTTP 423 with a page in Bahasa Indonesia showing the one Wrangler command that reopens the window

### Requirement: Pages before setup is complete
While the site is not initialized, every path other than `/setup`, `/api/setup/*` and static assets SHALL show a "Situs pemilihan ini belum selesai dipasang" page with HTTP 503.

#### Scenario: Visitor before setup
- **WHEN** a member opens the landing page of a site still being set up
- **THEN** they see the not-yet-installed page and no election data

### Requirement: Setup configures connections
The wizard SHALL collect One Login issuer, client ID and secret; the scope (national, a korda or a komsat chosen from the unit list); the Service API client ID and secret; the base URL; and the email provider. It SHALL verify each connection before moving on.

#### Scenario: One Login verified
- **WHEN** the installer submits an issuer, client ID and secret
- **THEN** the system fetches `/.well-known/openid-configuration`, stores the secret encrypted and shows the exact callback URL to register

#### Scenario: Unreachable issuer
- **WHEN** the issuer URL cannot be reached
- **THEN** the step shows an error in Bahasa Indonesia that ends with "Kontak PPIJ Portal admin untuk meminta realm config untuk service"

#### Scenario: Service API verified
- **WHEN** the installer submits Service API credentials
- **THEN** the system requests a client-credentials token, calls the Service API once and shows how many ACTIVE members the scope returns

#### Scenario: Service API not granted yet
- **WHEN** the Service API answers `no_grant`
- **THEN** setup may continue, and the step warns that the Pemilih list, map and reminders stay empty until the Portal admin grants access

### Requirement: Final step binds the first Admin Voting
The last step SHALL ask the installer to sign in with One Login. If the signed-in person is an ACTIVE member inside the configured scope, they SHALL become the first Admin Voting, labelled Technical Admin, and the site SHALL be marked initialized.

#### Scenario: In-scope member finishes setup
- **WHEN** Dimas, ACTIVE in PPI Okayama, completes sign-in on a PPI Okayama site
- **THEN** Dimas becomes Admin Voting with the Technical Admin label and is taken to Dasbor

#### Scenario: Installer outside the scope
- **WHEN** a national volunteer outside PPI Okayama signs in at the last step of a PPI Okayama site
- **THEN** setup is not completed and the page says "Masuk dengan akun anggota aktif dari PPI Okayama"

### Requirement: Setup is gone after completion
Once initialized, `/setup` and `/api/setup/*` SHALL answer HTTP 404 permanently. Later changes go through Pengaturan.

#### Scenario: Setup after completion
- **WHEN** anyone requests `/setup` on an initialized site
- **THEN** the system returns 404

### Requirement: Custom domain redirect
When the base URL is a custom domain, requests to the `.pages.dev` or `.workers.dev` hostname SHALL redirect permanently to the same path on the custom domain.

#### Scenario: Old address used
- **WHEN** a voter opens `https://pemilu-oky.pages.dev/kandidat/01-budi` after the base URL became `https://pemilu.ppiokayama.jp`
- **THEN** they are redirected to `https://pemilu.ppiokayama.jp/kandidat/01-budi`
