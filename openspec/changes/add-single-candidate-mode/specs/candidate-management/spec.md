# Spec Delta: Single candidate mode candidate rules

## Purpose

Keeps the candidate list compatible with the mode: while it is on, Draf cannot register a
second candidate, the candidate carries no nomor urut anywhere (number-free form, stored
internal nomor, nickname-only profile URL and cards), and a list that already holds
several candidates is reduced by the existing delete path until exactly one remains.

## ADDED Requirements

### Requirement: Second candidate refused while the mode is on

While single candidate mode is on, candidate management SHALL refuse to add a second candidate in Draf with a message that names the mode. Removing candidates SHALL stay possible, so an existing multi-candidate list can be reduced to exactly one. With the mode off, all existing candidate rules SHALL apply unchanged.

#### Scenario: Add a second candidate

- **WHEN** an Admin Voting adds a candidate while the mode is on and one candidate exists
- **THEN** the request is refused with a message naming single candidate mode and the list keeps one candidate

#### Scenario: Reduce an existing list to one

- **WHEN** three candidates exist with the mode off, Admin Voting deletes two of them, and then switches the mode on
- **THEN** the deletions succeed and the switch turns on with exactly one candidate

#### Scenario: Mode off behaves as before

- **WHEN** an Admin Voting adds a second candidate while the mode is off
- **THEN** the candidate is created under the existing rules with no mode-related refusal

### Requirement: Candidate form and stored nomor in single candidate mode

While single candidate mode is on, the Admin Voting candidate form SHALL NOT ask for a nomor urut, and the server SHALL store the candidate with a fixed internal nomor that satisfies the schema (`candidates.number` stays NOT NULL UNIQUE CHECK > 0) without ever rendering it. Candidates already registered keep their stored nomor. With the mode off, the form and numbering rules are unchanged.

#### Scenario: Form without nomor urut

- **WHEN** an Admin Voting opens the candidate form while the mode is on
- **THEN** it shows name, nickname, komsat and description but no nomor urut field, and saving stores the candidate with the fixed internal nomor

#### Scenario: Stored nomor never rendered

- **WHEN** the candidate appears on any page or tally while the mode is on
- **THEN** the stored nomor is visible nowhere

#### Scenario: Mode off unchanged

- **WHEN** an Admin Voting opens the candidate form while the mode is off
- **THEN** the form asks for a unique positive nomor urut as today

### Requirement: Number-free single candidate profile

While single candidate mode is on, the single candidate's profile page SHALL live at `/kandidat/<nickname>` and SHALL show no nomor urut; every link to it SHALL use that number-free form and no numbered candidate URL SHALL be generated. With the mode off, the numbered form `/kandidat/<nomor>-<nickname>` SHALL be used as today.

#### Scenario: Profile URL without a number

- **WHEN** a visitor opens `/kandidat/<nickname>` while single candidate mode is on
- **THEN** the profile shows name, nickname, komsat, description, color and placeholder image with no nomor urut

#### Scenario: Numbered URL not generated in single candidate mode

- **WHEN** the site renders a link to the candidate's profile while single candidate mode is on
- **THEN** the link targets `/kandidat/<nickname>` and no numbered candidate URL is exposed

#### Scenario: Multi-candidate profile unchanged

- **WHEN** a visitor opens a candidate page while the mode is off
- **THEN** the numbered form `/kandidat/<nomor>-<nickname>` resolves as today with the number shown
