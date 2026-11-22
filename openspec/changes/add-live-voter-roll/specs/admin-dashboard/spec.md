# Spec Delta: Dasbor figures under the live voter roll

## Purpose

While "Tidak Membekukan DPT" is on, Dasbor's Hak pilih, turnout and per-korda denominators
are live while voting is open and come from the saved closing snapshot afterwards, with a
visible note that the roll follows the portal so nobody mistakes live figures for a frozen
roll. With the switch off, Dasbor is unchanged.

## ADDED Requirements

### Requirement: Dasbor Hak pilih live while open, saved after close

While the switch is on and voting is open, Dasbor's Hak pilih, turnout percentage and
per-korda eligible counts SHALL come from the live portal view, and derived shares SHALL
use the same denominator. Loading Dasbor SHALL refresh the view by the same rule as every
other read (voter-roll delta). After close, Dasbor SHALL use the saved closing Hak pilih
for every share, exactly like results and Hitung Abstain. Dasbor SHALL keep its manual
refresh (no polling) in both modes.

#### Scenario: Live figures while open

- **WHEN** a new member joins the portal while voting is open and an Admin Voting opens or reloads Dasbor after the refresh TTL
- **THEN** Hak pilih, turnout percentage and the per-korda denominators reflect the live count, with no vote cast in between

#### Scenario: Saved figures after close

- **WHEN** voting has closed and the snapshot saved Hak pilih at 118 while the last live read had shown 120
- **THEN** Dasbor shows 118 and the shares computed from 118, matching results and the landing stat

#### Scenario: Dasbor still manual

- **WHEN** votes arrive while an Admin Voting keeps Dasbor open in live mode
- **THEN** the numbers change only when the Admin Voting reloads the page by button or navigation, never on their own

### Requirement: Live-mode note on Dasbor

While the switch is on, Dasbor SHALL show a short note that the roll follows the portal and
is not frozen, and that Hak pilih is fixed when voting closes.

#### Scenario: Note shown in live mode

- **WHEN** an Admin Voting opens Dasbor in a live-mode election
- **THEN** the note is visible above the statistics

#### Scenario: No note when off

- **WHEN** an Admin Voting opens Dasbor in a frozen-roll election
- **THEN** no live-mode note appears and the page is as today

### Requirement: Stale portal view warning while voting is open

While the switch is on and voting is open, Dasbor SHALL show a warning banner once the
portal view has not refreshed successfully for more than 5 minutes, naming the last
refresh time in JST. The banner SHALL stop nothing on its own: voting continues against
the last known view. The banner SHALL disappear after a successful refresh, and SHALL
not appear in frozen-roll elections or outside the open stage.

#### Scenario: Banner after a long outage

- **WHEN** the portal has been unreachable for more than 5 minutes while voting is open in live mode and an Admin Voting opens Dasbor
- **THEN** a warning banner names the last refresh time and the page otherwise works as usual

#### Scenario: Banner clears after refresh

- **WHEN** the view refreshes successfully and an Admin Voting reopens Dasbor
- **THEN** the banner is gone

#### Scenario: No banner in frozen mode or before opening

- **WHEN** an Admin Voting opens Dasbor in a frozen-roll election, or in live mode while Terjadwal
- **THEN** no stale-view banner appears

### Requirement: Frozen-roll notes after a mid-vote freeze

Once the roll has been frozen — at Kunci & Jadwalkan with the switch off, or mid-vote by
turning the switch off (owner decision 2026-11-22) — Dasbor SHALL show a note that the
roll is frozen, naming the freeze time in JST and the frozen Hak pilih, and every Dasbor
figure SHALL come from the frozen number as in any frozen-roll election.

#### Scenario: Dasbor names the freeze after a mid-vote freeze

- **WHEN** the roll was frozen mid-vote and an Admin Voting opens Dasbor while the election is still locked
- **THEN** the live-mode note is replaced by a frozen-roll note naming the freeze time and the frozen Hak pilih, and Hak pilih no longer follows the portal
