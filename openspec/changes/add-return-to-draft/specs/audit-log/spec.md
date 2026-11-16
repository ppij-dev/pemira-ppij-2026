# Spec Delta: Audit entries for Kembali ke Draf

## Purpose

Each accepted "Kembali ke Draf" appends one hash-chained audit entry naming the actor,
the stage it left and the kept counts; refused attempts record nothing.

## ADDED Requirements

### Requirement: Audit entry for Kembali ke Draf

Each accepted "Kembali ke Draf" SHALL append exactly one audit entry through the normal
hash-chained path, as an Admin Voting action recording the actor, the stage it left
(Terjadwal, Dibuka or Ditutup), whether Mode Pratinjau was on, and the kept ballot and
participation counts. A refused attempt SHALL record nothing and SHALL leave the audit
chain tip unchanged.

#### Scenario: Accepted return recorded

- **WHEN** an Admin Voting returns a preview Dibuka election to Draf with kept votes
- **THEN** one audit entry records the action "Pemilihan dikembalikan ke Draf", the
  actor, stage Dibuka, the preview flag and the kept ballot and participation counts,
  chained onto the current tip hash

#### Scenario: Return without ballots records zero counts

- **WHEN** an Admin Voting returns a locked election with zero kept ballots to Draf
- **THEN** the audit entry records kept ballot and participation counts of zero

#### Scenario: Refused attempt records nothing

- **WHEN** a return-to-draft attempt is refused (wrong phrase, wrong stage or non-admin
  session)
- **THEN** no audit entry is appended and the chain tip stays unchanged
