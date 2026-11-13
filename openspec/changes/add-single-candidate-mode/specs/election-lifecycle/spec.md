# Spec Delta: Single candidate mode in Pengaturan, readiness and locking

## Purpose

Lets Admin Voting run a one-candidate election: a Draf-only switch in Pengaturan, a
readiness rule of exactly one candidate while the switch is on, and the frozen mode value
recorded by the Kunci & Jadwalkan audit entry.

## ADDED Requirements

### Requirement: Single candidate mode switch in Pengaturan

While Draf, Pengaturan SHALL let Admin Voting turn single candidate mode on or off, and each toggle SHALL be recorded in the audit log. Turning the mode on SHALL be refused while two or more candidates are registered, with a message naming the candidate count. In later stages the switch SHALL be shown read-only and SHALL refuse changes. The mode SHALL be off for a new election.

#### Scenario: Turn on in Draf

- **WHEN** an Admin Voting switches single candidate mode on in Pengaturan while Draf with 0 or 1 candidate registered
- **THEN** the value is saved, the switch shows on, and an audit entry records the Admin Voting action

#### Scenario: Switch refused with two candidates

- **WHEN** an Admin Voting tries to switch the mode on while two or more candidates are registered
- **THEN** the request is refused with a message naming the candidate count and the mode stays off

#### Scenario: Turn off again in Draf

- **WHEN** an Admin Voting switches the mode off again while Draf
- **THEN** the value is saved and a further audit entry records the action

#### Scenario: Frozen after Kunci

- **WHEN** an Admin Voting tries to toggle the mode after Kunci & Jadwalkan
- **THEN** the request is refused, the switch stays read-only and the frozen value is unchanged

### Requirement: Single candidate readiness at Kunci & Jadwalkan

While single candidate mode is on, the candidate-count readiness check SHALL require exactly one registered candidate. While the mode is off, the candidate-count check SHALL stay 2–10 candidates as today. All other checks — opening time in the future, valid schedule, unique case-insensitive nicknames, synced Pemilih roll, no Admin Voting candidate — SHALL apply unchanged, and the page SHALL list each check with its state.

#### Scenario: No candidate while the mode is on

- **WHEN** "Kunci & Jadwalkan" runs while single candidate mode is on and no candidate is registered
- **THEN** nothing is locked and the candidate check fails with a message that names the one-candidate rule

#### Scenario: Two candidates while the mode is on

- **WHEN** "Kunci & Jadwalkan" runs while single candidate mode is on and two candidates are registered
- **THEN** nothing is locked and the candidate check fails until exactly one candidate remains

#### Scenario: Exactly one candidate while the mode is on

- **WHEN** "Kunci & Jadwalkan" runs while single candidate mode is on with exactly one candidate registered
- **THEN** the candidate check passes and locking proceeds to the remaining checks

#### Scenario: One candidate while the mode is off

- **WHEN** an Admin Voting presses "Kunci & Jadwalkan" with one candidate and the mode off
- **THEN** nothing is locked and "Minimal 2 kandidat" fails as today

### Requirement: Single candidate mode frozen at Kunci & Jadwalkan

On successful Kunci & Jadwalkan, the single candidate mode value SHALL be frozen and recorded in the lock audit entry's detail, and SHALL no longer be changeable.

#### Scenario: Mode on frozen at lock

- **WHEN** Kunci & Jadwalkan succeeds while single candidate mode is on
- **THEN** the lock audit entry's detail records the frozen mode value and the mode can no longer be changed

#### Scenario: Mode off frozen at lock

- **WHEN** Kunci & Jadwalkan succeeds while single candidate mode is off
- **THEN** the lock audit entry's detail records the frozen off value
