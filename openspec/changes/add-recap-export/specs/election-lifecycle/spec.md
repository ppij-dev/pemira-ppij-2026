# Spec Delta: Rekapitulasi Suara replaces Hitung Abstain

## Purpose

Owner decisions Q232–Q234 (2026-11-22): after voting closes the committee runs one
one-time **Rekapitulasi Suara** action instead of Hitung Abstain. It stores the
non-voter count as Abstain exactly as Hitung Abstain did, marks the recap done, lifts
the admin seal, and gates Umumkan Hasil. This supersedes the Hitung Abstain
requirements of `add-single-candidate-mode` and the "sealed from Admin Voting until
Diumumkan" scope of `seal-tally-until-published`.

## ADDED Requirements

### Requirement: Rekapitulasi Suara is a one-time guarded action after close

Rekapitulasi Suara SHALL be allowed only while the election is Ditutup (by clock or Tutup
Sekarang) and only in single candidate mode, and SHALL run at most once per lock. In one
guarded D1 batch it SHALL store the non-voter count as the Abstain figure (following the
new rule: unused links are NOT Abstain, see the cancellation requirement), stamp the
recap time, and append one hash-chained audit entry. A refused run SHALL change nothing
and append nothing.

#### Scenario: Recap after close

- **WHEN** voting is Ditutup in single candidate mode and an Admin Voting runs Rekapitulasi Suara
- **THEN** the stored Abstain figure equals Hak pilih minus participation, the recap time is set, and one audit entry records the actor with only the count in its detail

#### Scenario: Refused before close, outside the mode, or twice

- **WHEN** an Admin Voting runs the recap while voting is not closed, while single candidate mode is off, or a second time
- **THEN** the request is refused with a clear reason, the recap columns stay NULL, and no audit entry is appended

#### Scenario: Concurrent runs

- **WHEN** two Admin Voting run the recap at the same moment
- **THEN** exactly one succeeds, the stored count and time come from that run, and the other is refused

### Requirement: The recap cancels unused invite links

In the same guarded batch, every invite link that is still unused (not used, not
cancelled) SHALL be cancelled with `cancelled_at` equal to the recap time. After the
recap DPT final is the roll plus USED links only, and Abstain counts only roll members
who did not vote. Before the recap, unused links SHALL still add +1 to the live Hak
pilih as today; only the recap cancels them.

#### Scenario: Unused links are cancelled by the recap

- **WHEN** an Admin Voting runs the recap while two unused, one used and one manually cancelled link exist
- **THEN** exactly the two unused links become Dibatalkan with the recap time, the used and manually cancelled links are untouched, and DPT final afterwards is the roll plus the used link count

#### Scenario: Confirmation dialog states the cancellation

- **WHEN** an Admin Voting opens the recap confirmation dialog before the recap
- **THEN** the dialog states the count of unused links that will be cancelled, and the stated Abstain count excludes those links

#### Scenario: One summary audit entry

- **WHEN** the recap cancels several unused links
- **THEN** the recap audit entry's detail carries the cancelled-link count next to the Abstain count, with no references and no per-link entries, and the hash chain still verifies

### Requirement: The recap state exposes what will change

The recap state SHALL expose the unused-link count for the confirmation dialog, and the
stated Abstain count SHALL exclude the links that will be cancelled.

#### Scenario: State carries both counts

- **WHEN** an Admin Voting reads the recap state before the recap
- **THEN** it carries the non-voter count that will be stored as Abstain (excluding the unused links) and the count of unused links that will be cancelled

#### Scenario: Live roll Hak pilih is adjusted

- **WHEN** a live-roll election is recapped and any page reads Hak pilih afterwards
- **THEN** the stored closing figure no longer includes the cancelled links, so DPT final equals the roll plus used links

### Requirement: Umumkan Hasil requires the recap in single candidate mode

In single candidate mode, Umumkan Hasil SHALL be refused until `recap_at` is set, with a
message that names Rekapitulasi Suara. Outside single candidate mode the gate SHALL NOT
apply. The refusal message replaces the previous "Hitung Abstain first" message.

#### Scenario: Publish refused before the recap

- **WHEN** voting is Ditutup in single candidate mode and the recap has not run
- **THEN** Umumkan Hasil is refused with a message naming Rekapitulasi Suara and nothing is published

#### Scenario: Publish allowed after the recap

- **WHEN** the recap has run and an Admin Voting announces the result
- **THEN** the election becomes Diumumkan

#### Scenario: Multi-candidate keeps the direct path

- **WHEN** voting is Ditutup in a multi-candidate election and an Admin Voting announces the result
- **THEN** the announcement succeeds without a recap, as today

### Requirement: Kembali ke Draf resets the recap columns

Kembali ke Draf SHALL clear `recap_at` and the stored Abstain count (and the legacy
`abstain_counted_*` columns), so the next lock and close can recap from zero.

#### Scenario: Return to draft clears the recap

