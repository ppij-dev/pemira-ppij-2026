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

Once Diumumkan in single candidate mode, the landing page and Hasil tab SHALL present the Setuju, Tidak Setuju and Tidak memilih counts with their shares of Hak pilih plus one outcome line, and no nomor urut. Non-voters SHALL count as Tidak Setuju, derived from the frozen Hak pilih minus participation. Korda rows SHALL show the same three counts under the existing suppression, and turnout SHALL appear as today.

#### Scenario: Published single-candidate results

- **WHEN** a visitor opens the landing page after publication in single candidate mode with Hak pilih 100, 55 Setuju, 30 Tidak Setuju and 15 Tidak memilih
- **THEN** the page shows the three counts with 55%, 30% and 15% of Hak pilih, the outcome line "Terpilih", permitted korda rows and turnout statistics, with no nomor urut

#### Scenario: Published tie

- **WHEN** results are published with Setuju equal to Tidak Setuju plus Tidak memilih and Hak pilih above zero
- **THEN** the public outcome line reads "Seri, keputusan diserahkan kepada panitia" and no winner is named

#### Scenario: Published with no ballots

- **WHEN** results are published in single candidate mode and no ballots were cast at all
- **THEN** every eligible member counts as Tidak memilih and the public outcome line reads "Tidak terpilih"

#### Scenario: Closed but not published

- **WHEN** voting is closed but results have not been published
- **THEN** the landing page says "Pemungutan suara sudah ditutup. Hasil akan diumumkan panitia." without counts
