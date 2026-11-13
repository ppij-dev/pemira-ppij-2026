# Spec Delta: Published single-candidate results

## Purpose

Once results are published in single candidate mode, the public pages show the same three
counts, percentages and the outcome line, with the korda suppression and the
publish-before-visible rule unchanged.

## MODIFIED Requirements

### Requirement: Results after publication

Once Diumumkan, the landing page and Hasil tab SHALL show the overall tally, the korda-level table with rows under ten ballots suppressed, and turnout statistics. In single candidate mode the overall tally SHALL present the Setuju, Tidak Setuju and Abstain counts with percentages of votes cast and the outcome line ("Terpilih", "Tidak terpilih" or "Seri, keputusan diserahkan kepada panitia"), and korda rows SHALL show the same three counts. Before Diumumkan, counts SHALL be visible only to Admin Voting.

#### Scenario: Published single-candidate results

- **WHEN** a visitor opens the landing page after publication in single candidate mode with Setuju ahead
- **THEN** the page shows the three counts with percentages, the outcome line "Terpilih", permitted korda rows and turnout statistics

#### Scenario: Published tie

- **WHEN** results are published with Setuju equal to Tidak Setuju
- **THEN** the public outcome line reads "Seri, keputusan diserahkan kepada panitia" and no winner is named

#### Scenario: Closed but not published

- **WHEN** voting is closed but results have not been published
- **THEN** the landing page says "Pemungutan suara sudah ditutup. Hasil akan diumumkan panitia." without counts
