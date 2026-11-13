# Spec Delta: Single candidate ballot (Setuju / Tidak Setuju)

## Purpose

While single candidate mode is on, the ballot asks one question about the single candidate
with two answers, while every secrecy, receipt, confirmation and eligibility rule of the
normal ballot stays unchanged. There is no Abstain (owner decision 2026-11-13, W7 Q37).

## ADDED Requirements

### Requirement: Ballot choice storage in single candidate mode

While single candidate mode is on, a valid vote SHALL store the single candidate in candidate_id and the chosen choice of setuju or tidak_setuju on the ballot, written in the same single D1 batch as the participation row, with no member reference and no timestamp; ballots SHALL use WITHOUT ROWID. With the mode off, the choice SHALL be NULL.

#### Scenario: First vote in single candidate mode

- **WHEN** an eligible voter submits a confirmed "Setuju" vote while voting is open and the mode is on
- **THEN** both rows are written together, the ballot stores the single candidate with choice "setuju", and the voter receives a receipt code

#### Scenario: No link from voter to ballot

- **WHEN** someone with full database access compares participation and ballots
- **THEN** no column, ordering or timestamp in ballots — including choice — connects a ballot to a member

#### Scenario: Multi-candidate elections unchanged

- **WHEN** a vote is cast in a multi-candidate election
- **THEN** the ballot is written exactly as today and its choice column is NULL

### Requirement: Single candidate ballot with two answers

While single candidate mode is on and voting is open, Pilih Suara SHALL show the single candidate and require choosing exactly one of "Setuju" or "Tidak Setuju" before the confirmation sheet opens. The confirmation sheet SHALL stay the same: typing the candidate's nickname enables "Kirim Suara", and the server SHALL repeat the choice and nickname checks. A request without a valid choice SHALL be refused with HTTP 400.

#### Scenario: Setuju

- **WHEN** an eligible voter picks "Setuju" for the single candidate and confirms by typing the nickname
- **THEN** "Kirim Suara" is enabled and the vote is recorded with choice "setuju"

#### Scenario: Tidak Setuju

- **WHEN** an eligible voter picks "Tidak Setuju" and confirms by typing the nickname
- **THEN** the vote is recorded with choice "tidak_setuju"

#### Scenario: No Abstain

- **WHEN** a voter looks at the single candidate ballot
- **THEN** only "Setuju" and "Tidak Setuju" are offered and no "Abstain" answer exists

#### Scenario: Missing or invalid choice

- **WHEN** a vote request in single candidate mode carries no choice or a value outside the two answers (including "abstain")
- **THEN** the server answers HTTP 400 and records nothing

### Requirement: Single candidate ballot without nomor urut

While single candidate mode is on, the ballot SHALL present the single candidate without a nomor urut, and the confirmation sheet SHALL state the chosen answer as "Pilihan Anda: Setuju terhadap <nickname>" or "Pilihan Anda: Tidak Setuju terhadap <nickname>", also without a nomor urut. The nickname still SHALL be typed to enable "Kirim Suara".

#### Scenario: Confirmation phrase

- **WHEN** a voter picks "Setuju" for the candidate nicknamed Budi
- **THEN** the confirmation sheet reads "Pilihan Anda: Setuju terhadap Budi" with no nomor urut and still requires typing "Budi"

#### Scenario: Ballot card without nomor urut

- **WHEN** the ballot opens in single candidate mode
- **THEN** the candidate card shows name, nickname, komsat, color and placeholder image with no nomor urut anywhere

### Requirement: Receipts and board unchanged in single candidate mode

In single candidate mode the receipt code, its one-time display, the browser-side hashing, the receipt board of hashes and verification SHALL behave exactly as in normal mode. No mode-specific receipt path SHALL exist.

#### Scenario: Receipt verification unchanged

- **WHEN** a voter checks a receipt code from a single-candidate-mode ballot at Bukti Suara or the receipt board
- **THEN** verification succeeds through the same flow as any other code and reveals no choice

### Requirement: Uji Coba with a choice

While single candidate mode is on, a Uji Coba vote in Draf SHALL record one of the two answers picked by the Admin Voting, so the rehearsal shows the single-candidate presentation on Dasbor. Test rows remain test data and are deleted at Kunci.

#### Scenario: Test vote with a choice

- **WHEN** an Admin Voting casts a Uji Coba vote with "Tidak Setuju" while the mode is on
- **THEN** the test ballot stores choice "tidak_setuju" and Dasbor counts it as test data

#### Scenario: Test vote without a valid choice

- **WHEN** a Uji Coba vote carries no choice or "abstain" while the mode is on
- **THEN** the server answers HTTP 400 and records nothing
