# Spec Delta: A sealed tally load is still a tally view

## Purpose

Hard rule 7 records every tally view. Sealing the figures (owner decision 2026-11-21) does
not create a new action and does not turn a normal read into a refused action.

## ADDED Requirements

### Requirement: Sealed tally loads keep the existing audit entry

Every Dasbor load SHALL keep appending one `admin_tally_viewed` entry with the acting
Admin Voting and the stage in its detail, whether the tally is sealed or published. A
sealed load SHALL NOT add a second entry, a "blocked" entry or any entry that carries a
choice count, and no endpoint SHALL add an entry for a reader who asks for sealed counts.

#### Scenario: Sealed load while voting is Dibuka

- **WHEN** an Admin Voting loads Dasbor while voting is Dibuka and the tally is sealed
- **THEN** exactly one `admin_tally_viewed` entry is appended with the actor and `stage: "open"`, and its detail holds no choice count

#### Scenario: Load after Diumumkan

- **WHEN** an Admin Voting loads Dasbor after Diumumkan
- **THEN** exactly one `admin_tally_viewed` entry is appended with `stage: "published"` and the hash chain still verifies
