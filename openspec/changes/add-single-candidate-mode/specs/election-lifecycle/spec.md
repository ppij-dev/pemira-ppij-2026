# Spec Delta: Single candidate mode in Pengaturan, readiness and locking

## Purpose

Lets Admin Voting run a one-candidate election: a Draf-only switch in Pengaturan, a
readiness rule of exactly one candidate while the switch is on, and the frozen mode value
recorded by the Kunci & Jadwalkan audit entry.

## MODIFIED Requirements

### Requirement: Readiness checks before locking

"Kunci & Jadwalkan" SHALL succeed only when the opening time is in the future, the schedule is valid, nicknames are unique case-insensitively, the Pemilih roll has been synced and no candidate is Admin Voting. The candidate-count check SHALL require 2–10 candidates, except while single candidate mode is on it SHALL require exactly one registered candidate. The page SHALL list each check with its state.

#### Scenario: One candidate while the mode is off

- **WHEN** an Admin Voting presses "Kunci & Jadwalkan" with one candidate and the mode off
- **THEN** nothing is locked and "Minimal 2 kandidat" fails

#### Scenario: No candidate while the mode is on

- **WHEN** "Kunci & Jadwalkan" runs while single candidate mode is on and no candidate is registered
- **THEN** nothing is locked and the candidate check fails with a message that names the one-candidate rule

#### Scenario: Two candidates while the mode is on

- **WHEN** "Kunci & Jadwalkan" runs while single candidate mode is on and two candidates are registered
- **THEN** nothing is locked and the candidate check fails until exactly one candidate remains

#### Scenario: Exactly one candidate while the mode is on

- **WHEN** "Kunci & Jadwalkan" runs while single candidate mode is on with exactly one candidate registered
- **THEN** the candidate check passes and locking proceeds to the remaining checks

### Requirement: Locking freezes the election

Kunci SHALL run the final Service API sync and freeze the roll before locking. If that sync fails, nothing SHALL lock. On success it SHALL delete all Uji Coba votes, assign distinct candidate colors and freeze candidates, title, description, schedule, scope, the Admin Voting participation setting, the single candidate mode value and the Hak pilih snapshot.

#### Scenario: Pemilih roll frozen at lock

- **WHEN** Kunci's final sync succeeds
- **THEN** the roll contains the members ACTIVE in scope then, with later joiners excluded

#### Scenario: Test votes removed

- **WHEN** four test votes exist at Kunci
- **THEN** participation and ballots are emptied and an audit entry records their deletion

#### Scenario: Single candidate mode frozen at lock

- **WHEN** Kunci & Jadwalkan succeeds while single candidate mode is on
- **THEN** the lock audit entry's detail records the frozen mode value and the mode can no longer be changed

## ADDED Requirements

### Requirement: Single candidate mode switch in Pengaturan

While Draf, Pengaturan SHALL let Admin Voting turn single candidate mode on or off, and each toggle SHALL be recorded in the audit log. In later stages the switch SHALL be shown read-only and SHALL refuse changes. The mode SHALL be off for a new election.

#### Scenario: Turn on in Draf

- **WHEN** an Admin Voting switches single candidate mode on in Pengaturan while Draf
- **THEN** the value is saved, the switch shows on, and an audit entry records the Admin Voting action

#### Scenario: Turn off again in Draf

- **WHEN** an Admin Voting switches the mode off again while Draf
- **THEN** the value is saved and a further audit entry records the action

#### Scenario: Frozen after Kunci

- **WHEN** an Admin Voting tries to toggle the mode after Kunci & Jadwalkan
- **THEN** the request is refused, the switch stays read-only and the frozen value is unchanged
