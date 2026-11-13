# Spec Delta: Published single-candidate results

## Purpose

Once results are published in single candidate mode, the public pages show the same three
counts, percentages and the outcome line with no nomor urut, with the korda suppression
and the publish-before-visible rule unchanged.

## ADDED Requirements

### Requirement: Number-free single candidate card on the landing page

While single candidate mode is on, the landing page's candidate card SHALL omit the nomor urut and link to `/kandidat/<nickname>`. With the mode off, the card SHALL show the number and link to the numbered candidate page as today.

#### Scenario: Landing card without nomor urut

- **WHEN** a visitor opens the landing page while single candidate mode is on
- **THEN** the candidate card shows nickname, color and placeholder image with no nomor urut and links to `/kandidat/<nickname>`

#### Scenario: Multi-candidate landing unchanged

- **WHEN** a visitor opens the landing page in a multi-candidate election
- **THEN** candidate cards show numbers and link to the numbered candidate pages as today

### Requirement: Published single-candidate results

Once Diumumkan in single candidate mode, the landing page and Hasil tab SHALL present the Setuju, Tidak Setuju and Abstain counts with their shares of votes cast, the outcome line ("Terpilih", "Tidak terpilih", "Belum ada suara" or "Seri, keputusan diserahkan kepada panitia") and no nomor urut; korda rows SHALL show the same three counts under the existing suppression, and turnout statistics SHALL appear as today. Before Diumumkan, counts SHALL be visible only to Admin Voting.

#### Scenario: Published single-candidate results

- **WHEN** a visitor opens the landing page after publication in single candidate mode with Setuju ahead
- **THEN** the page shows the three counts with percentages, the outcome line "Terpilih", permitted korda rows and turnout statistics, with no nomor urut

#### Scenario: Published tie

- **WHEN** results are published with Setuju equal to Tidak Setuju and at least one ballot cast
- **THEN** the public outcome line reads "Seri, keputusan diserahkan kepada panitia" and no winner is named

#### Scenario: Published with no ballots

- **WHEN** results are published in single candidate mode and no ballots were cast
- **THEN** the public outcome line reads "Belum ada suara" and no winner is named

#### Scenario: Closed but not published

- **WHEN** voting is closed but results have not been published
- **THEN** the landing page says "Pemungutan suara sudah ditutup. Hasil akan diumumkan panitia." without counts
