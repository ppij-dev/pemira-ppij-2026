# Spec Delta: Invite votes follow the Pemilih rules

## Purpose

An invite vote is written through the same secret-ballot mechanics as a Pemilih's vote:
one atomic batch, participation separated from the ballot, one-time receipt code and no
logging of anything sensitive.

## ADDED Requirements

### Requirement: Invite participation uses a reserved identity

An invite vote SHALL write one `participation` row with the reserved `member_id`
`undangan:<reference>`, `member_name` = the guest Nama from the invitation row, and
`is_test = 0`, in the same batch as its ballot. The existing
`PRIMARY KEY(election_id, member_id)` SHALL therefore also enforce one vote per link, and
the `undangan:` prefix SHALL never collide with a Portal member id.

#### Scenario: Participation row for an invitee

- **WHEN** an invitee votes
- **THEN** one participation row exists with member_id `undangan:<reference>`, the guest
  Nama as member_name and is_test 0, and the invitation row is marked Sudah Dipakai

#### Scenario: No voters row created

- **WHEN** an invitee votes
- **THEN** no `voters` row is created and no Pemilih roll query returns them

### Requirement: Invite ballots keep ballot secrecy

An invite ballot SHALL be written exactly like a Pemilih ballot: random id, candidate,
chosen komsat path, receipt hash, optional choice, no member reference, no timestamp,
`WITHOUT ROWID`, in one batch with nothing linking it to the participation row or the
invitation row. Reading results SHALL only ever aggregate ballots.

#### Scenario: No link from invitee to ballot

- **WHEN** an invite vote is stored
- **THEN** no column, ordering or timestamp connects the ballot to the invitation row or
  the participation row

#### Scenario: Results read ballots in aggregate only

- **WHEN** the tally, the per-korda table or the choice counts are computed
- **THEN** the invite ballot is read only as part of aggregate counts and no query joins a
  ballot to the invitation row

### Requirement: Invite receipts use the existing code and board

An invite vote SHALL use the same one-time Crockford Base32 receipt code and the same
SHA-256-at-rest rule as a Pemilih vote, and the code SHALL verify through the existing
receipt page and post-close hash board without any invite-specific flow.

#### Scenario: Receipt shown once

- **WHEN** an invitee submits a ballot
- **THEN** the one-time receipt code is shown, only its SHA-256 is stored, and the code is
  never sent to the server again for storage

#### Scenario: Board after close includes the invite receipt hash

- **WHEN** voting closes and the board lists receipt hashes
- **THEN** the invitee's receipt hash is listed like any other and can be verified by
  hashing the code in the browser

### Requirement: Nothing sensitive is logged for invite votes

Logs and audit entries SHALL never contain a link code, the guest Email, the candidate
choice or the receipt code; the invite vote entry SHALL name the row by its reference and
the chosen komsat path only.

#### Scenario: Invite vote audit entry

- **WHEN** an invite vote is accepted
- **THEN** the audit entry records the action, the admin-facing actor identity
  `undangan:<reference>`, the guest name and the chosen komsat path, and no code, email,
  candidate or choice

#### Scenario: Refused invite vote records nothing

- **WHEN** an invite vote is refused (used link, closed stage, wrong confirmation or rate
  limit)
- **THEN** no participation row, ballot or audit entry is written
