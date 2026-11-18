# Spec Delta: Dasbor figures under the live voter roll

## Purpose

While "Tidak Membekukan DPT" is on, Dasbor's Hak pilih, turnout and per-korda denominators
are live while voting is open and come from the saved closing snapshot afterwards, with a
visible note that the roll follows the portal so nobody mistakes live figures for a frozen
roll. With the switch off, Dasbor is unchanged.

## ADDED Requirements

### Requirement: Dasbor Hak pilih live while open, saved after close

While the switch is on and voting is open, Dasbor's Hak pilih, turnout percentage and
per-korda eligible counts SHALL be computed from the live portal view, and any share
derived from them SHALL reflect the live denominator. After voting closes, Dasbor SHALL
use the saved closing Hak pilih for every share, exactly like results and Hitung Abstain.
Dasbor SHALL keep its manual refresh in both modes.

#### Scenario: Live figures while open

- **WHEN** a new member joins the live view while voting is open and an Admin Voting refreshes Dasbor
- **THEN** Hak pilih, turnout percentage and the per-korda denominators reflect the live count

#### Scenario: Saved figures after close

- **WHEN** voting has closed and the snapshot saved Hak pilih at 118 while the last live read had shown 120
- **THEN** Dasbor shows 118 and the shares computed from 118, matching results and the landing stat

#### Scenario: Dasbor still manual

- **WHEN** votes arrive while an Admin Voting keeps Dasbor open in live mode
- **THEN** the numbers change only when the Admin Voting refreshes, as today

### Requirement: Live-mode note on Dasbor

While the switch is on, Dasbor SHALL show a short note that the roll follows the portal and
is not frozen, and that Hak pilih is fixed when voting closes.

#### Scenario: Note shown in live mode

- **WHEN** an Admin Voting opens Dasbor in a live-mode election
- **THEN** the note is visible above the statistics

#### Scenario: No note when off

- **WHEN** an Admin Voting opens Dasbor in a frozen-roll election
- **THEN** no live-mode note appears and the page is as today
