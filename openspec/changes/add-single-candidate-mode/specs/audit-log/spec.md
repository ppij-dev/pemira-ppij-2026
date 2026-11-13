# Spec Delta: Audit entries for single candidate mode

## Purpose

Records the Draf toggles of single candidate mode and the frozen value at Kunci & Jadwalkan,
without ever recording a choice in a vote entry.

## ADDED Requirements

### Requirement: Single candidate mode audit

Turning single candidate mode on or off SHALL be recorded as an Admin Voting action in the audit log. The Kunci & Jadwalkan entry SHALL record the frozen mode value in its detail. Vote audit entries SHALL keep recording no choice in either mode.

#### Scenario: Toggle recorded

- **WHEN** an Admin Voting switches single candidate mode on in Draf
- **THEN** an audit entry records the action, actor and time, with no member or ballot reference

#### Scenario: Frozen value at lock

- **WHEN** Kunci & Jadwalkan succeeds with single candidate mode on
- **THEN** the lock entry's detail records the frozen single-candidate-mode value

#### Scenario: Vote audit unchanged

- **WHEN** a Pemilih votes "Setuju" in single candidate mode
- **THEN** the audit entry records that the member voted without any choice
