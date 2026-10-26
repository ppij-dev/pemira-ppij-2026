# Spec Delta: Account home, admin redirect, recovery adoption, no-store

## ADDED Requirements

### Requirement: Account home

The site SHALL provide `/akun`: the signed-in member's identity (name,
member id, unit display name, membership state), election participation
status with a link to Bukti Suara, an Admin Voting entry for committee
members, and Keluar with confirmation. Signed-out visitors see a sign-in
card. The public and admin headers SHALL link to it through an avatar chip.

#### Scenario: Signed-in member

- **WHEN** an authenticated member opens `/akun`
- **THEN** identity, membership state and participation status render, with
  Keluar requiring confirmation before the session ends

### Requirement: Admin sign-in redirect

Unsigned browser navigation to any `/admin` page SHALL redirect to One Login
with a `return_to` target; after a completed callback that still has no
session, the system SHALL break the redirect cycle and route to the account
page recovery state instead of looping.

#### Scenario: Unsigned admin visit

- **WHEN** a visitor without a session opens `/admin/pemilihan`
- **THEN** the browser is redirected to One Login and returns to
  `/admin/pemilihan` after sign-in

#### Scenario: Cookie-refusing browser

- **WHEN** sign-in completes but the session cookie is not persisted and the
  visitor retries
- **THEN** the flow routes to the account page recovery state with guidance
  instead of redirecting to One Login again

### Requirement: No-store auth redirects

The login and callback redirect responses SHALL be marked `Cache-Control:
no-store` so browsers never replay cached redirect chains.

#### Scenario: Cached redirect chain

- **WHEN** a browser revisits the login entry after a completed sign-in
- **THEN** no cached login/callback redirect is replayed from cache
