# Spec Delta: Single candidate tally on Dasbor

## Purpose

While single candidate mode is on, Dasbor presents the Setuju, Tidak Setuju and Abstain
counts and their shares of Hak pilih overall and per korda, with the existing refresh,
suppression and audit rules unchanged. The system never states an outcome: no terpilih,
tidak terpilih or seri line exists. Members of the frozen Hak pilih who did not vote by
the deadline count as Abstain (owner decision 2026-11-16, superseding W7 Q37/Q38).

## ADDED Requirements

### Requirement: Single candidate tally on Dasbor

While single candidate mode is on, Dasbor SHALL show to Admin Voting in every stage the Setuju, Tidak Setuju and Abstain counts with their percentage of Hak pilih, each count's share of the eligible members in scope, presented without a nomor urut. Dasbor SHALL NOT show any outcome line. Each tally load SHALL be audit-logged.

#### Scenario: Single candidate tally during voting

- **WHEN** an Admin Voting refreshes Dasbor in single candidate mode with Hak pilih 100, 50 Setuju ballots, 30 Tidak Setuju ballots, 5 Abstain ballots and 15 eligible members who did not vote
- **THEN** Setuju 50 (50%), Tidak Setuju 30 (30%) and Abstain 20 (20%) appear, Abstain is broken down into 5 cast and 15 "tidak memilih (dihitung Abstain)", and no outcome line is shown

#### Scenario: Abstain parts shown

- **WHEN** an Admin Voting reads the Abstain figure in single candidate mode
- **THEN** the Abstain answers cast and "tidak memilih (dihitung Abstain)" appear as separate parts of the total

#### Scenario: No outcome line

- **WHEN** an Admin Voting views the tally in single candidate mode in any stage, before or after voting closes
- **THEN** no "Terpilih", "Tidak terpilih", "Seri" or "Menunggu penutupan" wording appears

#### Scenario: Dasbor without nomor urut

- **WHEN** an Admin Voting views the tally in single candidate mode
- **THEN** the counts appear with the candidate's nickname and color but no nomor urut

#### Scenario: Multi-candidate tally unchanged

- **WHEN** an Admin Voting refreshes Dasbor during a multi-candidate election
- **THEN** candidate counts with numbers appear exactly as today and no Abstain figure is shown

### Requirement: Abstain broken into cast and tidak memilih

The total Abstain on Dasbor SHALL be the sum of two parts that Dasbor also shows separately: the Abstain answers cast, and "tidak memilih (dihitung Abstain)", derived from the frozen Hak pilih minus participation (never below zero), never from a per-person lookup.

#### Scenario: Parts add up

- **WHEN** Hak pilih is 100 with 85 members having voted, 5 of them Abstain
- **THEN** the parts read 5 cast and 15 tidak memilih and the total Abstain is 20

### Requirement: Per-korda single-candidate results

While single candidate mode is on, each korda row above the suppression threshold SHALL show the Setuju, Tidak Setuju and Abstain counts (with Abstain split into cast and "tidak memilih (dihitung Abstain)") and their shares of that korda's Hak pilih; a korda with fewer than 10 ballots SHALL show turnout and "Data terlalu sedikit" with no count breakdown. The same suppression SHALL apply to public results after publication.

#### Scenario: Larger korda in single candidate mode

- **WHEN** a korda has 12 ballots and 20 eligible members in single candidate mode
- **THEN** its row shows the Setuju, Tidak Setuju and Abstain counts with percentages of that korda's 20 eligible members

#### Scenario: Small korda suppressed

- **WHEN** a korda has four ballots in single candidate mode
- **THEN** its row shows turnout and "Data terlalu sedikit" with no count breakdown

### Requirement: No outcome decided by the system

In single candidate mode the system SHALL NOT compute, store or display whether the candidate is elected, not elected or tied, in any stage. The reader draws the conclusion from the counts and their shares of Hak pilih.

#### Scenario: Closed election

- **WHEN** voting has closed in single candidate mode with Hak pilih 100, 55 Setuju, 30 Tidak Setuju and 15 Abstain in total
- **THEN** Dasbor shows the three counts and shares and nothing that names a winner or a tie

#### Scenario: No ballots cast

- **WHEN** voting has closed in single candidate mode and no ballots were cast at all
- **THEN** every eligible member counts as "tidak memilih (dihitung Abstain)", the Abstain total equals Hak pilih and no outcome wording appears
