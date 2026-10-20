# Spec Delta

## Purpose
Defines the limited operator-managed configuration and static branding needed to run a
local 1.0 election without a browser setup or email-delivery workflow.

## ADDED Requirements

### Requirement: Operator-managed settings
The operator SHALL configure the issuer and client credentials for One Login, Service API
endpoint and credentials, scope, base URL, site name, logo asset path and master key through
documented Wrangler/local configuration. Secrets SHALL not be rendered to visitors or
stored in D1 plaintext. Cakupan and "Admin Voting boleh ikut memilih" SHALL be frozen
at Kunci & Jadwalkan; no browser settings editor is required in 1.0.

#### Scenario: Configuration loaded
- **WHEN** a site is bootstrapped with a valid issuer, scope and base URL
- **THEN** its login callback and election pages use those configured values without showing credentials

#### Scenario: Locked setting
- **WHEN** an operator attempts to change election scope after Kunci
- **THEN** the election keeps the frozen scope and does not silently change eligibility

### Requirement: Static branding
The public site SHALL show the configured chapter name and an operator-supplied local
logo asset, or its bundled default when no logo is configured. The logo SHALL also be
used as the favicon. No visitor request SHALL depend on an external placeholder host.

#### Scenario: Operator supplies a logo
- **WHEN** the configured name is "PPI Okayama" and the local logo asset is present
- **THEN** public pages show that name and image and the favicon uses the same asset

### Requirement: Email interaction is simulation only
In local demonstration, an email test control MAY show the toast "Email terkirim (simulasi)"
when clicked. It SHALL NOT send a message, mark email configured, or show an unqualified
delivery-success claim. Production 1.0 SHALL not expose a working email-delivery control.

#### Scenario: Local email demonstration
- **WHEN** a tester clicks the local-only email test control
- **THEN** the simulation toast appears and no delivery request is made
