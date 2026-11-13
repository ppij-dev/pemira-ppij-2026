# Spec Delta: Single candidate tally and outcome on Dasbor

## Purpose

While single candidate mode is on, Dasbor presents Setuju, Tidak Setuju and Tidak memilih
counts and their shares of Hak pilih overall and per korda plus one outcome line, with the
existing refresh, suppression and audit rules unchanged. Non-voters count as Tidak Setuju
at close (owner decision 2026-11-13, W7 Q37/Q38).

## ADDED Requirements

### Requirement: Single candidate tally on Dasbor

While single candidate mode is on, Dasbor SHALL show to Admin Voting in every stage the Setuju, Tidak Setuju and Tidak memilih counts with their percentage of Hak pilih — each count's share of the eligible members in scope — plus the outcome line, presented without a nomor urut. Tidak memilih SHALL be derived from the frozen Hak pilih minus participation, never from a per-person lookup. Each tally load SHALL be audit-logged.

#### Scenario: Single candidate tally during voting

- **WHEN** an Admin Voting refreshes Dasbor in single candidate mode with Hak pilih 100, 55 Setuju, 30 Tidak Setuju and 15 Tidak memilih ballots
- **THEN** the three counts with 55%, 30% and 15% of Hak pilih appear and the outcome line reads "Menunggu penutupan pemungutan suara"

#### Scenario: Dasbor without nomor urut

- **WHEN** an Admin Voting views the tally in single candidate mode
- **THEN** the counts and outcome line appear with the candidate's nickname and color but no nomor urut

#### Scenario: Multi-candidate tally unchanged

- **WHEN** an Admin Voting refreshes Dasbor during a multi-candidate election
- **THEN** candidate counts with numbers appear exactly as today and no outcome line is shown

### Requirement: Per-korda single-candidate results

While single candidate mode is on, each korda row above the suppression threshold SHALL show the Setuju, Tidak Setuju and Tidak memilih counts with their shares of that korda's Hak pilih; a korda with fewer than 10 ballots SHALL show turnout and "Data terlalu sedikit" with no count breakdown. The same suppression SHALL apply to public results after publication.

#### Scenario: Larger korda in single candidate mode

- **WHEN** a korda has 12 ballots and 20 eligible members in single candidate mode
- **THEN** its row shows the three counts with percentages of that korda's 20 eligible members

#### Scenario: Small korda suppressed

- **WHEN** a korda has four ballots in single candidate mode
- **THEN** its row shows turnout and "Data terlalu sedikit" with no count breakdown

### Requirement: Outcome line before close

While single candidate mode is on and voting has not closed yet, Dasbor SHALL show one outcome line reading "Menunggu penutupan pemungutan suara" next to the running counts.

#### Scenario: Dasbor while voting is open

- **WHEN** an Admin Voting refreshes Dasbor in single candidate mode while the stage is Draf, terjadwal or Dibuka
- **THEN** the outcome line reads "Menunggu penutupan pemungutan suara" and no winner is named

### Requirement: Outcome line after close

Once voting has closed, Dasbor SHALL show exactly one outcome line computed from the real ballots and the frozen Hak pilih, with non-voters counting as Tidak Setuju. It SHALL read "Terpilih" when Setuju is greater than Tidak Setuju plus Tidak memilih, "Seri, keputusan diserahkan kepada panitia" when both sides are equal, otherwise "Tidak terpilih". The system SHALL record no decision for a tie.

#### Scenario: Terpilih

- **WHEN** voting has closed with Hak pilih 100, 55 Setuju, 30 Tidak Setuju and 15 Tidak memilih
- **THEN** the outcome line reads "Terpilih"

#### Scenario: Tidak Setuju wins

- **WHEN** voting has closed with Hak pilih 100, 40 Setuju, 35 Tidak Setuju and 25 Tidak memilih
- **THEN** the outcome line reads "Tidak terpilih" and Tidak memilih appears as its own count

#### Scenario: Tie

- **WHEN** voting has closed with Hak pilih 100, 50 Setuju, 20 Tidak Setuju and 30 Tidak memilih
- **THEN** the outcome line reads "Seri, keputusan diserahkan kepada panitia" and no decision is recorded anywhere

#### Scenario: No ballots cast

- **WHEN** voting has closed in single candidate mode and no ballots were cast at all
- **THEN** every eligible member counts as Tidak memilih and the outcome line reads "Tidak terpilih"
