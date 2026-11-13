# Spec Delta: Second candidate refused while single candidate mode is on

## Purpose

Keeps the candidate list compatible with the mode: while it is on, Draf cannot register a
second candidate, and a list that already holds several candidates is reduced by the
existing delete path until exactly one remains.

## ADDED Requirements

### Requirement: Second candidate refused while the mode is on

While single candidate mode is on, candidate management SHALL refuse to add a second candidate in Draf with a message that names the mode. Removing candidates SHALL stay possible, so an existing multi-candidate list can be reduced to exactly one. With the mode off, all existing candidate rules SHALL apply unchanged.

#### Scenario: Add a second candidate

- **WHEN** an Admin Voting adds a candidate while the mode is on and one candidate exists
- **THEN** the request is refused with a message naming single candidate mode and the list keeps one candidate

#### Scenario: Reduce an existing list to one

- **WHEN** the mode is turned on while three candidates exist and Admin Voting deletes two of them
- **THEN** the deletions succeed and the list reaches exactly one candidate

#### Scenario: Mode off behaves as before

- **WHEN** an Admin Voting adds a second candidate while the mode is off
- **THEN** the candidate is created under the existing rules with no mode-related refusal
