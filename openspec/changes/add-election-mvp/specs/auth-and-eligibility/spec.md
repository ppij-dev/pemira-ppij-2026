# Spec Delta

## Purpose

Signs people in through PPIJ One Login, decides at the moment of voting who may vote, and manages
the Admin Voting committee: who can join, how they are invited and removed, and how access is recovered.

## ADDED Requirements

### Requirement: One Login sign-in keyed on member_id
The system SHALL sign everyone in through One Login (authorization code flow with PKCE, scopes `openid ppij-member ppij-affiliation`) and SHALL key people only on the `member_id` claim, never on email or username. Sessions SHALL be `HttpOnly`, `Secure`, `SameSite=Lax` cookies.

#### Scenario: Member signs in
- **WHEN** Budi clicks "Masuk dengan PPIJ One Login" and signs in
- **THEN** the system stores a session for Budi's `member_id` with his `affiliation` and `auth_time`, and returns him to the page he came from

### Requirement: Eligibility at the moment of voting
A person SHALL be eligible to vote if and only if, when the vote is submitted, their session comes from a sign-in at most 10 minutes old and its `affiliation` claim lies inside the site's scope (national `/ppij/*`, korda `/ppij/<korda>/*`, komsat `/ppij/<korda>/<komsat>`).

#### Scenario: Member who joined during voting
- **WHEN** Dewi becomes ACTIVE in PPI Okayama on day 3 of voting and signs in to the PPI Okayama site
- **THEN** Dewi may vote

#### Scenario: Member outside the scope
- **WHEN** a member of PPI Kyodai signs in to a PPI Okayama site
- **THEN** Pilih Suara shows "Pemilihan ini khusus anggota PPI Okayama" and any vote request is rejected with HTTP 403

#### Scenario: Membership not active
- **WHEN** Gita, whose membership expired, signs in
- **THEN** the token has no `affiliation`, Pilih Suara shows "Keanggotaan Anda belum aktif" with a link to `portal.ppijepang.app`, and vote requests are rejected with HTTP 403

### Requirement: Fresh sign-in before voting
Opening Pilih Suara SHALL send the person back to One Login with `max_age=600` when their sign-in is older than 10 minutes, and the server SHALL reject a vote whose `auth_time` is older than 10 minutes.

#### Scenario: Old session
- **WHEN** Budi signed in 2 hours ago and opens Pilih Suara
- **THEN** he is asked to enter his password at One Login again before seeing the candidates

#### Scenario: Time runs out during confirmation
- **WHEN** Budi's sign-in turns 11 minutes old before he presses "Kirim Suara"
- **THEN** the server rejects the vote with HTTP 401, records nothing, and the page asks him to sign in again

### Requirement: Admin Voting must be in scope and active
Admin Voting SHALL be ACTIVE members inside the site's scope, checked on every sign-in from the `affiliation` claim. Someone who no longer meets this SHALL lose access to admin pages at once while keeping their Admin Voting record.

#### Scenario: Admin Voting membership expires
- **WHEN** Rina's membership expires during the election
- **THEN** her next sign-in shows no admin menu and Dasbor answers HTTP 403

### Requirement: Admin Voting have equal rights
Every Admin Voting SHALL have the same rights over every admin page, including Pengaturan. The installer SHALL carry the label Technical Admin, which grants nothing extra.

#### Scenario: Committee member changes email settings
- **WHEN** Rina, an Admin Voting who did not install the site, changes the email provider
- **THEN** the change is saved and audit-logged

### Requirement: Inviting Admin Voting
An Admin Voting SHALL invite others by picking a person from the Pemilih list. The system SHALL create a single-use link valid for 72 hours, bound to that `member_id`, send the Undangan Admin Voting email and offer "Salin Tautan".

#### Scenario: Invitation accepted
- **WHEN** Andi opens his invitation link within 72 hours and signs in as himself
- **THEN** Andi becomes Admin Voting, the link is consumed, and the action is audit-logged

#### Scenario: Forwarded link
- **WHEN** someone other than Andi opens Andi's invitation and signs in
- **THEN** the invitation is refused and stays unused

#### Scenario: Email not configured
- **WHEN** email delivery is not configured
- **THEN** the invitation is still created and only "Salin Tautan" is offered

### Requirement: Who cannot be Admin Voting
A candidate SHALL NOT be or become Admin Voting. A person who is also an Admin Portal SHALL be allowed and SHALL be shown with the label "Admin Portal <unit>".

#### Scenario: Candidate invited
- **WHEN** an Admin Voting tries to invite Budi, who is candidate 01
- **THEN** the invitation is refused with "Kandidat tidak dapat menjadi Admin Voting"

#### Scenario: Admin Portal on the committee
- **WHEN** Rina, admin of PPI Okayama on the membership portal, is Admin Voting
- **THEN** the Admin Voting list shows "Admin Portal PPI Okayama" next to her name

### Requirement: Removing Admin Voting
Any Admin Voting SHALL be able to remove any other Admin Voting or cancel an invitation at any time. The last Admin Voting SHALL NOT be removable. The removed person SHALL receive an email when email is configured.

#### Scenario: Removing the last one
- **WHEN** only Dimas remains and someone tries to remove him
- **THEN** the system refuses with "Harus ada minimal 1 Admin Voting"

### Requirement: Admin Voting may vote by setting
When "Admin Voting boleh ikut memilih" is on (the default), an Admin Voting who is eligible SHALL vote like any member through Mode Pemilih. When it is off, Admin Voting SHALL NOT vote and SHALL be excluded from the eligible count.

#### Scenario: Setting off
- **WHEN** the setting is off and Rina opens Pilih Suara
- **THEN** she sees "Admin Voting tidak ikut memilih di pemilihan ini" and vote requests are rejected with HTTP 403

### Requirement: Recovery when no Admin Voting can sign in
A help page and the README SHALL show one Wrangler command for the Cloudflare account owner that creates a fresh Admin Voting invitation link for a given `member_id`.

#### Scenario: Committee lost access
- **WHEN** the Cloudflare account owner runs the recovery command with Sari's `member_id`
- **THEN** the command prints an invitation link that makes Sari Admin Voting after she signs in, and the event is audit-logged
