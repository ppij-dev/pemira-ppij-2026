# Spec Delta: Audit entries for direct invitation links

## Purpose

Three new hash-chained audit entries: a batch generated, a link cancelled, and an invite
vote cast. Refused actions record nothing, and no entry ever carries a code, an email or a
choice.

## ADDED Requirements

### Requirement: Audit entry for a generated batch

Each accepted generation of direct invitation links SHALL append exactly one hash-chained
entry recording the actor, the action "Undangan langsung dibuat", the number of links and
their short references. It SHALL never contain a link code, an email or a guest identity.

#### Scenario: Batch recorded once

- **WHEN** an Admin Voting generates 10 links
- **THEN** one audit entry records the actor, the count 10 and the 10 references, chained
  onto the current tip hash

#### Scenario: Refused generation records nothing

- **WHEN** a generation is refused (after close, non-admin session or batch size outside
  the limit)
- **THEN** no audit entry is appended and the chain tip is unchanged

### Requirement: Audit entry for a cancellation

Each accepted cancellation SHALL append exactly one hash-chained entry recording the actor,
the action "Undangan langsung dibatalkan" and the row reference.

#### Scenario: Cancellation recorded

- **WHEN** an Admin Voting cancels an unused link
- **THEN** one audit entry records the actor and the reference, chained onto the current
  tip hash

#### Scenario: Refused cancellation records nothing

- **WHEN** a cancellation is refused (used link, after close or non-admin session)
- **THEN** no audit entry is appended and the chain tip is unchanged

### Requirement: Audit entry for an invite vote

Each accepted invite vote SHALL append exactly one hash-chained entry with an actor type of
voter, the actor identity `undangan:<reference>`, the guest name and the chosen komsat
path, and SHALL never record the candidate, the choice, the code or the email. The entry
SHALL be written in the same batch as the participation row, the ballot and the one-use
mark, so a refused vote leaves nothing behind.

#### Scenario: Invite vote recorded

- **WHEN** an invite vote is accepted
- **THEN** one audit entry records "Pemungutan suara undangan", `undangan:<reference>`,
  the guest name and the chosen komsat path, chained onto the current tip hash

#### Scenario: Concurrent tip change does not lose the entry

- **WHEN** another audit entry is appended between reading the tip and writing the invite
  vote batch
- **THEN** the batch is retried against the fresh tip, and exactly one vote and one entry
  exist

### Requirement: Invitation references are readable in the audit view

The Admin Voting audit view SHALL render an `undangan:<reference>` target as a readable
invitation label instead of a raw identifier.

#### Scenario: Invitation target rendered

- **WHEN** the audit view lists an entry whose target is `undangan:A7K3M9`
- **THEN** the entry shows a readable invitation label and no raw identifier
