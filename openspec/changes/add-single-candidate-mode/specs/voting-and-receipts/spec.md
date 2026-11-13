# Spec Delta: Single candidate ballot (Setuju / Tidak Setuju / Abstain)

## Purpose

While single candidate mode is on, the ballot asks one question about the single candidate
with three answers, while every secrecy, receipt, confirmation and eligibility rule of the
normal ballot stays unchanged.

## MODIFIED Requirements

### Requirement: One atomic ballot per member

A valid vote SHALL write, in one D1 batch, a participation row (member_id, name, voted_at) unique per member and a ballot row (random ID, candidate, choice, voter's komsat path, receipt hash) with no member reference and no timestamp; ballots SHALL use WITHOUT ROWID. While single candidate mode is on, the ballot SHALL store the single candidate in candidate_id and the chosen choice of setuju, tidak_setuju or abstain; otherwise choice SHALL be NULL.

#### Scenario: First vote in single candidate mode

- **WHEN** an eligible voter submits a confirmed "Setuju" vote while voting is open and the mode is on
- **THEN** both rows are written together, the ballot stores the single candidate with choice "setuju", and the voter receives a receipt code

#### Scenario: Second vote or double tap

- **WHEN** the same member submits again, including two requests at the same moment
- **THEN** the unique constraint rejects the batch, no ballot is added, and the server answers HTTP 409 leading to Bukti Suara

#### Scenario: No link from voter to ballot

- **WHEN** someone with full database access compares participation and ballots
- **THEN** no column, ordering or timestamp in ballots — including choice — connects a ballot to a member

#### Scenario: Multi-candidate elections unchanged

- **WHEN** a vote is cast in a multi-candidate election
- **THEN** the ballot is written exactly as today and its choice column is NULL

## ADDED Requirements

### Requirement: Single candidate ballot with three answers

While single candidate mode is on and voting is open, Pilih Suara SHALL show the single candidate and require choosing exactly one of "Setuju", "Tidak Setuju" or "Abstain" before the confirmation sheet opens. The confirmation sheet SHALL stay the same: typing the candidate's nickname enables "Kirim Suara", and the server SHALL repeat the choice and nickname checks. A request without a valid choice SHALL be refused with HTTP 400.

#### Scenario: Setuju

- **WHEN** an eligible voter picks "Setuju" for the single candidate and confirms by typing the nickname
- **THEN** "Kirim Suara" is enabled and the vote is recorded with choice "setuju"

#### Scenario: Tidak Setuju

- **WHEN** an eligible voter picks "Tidak Setuju" and confirms by typing the nickname
- **THEN** the vote is recorded with choice "tidak_setuju"

#### Scenario: Abstain

- **WHEN** an eligible voter picks "Abstain" and confirms by typing the nickname
- **THEN** the vote is recorded with choice "abstain"

#### Scenario: Missing or invalid choice

- **WHEN** a vote request in single candidate mode carries no choice or a value outside the three answers
- **THEN** the server answers HTTP 400 and records nothing

### Requirement: Receipts and board unchanged in single candidate mode

In single candidate mode the receipt code, its one-time display, the browser-side hashing, the receipt board of hashes and verification SHALL behave exactly as in normal mode. No mode-specific receipt path SHALL exist.

#### Scenario: Receipt verification unchanged

- **WHEN** a voter checks a receipt code from a single-candidate-mode ballot at Bukti Suara or the receipt board
- **THEN** verification succeeds through the same flow as any other code and reveals no choice

### Requirement: Uji Coba with a choice

While single candidate mode is on, a Uji Coba vote in Draf SHALL record one of the three answers picked by the Admin Voting, so the rehearsal shows the single-candidate presentation on Dasbor. Test rows remain test data and are deleted at Kunci.

#### Scenario: Test vote with a choice

- **WHEN** an Admin Voting casts a Uji Coba vote with "Abstain" while the mode is on
- **THEN** the test ballot stores choice "abstain" and Dasbor counts it as test data
