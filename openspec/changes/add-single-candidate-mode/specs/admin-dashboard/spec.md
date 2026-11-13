# Spec Delta: Single candidate tally and outcome on Dasbor

## Purpose

While single candidate mode is on, Dasbor presents Setuju / Tidak Setuju / Abstain counts
and percentages overall and per korda plus one outcome line, with the existing refresh,
suppression and audit rules unchanged.

## ADDED Requirements

### Requirement: Single candidate tally on Dasbor

While single candidate mode is on, Dasbor SHALL show to Admin Voting in every stage the Setuju, Tidak Setuju and Abstain counts with their percentage of votes cast — each answer's share of the Setuju, Tidak Setuju and Abstain ballots in scope — plus the outcome line, presented without a nomor urut. Each tally load SHALL be audit-logged.

#### Scenario: Single candidate tally during voting

- **WHEN** an Admin Voting refreshes Dasbor in single candidate mode with 25 Setuju, 15 Tidak Setuju and 10 Abstain ballots
- **THEN** the three counts with 50%, 30% and 20% of the 50 votes cast appear and the outcome line reads "Terpilih"

#### Scenario: Dasbor without nomor urut

- **WHEN** an Admin Voting views the tally in single candidate mode
- **THEN** the counts and outcome line appear with the candidate's nickname and color but no nomor urut

#### Scenario: Multi-candidate tally unchanged

- **WHEN** an Admin Voting refreshes Dasbor during a multi-candidate election
- **THEN** candidate counts with numbers appear exactly as today and no outcome line is shown

### Requirement: Per-korda single-candidate results

While single candidate mode is on, each korda row above the suppression threshold SHALL show the Setuju, Tidak Setuju and Abstain counts with their shares of that korda's votes cast; a korda with fewer than 10 ballots SHALL show turnout and "Data terlalu sedikit" with no count breakdown. The same suppression SHALL apply to public results after publication.

#### Scenario: Larger korda in single candidate mode

- **WHEN** a korda has 12 ballots in single candidate mode
- **THEN** its row shows the three counts with percentages for that korda

#### Scenario: Small korda suppressed

- **WHEN** a korda has four ballots in single candidate mode
- **THEN** its row shows turnout and "Data terlalu sedikit" with no count breakdown

### Requirement: Outcome line

While single candidate mode is on, Dasbor SHALL show exactly one outcome line computed from votes cast: "Terpilih" when Setuju > Tidak Setuju, "Tidak terpilih" when Tidak Setuju > Setuju, "Belum ada suara" when no ballots were cast, and "Seri, keputusan diserahkan kepada panitia" when the counts are equal with at least one ballot cast. Abstain SHALL be counted and shown on its own but SHALL NOT enter the comparison, and the system SHALL record no decision for a tie.

#### Scenario: Tidak Setuju wins

- **WHEN** 9 Setuju, 14 Tidak Setuju and 2 Abstain ballots are cast
- **THEN** the outcome line reads "Tidak terpilih" and Abstain still appears as its own count

#### Scenario: Tie

- **WHEN** 11 Setuju and 11 Tidak Setuju ballots are cast with any number of Abstain ballots
- **THEN** the outcome line reads "Seri, keputusan diserahkan kepada panitia" and no decision is recorded anywhere

#### Scenario: Abstain-heavy result

- **WHEN** 5 Setuju, 4 Tidak Setuju and 20 Abstain ballots are cast
- **THEN** Abstain is the largest single count, yet the outcome line reads "Terpilih" because only Setuju and Tidak Setuju are compared

#### Scenario: No ballots cast

- **WHEN** voting has closed in single candidate mode and no ballots were cast
- **THEN** the outcome line reads "Belum ada suara" instead of the Seri line and no decision is recorded
