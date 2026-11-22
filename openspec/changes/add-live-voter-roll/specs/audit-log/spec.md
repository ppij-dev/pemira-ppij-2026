# Spec Delta: Audit entries for the live voter roll

## Purpose

The audit chain records every Admin Voting decision about the "Tidak Membekukan DPT"
switch, the frozen value at Kunci, the mid-vote freeze driven by the same switch
(owner decision 2026-11-22), and the closing Hak pilih snapshot — while automatic view
refreshes stay silent so they do not flood the hash chain.

## ADDED Requirements

### Requirement: Audit entries for the live voter roll

Each accepted switch toggle SHALL be recorded as an Admin Voting action. The Kunci &
Jadwalkan audit entry SHALL record the frozen switch value and the starting portal view
count. A mid-vote freeze and the closing Hak pilih snapshot SHALL each write exactly one
audit entry from the same guarded batch that performs the write. Automatic portal view
refreshes SHALL write no audit entries; manual syncs keep their existing entries.

#### Scenario: Toggle audited

- **WHEN** an Admin Voting toggles the switch in Draf
- **THEN** one audit entry names the action and the actor

#### Scenario: Lock detail carries the frozen value

- **WHEN** Kunci & Jadwalkan succeeds in live mode
- **THEN** the lock entry's detail records the switch value and the starting view count

#### Scenario: Mid-vote freeze audited once

- **WHEN** an Admin Voting freezes the roll mid-vote by turning the switch off, or the freeze is refused
- **THEN** a successful freeze writes exactly one Admin Voting audit entry naming the frozen count and time, and a refused freeze writes none

#### Scenario: Closing snapshot audited once

- **WHEN** the closing snapshot is finalized, concurrently or not
- **THEN** exactly one system audit entry names the saved number and no other write happens outside the snapshot batch

#### Scenario: Automatic refreshes silent

- **WHEN** the live view refreshes automatically during voting, even many times per minute
- **THEN** no audit entries are written and the audit chain grows only from real actions
