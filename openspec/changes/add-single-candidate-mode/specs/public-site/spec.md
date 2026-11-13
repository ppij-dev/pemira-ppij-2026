# Spec Delta: Published single-candidate results

## Purpose

Once results are published in single candidate mode, the public pages show the same three
counts, percentages and the outcome line with no nomor urut, with the korda suppression
and the publish-before-visible rule unchanged.

## MODIFIED Requirements

### Requirement: Landing page sections

The landing page SHALL show the configured chapter logo and name, election title, structured candidate cards (number, nickname, assigned color, local placeholder image), countdown and a state-aware call to action; while single candidate mode is on, the card SHALL omit the nomor urut and link to `/kandidat/<nickname>`. The layout SHALL be mobile-first with templui patterns and Tabler icons.

#### Scenario: Before voting opens

- **WHEN** a visitor opens the landing page while Terjadwal in a multi-candidate election
- **THEN** they see candidate cards with numbers, countdown and local branding

#### Scenario: Landing card without nomor urut

- **WHEN** a visitor opens the landing page while single candidate mode is on
- **THEN** the candidate card shows nickname, color and placeholder image with no nomor urut and links to `/kandidat/<nickname>`

### Requirement: Results after publication

Once Diumumkan, the landing page and Hasil tab SHALL show the overall tally, the korda-level table with rows under ten ballots suppressed, and turnout statistics. In single candidate mode the tally SHALL present the Setuju, Tidak Setuju and Abstain counts with percentages of votes cast, the outcome line and no nomor urut, and korda rows SHALL show the same three counts. Before Diumumkan, counts SHALL be visible only to Admin Voting.

#### Scenario: Published single-candidate results

- **WHEN** a visitor opens the landing page after publication in single candidate mode with Setuju ahead
- **THEN** the page shows the three counts with percentages, the outcome line "Terpilih", permitted korda rows and turnout statistics, with no nomor urut

#### Scenario: Published tie

- **WHEN** results are published with Setuju equal to Tidak Setuju
- **THEN** the public outcome line reads "Seri, keputusan diserahkan kepada panitia" and no winner is named

#### Scenario: Closed but not published

- **WHEN** voting is closed but results have not been published
- **THEN** the landing page says "Pemungutan suara sudah ditutup. Hasil akan diumumkan panitia." without counts
