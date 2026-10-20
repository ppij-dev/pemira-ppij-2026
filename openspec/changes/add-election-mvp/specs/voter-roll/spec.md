# Spec Delta

## Purpose
Maintains the fixed Pemilih roll synced from membership data and lets Admin Voting
inspect turnout without exposing choices or contact information.

## ADDED Requirements

### Requirement: Manual Draf sync
Admin Voting SHALL be able to sync in-scope ACTIVE members and units from the Service API
in Draf, including `member_id`, name, nickname, komsat path, status and update time.
The client SHALL handle cursor pages and `changed_since`, including members who lost
ACTIVE status. The UI SHALL show the last sync time in JST and an audit summary.

#### Scenario: New and inactive members
- **WHEN** a sync finds three newly ACTIVE members and one member who became inactive
- **THEN** the Draf roll reflects both changes and the audit entry records the counts

#### Scenario: Missing grant
- **WHEN** the Service API responds `no_grant`
- **THEN** the UI explains the missing Portal grant, does not claim a successful sync and sign-in still works

### Requirement: Final sync and frozen roll
Kunci & Jadwalkan SHALL perform one final successful Service API sync and freeze the
ACTIVE in-scope roll. A failed page, unreachable service or `no_grant` SHALL block
locking without changing the frozen electorate. No sync SHALL run after lock.

#### Scenario: Successful final sync
- **WHEN** Kunci completes its final sync
- **THEN** the frozen member count and time are recorded and members ACTIVE later are not added

#### Scenario: Final sync fails
- **WHEN** the final Service API page fails
- **THEN** Kunci fails and the election remains in Draf

### Requirement: Eligibility uses both roll and fresh sign-in
The frozen roll alone SHALL NOT grant a vote; vote submission SHALL also satisfy the
fresh, in-scope ACTIVE One Login rule.

#### Scenario: Member joins after lock
- **WHEN** Dewi becomes ACTIVE after Kunci and signs in
- **THEN** she cannot vote and sees an explanation that the roll was frozen

### Requirement: Pemilih page
Admin Voting SHALL see a searchable member list with komsat and sudah/belum memilih
filters and JST participation times. It SHALL not show anyone's choice, phone or email.

#### Scenario: Who has not voted
- **WHEN** an Admin Voting filters PPI Okayama and "Belum memilih"
- **THEN** only its frozen-roll members without a participation row are listed

### Requirement: Data retention
The frozen roll SHALL remain while the site exists. The 1.0 site SHALL not request
contact data or offer WhatsApp/email reminders.

#### Scenario: After results
- **WHEN** results were published 60 days ago
- **THEN** Admin Voting can still view the roll, with no phone numbers or email addresses in D1