- **WHEN** an election that has run the recap returns to Draf
- **THEN** the recap columns are NULL again and the recap can run once after the next close

### Requirement: The admin seal lifts at the recap; the public seal does not

Once `recap_at` is set, the sealed choice counts SHALL be served to Admin Voting on
Dasbor and `/api/dashboard` even while the stage is Ditutup. The public results SHALL
NOT change: `/api/results` SHALL still answer 409 before Diumumkan, and `/hasil` and the
landing page SHALL show counts only after Diumumkan. A multi-candidate election, which
never recaps, SHALL stay sealed until Diumumkan exactly as before.

#### Scenario: Dashboard shows counts after recap

- **WHEN** the recap has run, the result is not yet announced, and an Admin Voting opens Dasbor
- **THEN** Setuju, Tidak Setuju and Abstain and the per-korda rows carry their figures and `tally_sealed` is false

#### Scenario: Public stays sealed until Diumumkan

- **WHEN** the recap has run but the result is not announced, and anyone requests `/api/results`, `/hasil` or the landing page
- **THEN** the request answers 409 or renders without any choice count

### Requirement: The Hitung Abstain surface is removed

The Hitung Abstain button, its dialog, and the `GET`/`POST /api/election/abstain-count`
endpoints SHALL be removed. The recap state endpoint SHALL expose the same pending
non-voter count so the recap confirmation dialog can state the number it will store.
The confirmation SHALL be one-way: it states the count that will become Abstain and
that the action cannot be undone.

#### Scenario: No Hitung Abstain anywhere

- **WHEN** an Admin Voting opens Pengaturan, Dasbor or the Rekapitulasi page after this change
- **THEN** no Hitung Abstain button or dialog exists, and the recap dialog states the non-voter count and its one-way nature

### Requirement: The recap payload carries the five committee blocks

When the recap is done, `GET /api/admin/recap` SHALL return, as JSON only, the data the
page and the Excel need, in five blocks matching the tabs.

#### Scenario: Ringkasan block

- **WHEN** the recap payload is read
- **THEN** the Ringkasan block carries the election title, the schedule, the export time, Total DPT with its source named (frozen at Kunci, frozen mid-vote, or the closing snapshot), invite links created / used / cancelled (the cancellations include those made by the recap) with a note that unused links are cancelled at Rekapitulasi, DPT final (roll plus used links), total votes used, and Setuju, Tidak Setuju, Abstain with percentages of DPT final

#### Scenario: Korda and Komsat blocks

- **WHEN** the recap payload is read
- **THEN** the Korda block lists every korda including those with zero with Hak pilih, Suara digunakan and Partisipasi % only, and the Komsat block lists every komsat with the same columns plus its korda name, and neither carries a per-region choice count

#### Scenario: Kotak suara block

- **WHEN** the recap payload is read
- **THEN** the Kotak suara block holds one row per ballot with only the receipt hash and the choice (Setuju or Tidak Setuju) in a random order, with no komsat, time or member column

#### Scenario: Abstain block is anonymised per komsat

- **WHEN** the recap payload is read
- **THEN** the Abstain block holds one row per komsat — Korda, Komsat, the count of members who did not vote, and the share of that komsat's Hak pilih — lists every komsat including those with 0, and the server returns no per-member non-voter data: no name and no member number anywhere in the payload

### Requirement: No recap data before the recap and outside the admin guard

Before the recap the endpoint SHALL return only the state and no tab data, and the
public endpoints SHALL NOT expose any of these blocks.

#### Scenario: Counts add up

- **WHEN** any recap payload is inspected
- **THEN** Setuju + Tidak Setuju + Abstain equals DPT final (the roll plus used links), the ballot count equals the participation count and Total suara digunakan, and the sum of the per-komsat Abstain counts equals the Abstain figure

#### Scenario: Remainder rows keep the regional totals honest

- **WHEN** ballots or roll members carry paths outside any known unit
- **THEN** the Korda and Komsat sheets show the remainder as their own rows, so the per-sheet sums equal DPT final and Total suara digunakan, with no unused-link rows because the recap has cancelled them

#### Scenario: Ballot privacy holds in the sheet

- **WHEN** the Kotak suara block is inspected
- **THEN** each row carries only a receipt hash and a choice label, with no member, komsat or timestamp column

### Requirement: Demo seed script

A repeatable script SHALL seed a local (or preview) D1 database with a closed,
not-yet-recapped single-candidate election of about 400 members across several korda
and komsat (one korda empty), about 60% turnout with a Setuju/Tidak Setuju mix, and 10
invite links (6 used, 2 unused, 2 cancelled). It SHALL print the expected numbers from
the same arithmetic the tests verify, and SHALL refuse to run against the production
database name `pemira-ppij-2026`.

#### Scenario: Seeding a demo database

- **WHEN** the script runs against a local demo database and again afterwards
- **THEN** it produces the same deterministic data both times, prints the expected recap numbers, and never touches the production database name
