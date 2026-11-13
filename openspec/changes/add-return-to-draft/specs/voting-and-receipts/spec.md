# Spec Delta: Kept votes, receipts and one vote per member across Kembali ke Draf

## Purpose

Pins what "votes already cast are kept" means for the voting flow: participation, ballots
and receipt hashes stay, the member who voted cannot vote again after the next Kunci,
kept receipts stay verifiable, and ballot secrecy is untouched.

## ADDED Requirements

### Requirement: A member who voted cannot vote again after a return and re-Kunci

A member with a kept participation row SHALL be refused a second ballot after the
election returns to Draf and is locked and opened again, exactly as the one-vote-per
member rule refuses it today; the refusal SHALL record nothing beyond today's behavior.

#### Scenario: Member who voted cannot vote again

- **WHEN** a member votes in a preview Dibuka, the election returns to Draf and is
  locked and opened again, and the member tries to vote
- **THEN** the second vote is refused with the usual one-vote-per-member message,
  nothing is recorded for the refused attempt and their original ballot and receipt
  stand

#### Scenario: A fresh member of the new roll can vote

- **WHEN** the election reopens after a return and a member who did not vote earlier is
  on the freshly frozen roll
- **THEN** the member votes normally and receives a normal one-time receipt

### Requirement: Kept ballots, participation and receipts stay

The return SHALL leave kept ballots, participation rows and receipt hashes byte-for-byte
unchanged: nothing SHALL link them to members, no kept ballot SHALL be rewritten,
reinterpreted or deleted, and kept receipt hashes SHALL stay listed by the receipt board
and verifiable after the next close. Ballot secrecy mechanics SHALL be unchanged.

#### Scenario: Kept receipt still verifies after the next close

- **WHEN** a member checks a receipt code from the earlier open on the receipt board
  after the election is closed again
- **THEN** the locally hashed code matches the kept stored hash exactly as before

#### Scenario: Kept ballots unchanged in storage

- **WHEN** the return completes with kept ballots
- **THEN** the ballots keep their random ids, candidate references, komsat paths and
  receipt hashes, carry no member link or timestamp, and no kept row is rewritten or
  deleted
