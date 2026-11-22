# Spec Delta: Recap views and downloads are audited

## Purpose

Hard rule 7 records every Admin Voting action, and a tally view is an action. The recap
page exposes the same figures to the same audience, so its loads and downloads get the
same treatment as the existing `admin_tally_viewed` entries.

## ADDED Requirements

### Requirement: Recap data loads and downloads append audit entries

Every load of `/api/admin/recap` that serves recap data SHALL append one hash-chained
`Rekapitulasi dilihat` entry with the acting Admin Voting, and every Excel download
SHOULD be preceded by one `Rekapitulasi diunduh` entry for the same actor. Both entries
SHALL carry no data in their detail: no count, no ballot reference, no choice. A load
that returns only the recap state (before the recap) SHALL NOT append an entry, because
it exposes no tally.

#### Scenario: Opening the recap page after the recap

- **WHEN** an Admin Voting opens the recap page after the recap is done
- **THEN** exactly one `Rekapitulasi dilihat` entry is appended with the actor and an empty detail, and the chain still verifies

#### Scenario: Downloading the Excel

- **WHEN** an Admin Voting presses Unduh Excel
- **THEN** exactly one `Rekapitulasi diunduh` entry is appended with the actor and an empty detail

#### Scenario: State-only load before the recap

- **WHEN** an Admin Voting opens the recap page before the recap is done
- **THEN** no recap entry is appended and no other action is recorded

#### Scenario: Refused loads record nothing

- **WHEN** a non-admin session requests `/api/admin/recap` or the download marker
- **THEN** the request is refused with 403 and no recap entry exists
