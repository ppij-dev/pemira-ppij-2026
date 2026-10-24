# Spec Delta

## Purpose
Records election actions in a tamper-evident chain and lets Admin Voting verify its
integrity while publishing a stable closing snapshot.

## ADDED Requirements

### Requirement: Recorded actions
The audit log SHALL record Admin Voting mutations, syncs and tally views; voter sign-in,
eligibility refusals, votes and receipt checks; and system stage transitions and Uji Coba
deletion. Entries SHALL include time, actor and action, but never a choice, raw receipt
code, secret, phone, IP address or device.

#### Scenario: Vote entry
- **WHEN** Budi votes
- **THEN** an entry records that Budi voted without candidate or receipt code

### Requirement: Append-only hash chain
Each entry SHALL store a hash of the previous entry and its own canonical content.
Entries SHALL only be appended through the application. Verification SHALL detect an
edited or deleted D1 row and identify the first broken sequence.

#### Scenario: Row deleted in D1
- **WHEN** someone deletes an audit row directly in D1
- **THEN** the integrity check reports the first broken sequence

### Requirement: Admin integrity view
Admin Voting SHALL have a read-only chronological Audit page showing entries and the
chain-integrity result. The 1.0 page need not offer advanced filters or CSV export.

#### Scenario: Intact log
- **WHEN** an Admin Voting opens Audit with no tampering
- **THEN** the page shows "Rantai log utuh" and the check time in JST

### Requirement: Stable closing audit snapshot
At early close or the first request after scheduled close, the system SHALL append an
idempotent closing event and persist its chain hash as the election's closing snapshot
before serving post-close data. Concurrent first requests SHALL expose the same hash.
Later audit entries SHALL continue the chain without changing this snapshot. The
public receipt board SHALL display the persisted closing hash, not the current tip.

#### Scenario: Scheduled close followed by later audit
- **WHEN** the first post-close request fixes a closing hash and an Admin Voting later views a tally
- **THEN** the board keeps the same closing hash while the Audit page shows a newer chain tip
