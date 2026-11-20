# Spec Delta: Live portal view while voting is open

## Purpose

While "Tidak Membekukan DPT" is on, the roll stored in the `voters` table becomes a live
view of the portal: refreshed on demand from the Service API `changed_since` watermark by
any check or read that needs it, tolerant of portal outages by serving the last known
view, and never audited per automatic refresh. With the switch off, the roll is today's
frozen roll.

## ADDED Requirements

### Requirement: Live portal view refreshed while voting is open

While the switch is on and the stage is Terjadwal or Dibuka, the roll SHALL be refreshed
automatically from the Service API using the stored `changed_since` watermark (the
portal's `as_of`, never the local clock) when it is older than 30 seconds, applying the
same membership rule as a sync (ACTIVE members the portal marks `can_vote: true` in,
everyone else out). Automatic refreshes SHALL write no audit entry, and a refresh that
failed less than 15 seconds ago SHALL NOT be retried immediately.

#### Scenario: New member appears within one refresh cycle

- **WHEN** a member registers on the portal as an eligible ACTIVE member and signs in to vote about half a minute later
- **THEN** a refresh has brought the member onto the live view and the vote is accepted

#### Scenario: Removed member leaves within one refresh cycle

- **WHEN** a member on the live view loses eligibility on the portal and the view refreshes
- **THEN** the member's row is removed or marked ineligible by the same membership rule a sync applies

#### Scenario: Watermark from the portal, not the clock

- **WHEN** an automatic refresh completes
- **THEN** the watermark is the `as_of` returned by the Service API and no audit entry is written

#### Scenario: Cooldown bounds failed refreshes

- **WHEN** the portal times out and further votes arrive within 15 seconds
- **THEN** the failed refresh is not retried on every vote and each vote reads the last known view

### Requirement: Every read that shows Hak pilih shares one refresh

The vote path and every read that shows Hak pilih — the public turnout endpoint, the
landing strip, Dasbor, the Pemilih page and the results — SHALL trigger the same throttled
refresh, so no reader is left on the Kunci snapshot until someone votes. A read SHALL wait
no longer than a short bound (about one second) and otherwise answer from the last known
view, so no page is held up by a slow portal. With the switch off, in Draf, and in Mode
Pratinjau no refresh SHALL run.

#### Scenario: Reads refresh the view without a vote

- **WHEN** the last refresh is older than 30 seconds and anyone loads the landing page, Dasbor, the Pemilih page or the results, or fetches the turnout endpoint, while the stage is Dibuka
- **THEN** exactly one throttled refresh runs and every Hak pilih figure on that read is computed from the refreshed view

#### Scenario: Jumlah Pemilih rises with no vote cast

- **WHEN** an eligible member is added on the portal and the next turnout read or page load happens after the 30-second TTL, with no vote cast in between
- **THEN** Jumlah Pemilih rises by one, Suara Masuk stays the same, and the same member can then vote

#### Scenario: A removed member lowers Jumlah Pemilih

- **WHEN** a member on the live view loses eligibility on the portal and the next such read happens after the TTL
- **THEN** Jumlah Pemilih falls by one without any vote being cast

#### Scenario: A read is never held up by a slow portal

- **WHEN** a refresh is still running after about one second of a page or endpoint read
- **THEN** the read answers from the last known view and the next read after the refresh finishes shows the new figures

### Requirement: Portal unavailable serves the last known view

When the portal cannot be reached during voting in live mode, eligibility SHALL be checked
against the last known view: a member present and eligible in it SHALL still be able to
vote, and a member absent from it or marked ineligible in it SHALL be refused. An outage
SHALL neither revoke a vote already cast nor widen who may vote beyond the last known
view.

#### Scenario: Member on the last view votes during an outage

- **WHEN** the portal is unreachable and an eligible member of the last known view signs in and votes
- **THEN** the vote is accepted as usual and secrecy, receipts and one-vote-per-member are unchanged

#### Scenario: Absent member refused during an outage

- **WHEN** the portal is unreachable and a member who is absent from the last known view tries to vote
- **THEN** the vote is refused with the existing not-on-the-roll message

#### Scenario: Votes already cast stay

- **WHEN** a member who has voted loses eligibility on the portal and the view refreshes
- **THEN** the participation and ballot rows are untouched and the counts still match

### Requirement: Pemilih page shows the live view honestly

While the switch is on, the Pemilih page SHALL show that the roll follows the portal and
SHALL display the time of the last refresh from the portal in JST. Opening the page SHALL
refresh the view by the same rule as every other read (TTL, cooldown,
stale-while-unavailable, short wait), so the rows and the shown time agree.

#### Scenario: Last refresh time visible

- **WHEN** an Admin Voting opens the Pemilih page during a live-mode election
- **THEN** the page shows the roll with its usual filters plus the last refresh time, and no claim that the roll is frozen
