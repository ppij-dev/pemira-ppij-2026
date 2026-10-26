# Spec Delta: Preview mode, receipt v2, instant guard, session-validity eligibility

## MODIFIED Requirements

### Requirement: Vote-time eligibility

A vote SHALL be accepted when the member is ACTIVE inside the site scope and
holds a valid sealed session; a future `auth_time` SHALL be rejected. The
former maximum age of a One Login sign-in (10 minutes) is no longer required.

#### Scenario: Valid day-old session

- **WHEN** a voter with a sealed session signed less than 7 days ago submits a
  vote
- **THEN** the vote is processed without a re-authentication step

#### Scenario: Tampered session clock

- **WHEN** the session payload carries an `auth_time` in the future
- **THEN** the vote is rejected as an invalid session

### Requirement: Receipt codes

Receipt codes SHALL be 80 random bits encoded as 16 Crockford Base32
characters (no I, L, O, U), displayed grouped `XXXX-XXXX-XXXX-XXXX`. Only the
SHA-256 of the normalized code SHALL be stored. Receipt verification SHALL
also accept legacy 26-character codes and map O/I/L aliases.

#### Scenario: New receipt format

- **WHEN** a vote is cast
- **THEN** the returned code matches 16 characters in four groups of four and
  its normalized form hashes to the stored `receipt_hash`

#### Scenario: Legacy code verification

- **WHEN** a 26-character Crockford code from a pre-v2 election is checked
- **THEN** it normalizes and verifies against the stored hash

## ADDED Requirements

### Requirement: Preview mode eligibility

While `elections.preview_mode` is set, an ACTIVE in-scope member who is absent
from the roll SHALL be registered from their session claims (name, nickname,
first in-scope affiliation path) at first eligibility check and SHALL be
treated as an eligible voter. Ballot secrecy, one-vote-per-member and audit
requirements are unchanged.

#### Scenario: Auto-registration

- **WHEN** a signed-in ACTIVE member inside scope requests eligibility in an
  open preview election and is absent from `voters`
- **THEN** a voter row is created from the session claims and eligibility is
  evaluated normally

#### Scenario: Preview disabled

- **WHEN** `preview_mode` is not set and the member is absent from `voters`
- **THEN** eligibility is denied as not on the frozen roll

### Requirement: Preview-mode lock

When locking a preview election, the system SHALL skip the Service API final
sync and SHALL accept an `opens_at` that is not in the future.

#### Scenario: Lock without Service API

- **WHEN** Kunci & Jadwalkan runs on a preview election that has valid
  schedule and candidate readiness but an empty or absent roll
- **THEN** the election locks without contacting the Service API

### Requirement: Schedule-instant vote guard

The atomic vote write guard SHALL compare `opens_at` and `closes_at` as
instants (calendar-independent), so schedules stored with a UTC offset
(e.g. `+09:00`) are honored.

#### Scenario: Offset schedule accepted

- **WHEN** the stored schedule uses `+09:00` offsets and the current instant
  is between open and close
- **THEN** the vote write succeeds
