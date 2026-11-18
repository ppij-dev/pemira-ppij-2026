# Spec Delta: Public turnout stat on the landing page

## Purpose

A two-figure public stat — Jumlah Pemilih and Suara Masuk (labels per owner decision
Q202) — above the schedule panel of
the landing page, shown in every election while voting is open and after close, updating
live by short polling a counts-only endpoint. Counts only, never choices; every existing
rule about what stays hidden before Diumumkan is unchanged.

## ADDED Requirements

### Requirement: Turnout strip above the schedule panel

The landing page SHALL show a compact strip with "Jumlah Pemilih" (Hak pilih) and "Suara
Masuk" (participation) above the schedule panel, in every election regardless of the
switch, while the stage is Dibuka, Ditutup or Diumumkan, and SHALL hide it in Draf and
Terjadwal. The strip SHALL show counts only — no candidate figures, no choices, no korda
breakdown — and SHALL NOT make anything public earlier than today except these two
aggregates.

#### Scenario: Visible while voting is open

- **WHEN** a visitor opens the landing page while voting is open with Hak pilih 120 and 45 votes cast
- **THEN** the strip shows Jumlah Pemilih 120 and Suara Masuk 45 and nothing about candidates or choices

#### Scenario: Frozen-roll election shows the same strip

- **WHEN** a visitor opens the landing page while voting is open in an election with the switch off
- **THEN** the strip shows the frozen Hak pilih and the current participation count

#### Scenario: After close the saved number

- **WHEN** voting has closed in live mode and the snapshot fixed Hak pilih at 118
- **THEN** the strip shows Jumlah Pemilih 118 and the final Suara Masuk, in Ditutup and again in Diumumkan

#### Scenario: Denominator follows the switch state

- **WHEN** the strip is shown in a live-mode election while Dibuka and in a frozen-roll election while Dibuka
- **THEN** the live-mode strip uses the live count and the frozen-roll strip uses the frozen Hak pilih

#### Scenario: Hidden before voting opens

- **WHEN** a visitor opens the landing page in Draf or Terjadwal
- **THEN** no turnout strip is shown

### Requirement: Counts-only public turnout endpoint

A public endpoint SHALL return the strip's figures as JSON — stage, eligible count, vote
count and response time — and nothing else. It SHALL be lightly rate-limited, SHALL work
in both switch states, and SHALL NOT expose candidates, choices, korda rows or any
per-person data.

#### Scenario: Payload shape

- **WHEN** a client fetches the turnout endpoint while voting is open
- **THEN** the response contains the stage, the eligible count, the vote count and the time, and no candidate or choice data

#### Scenario: Rate limited

- **WHEN** one address requests the endpoint far more often than polling needs
- **THEN** further requests are refused with the standard rate-limit response until the window resets

### Requirement: Live updates by short polling

The strip SHALL update without a page reload by polling the turnout endpoint about every
15 seconds while Dibuka and about every 60 seconds after close, pausing while the tab is
hidden, with the number change animated by a flip transition. Dasbor and results SHALL
keep their manual refresh; no other page SHALL poll, and the site SHALL NOT introduce
WebSockets or Durable Objects.

#### Scenario: Number flips without reload

- **WHEN** a new vote arrives while a visitor keeps the landing page open
- **THEN** within one polling interval Suara Masuk changes with a flip animation and the page does not reload

#### Scenario: Polling limited to the stat

- **WHEN** an Admin Voting uses Dasbor or results during the same election
- **THEN** those pages refresh only by button, as today
