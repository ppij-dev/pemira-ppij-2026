# Spec Delta: Dasbor and results count invite voters

## Purpose

Dasbor, the results payload and the per-korda table use the effective Hak pilih — frozen
roll plus active links — so invitees are visible in participation and unused links are
visible as non-voters.

## ADDED Requirements

### Requirement: Dasbor statistics include invitation links

The Dasbor statistics SHALL use the effective Hak pilih (frozen roll plus non-cancelled
links) as the denominator, SHALL count invite participation rows in "Sudah digunakan",
SHALL show unused links as part of "Belum digunakan", and SHALL show the number of active
links as its own count so panitia can reconcile them at a glance. Testing mode SHALL keep
labelling and excluding test rows as today.

#### Scenario: Unused links appear as not yet voted

- **WHEN** the election has 100 frozen roll voters, 5 active links and 98 participation
  rows of which 2 are invitees
- **THEN** the denominator is 105, "Sudah digunakan" counts the invitees, and the unused
  links show as not yet used

#### Scenario: Cancelled link no longer counted

- **WHEN** an unused link is cancelled
- **THEN** the denominator and the active-link count drop by one on the next manual refresh

#### Scenario: Refresh is manual

- **WHEN** the Dasbor page is open while links are generated or votes arrive
- **THEN** nothing polls or streams and the numbers change only when the panitia refreshes

### Requirement: Per-korda rows count used links in the chosen komsat

The per-korda table SHALL count a used link in the komsat the guest chose, SHALL not
attribute an unused link to any korda, and SHALL state that unused links are counted
nationally only, so the korda rows can sum to less than Hak pilih. The 10-ballot
suppression rule SHALL be unchanged.

#### Scenario: Invitee counted in the chosen korda

- **WHEN** a guest chooses komsat K and votes
- **THEN** komsat K's korda row counts that participation and that ballot

#### Scenario: Unused link in no korda

- **WHEN** 3 links are unused
- **THEN** no korda row counts them, the national Hak pilih does, and the page explains
  the difference

#### Scenario: Small korda still suppressed

- **WHEN** a korda's ballot count including invite ballots is below 10
- **THEN** its candidate breakdown stays suppressed as today

### Requirement: Count check uses the effective Hak pilih

The count check SHALL compare participation and ballots against the effective Hak pilih
including active links, SHALL classify unused links as legitimate non-voters rather than
an inconsistency, and SHALL keep reporting rows edited outside the app.

#### Scenario: Unused link is not an inconsistency

- **WHEN** the count check runs with unused links present
- **THEN** the unused links are accounted for in the denominator and reported as not yet
  used, not as a mismatch

### Requirement: Hitung Abstain includes unused links

The Hitung Abstain pending count SHALL be the effective Hak pilih minus participation, so
every unused link becomes an Abstain when the action runs, and the stored count SHALL stay
valid because links cannot be generated or cancelled after voting closes.

#### Scenario: Unused links counted as Abstain

- **WHEN** voting has closed with 3 unused links and Admin Voting runs Hitung Abstain
- **THEN** the stored count includes those 3 non-voters and the results show them as
  Abstain

#### Scenario: Stored count cannot be invalidated after the fact

- **WHEN** Hitung Abstain has run
- **THEN** no link can be generated or cancelled afterwards, so the stored count still
  matches the effective Hak pilih
