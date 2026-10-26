# Spec Delta: One Login recovery

## ADDED Requirements

### Requirement: Identify the observed sign-in failure stage

For browser navigation, the system SHALL distinguish a canceled sign-in, an
incomplete OIDC callback, and a completed callback whose destination request
has no readable session. The latter classification SHALL require a short-lived,
tamper-resistant server-issued success marker. A visitor-supplied query
parameter SHALL never establish authentication or prove a browser cause.

#### Scenario: Callback transaction is missing or expired

- **WHEN** the browser returns to `/api/auth/callback` with an OIDC state for
  which no valid `ppij_auth_tx` transaction can be opened
- **THEN** no session is created and the account page shows the incomplete
  sign-in recovery state, not a claim that Chrome blocked a cookie

#### Scenario: Token exchange or verification fails

- **WHEN** the callback has a valid transaction but cannot exchange or verify
  the returned token
- **THEN** no session is created and the account page shows the incomplete
  sign-in recovery state without revealing the token or internal exception

#### Scenario: Session is issued but not returned

- **WHEN** a valid callback issues `ppij_session` and redirects with a valid
  short-lived success marker, but the next destination request has no readable
  session
- **THEN** the account page shows the session-unavailable recovery state;
  it does not assert whether a browser setting, stale cookie, extension, or
  another cause prevented the session from being read

#### Scenario: Sign-in is canceled

- **WHEN** One Login returns an OIDC cancellation error
- **THEN** the account page says that sign-in was canceled and offers a fresh
  sign-in action without presenting a technical warning

### Requirement: Give one clear recovery action

The system SHALL show one recovery card with one primary "Coba masuk lagi"
action on `/akun` after a failed sign-in. It SHALL replace the ordinary
"Belum masuk" card for that request. Retry SHALL create a fresh PKCE/state
transaction and request an interactive One Login sign-in. The system SHALL
never start an automatic OIDC retry loop.

#### Scenario: Incomplete callback

- **WHEN** a voter reaches `/akun` after an incomplete callback
- **THEN** one card says "Masuk belum selesai", explains "Kami belum bisa
  menyelesaikan masuk lewat PPIJ One Login. Silakan coba lagi.", and offers
  "Coba masuk lagi" as the only primary action

#### Scenario: Session unavailable after callback

- **WHEN** a voter reaches `/akun` after a completed callback without a
  readable session
- **THEN** one card says "Sesi masuk belum aktif", explains "Kami belum bisa
  membaca sesi masuk di peramban ini.", offers "Coba masuk lagi", and places
  browser troubleshooting in secondary help rather than the lead message

#### Scenario: Ordinary signed-out visit

- **WHEN** a visitor opens `/akun` without a sign-in attempt or recovery marker
- **THEN** the ordinary "Belum masuk" card and its "Masuk" action appear,
  without a recovery warning

#### Scenario: Existing session during a duplicate callback

- **WHEN** a callback is repeated or an old browser tab returns while a valid
  session already exists
- **THEN** the valid session is preserved and the user reaches the normal
  destination without a recovery card or another login loop

### Requirement: Preserve a safe return destination

The retry action SHALL return to the original safe in-site destination when
it is known and otherwise return to `/akun`. A signed-in request SHALL show
the normal destination even if a stale recovery marker is present.

#### Scenario: Retry from a known destination

- **WHEN** a voter starts at `/pilih-suara`, a callback with a valid auth
  transaction fails token verification, and they choose "Coba masuk lagi"
- **THEN** the new transaction retains `/pilih-suara` as its destination
  without accepting an external or untrusted redirect URL

#### Scenario: Stale marker with a valid session

- **WHEN** a signed-in voter opens a URL containing an old recovery marker
- **THEN** they see the ordinary signed-in page, not a recovery card

### Requirement: Keep browser recovery usable and private

Browser navigations to login and callback SHALL show a human-readable recovery
state for an expected OIDC failure, never raw JSON. The recovery card SHALL
have an accessible heading, `role="alert"`, and a stable, non-sensitive help
code. It SHALL remain readable and operable on phone, tablet, and desktop.

#### Scenario: Failure repeats

- **WHEN** a voter has retried and reaches recovery again
- **THEN** the same single retry action remains available and secondary help
  tells them how to report the displayed help code to the election committee;
  it does not instruct them to erase all browser data as the first step

#### Scenario: Browser callback cannot reach One Login

- **WHEN** discovery, token exchange, or key retrieval fails during a browser
  navigation
- **THEN** the browser sees a human-readable recovery state with a retry
  action and help code, while a non-browser API request retains a machine-
  readable error response

#### Scenario: Forged or expired success marker

- **WHEN** a visitor supplies a forged or expired success marker
  without a valid session
- **THEN** it does not authenticate the visitor or classify the request as a
  confirmed post-callback session failure

### Requirement: Keep recovery diagnostics private

Recovery responses and redirects SHALL be non-cacheable. User-facing recovery
URLs and diagnostic events SHALL contain no OIDC state, authorization code,
token, cookie value, member ID, name, or other personal data. Diagnostic
events SHALL contain only a bounded outcome category.

#### Scenario: Callback verification fails

- **WHEN** a browser callback fails token verification
- **THEN** the help code and diagnostic event identify only the bounded
  failure category, without the token, account details, or exception text
