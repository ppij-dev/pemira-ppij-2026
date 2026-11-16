# Spec Delta: Published single-candidate results

## Purpose

Once results are published in single candidate mode, the public pages show the same three
counts and their shares of Hak pilih with no nomor urut and no outcome line, with the
korda suppression and the publish-before-visible rule unchanged. The system does not state
whether the candidate is elected (owner decision 2026-11-16, superseding W7 Q37/Q38).

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

Once Diumumkan in single candidate mode, the landing page and Hasil tab SHALL present the Setuju, Tidak Setuju and Abstain counts with their shares of Hak pilih and no nomor urut, and SHALL NOT show any outcome line. Korda rows SHALL show the same counts under the existing suppression, and turnout SHALL appear as today.

#### Scenario: Published single-candidate results

- **WHEN** a visitor opens the landing page after publication in single candidate mode with Hak pilih 100, 50 Setuju, 30 Tidak Setuju, 5 Abstain cast and 15 who did not vote
- **THEN** the page shows Setuju 50%, Tidak Setuju 30% and Abstain 20% of Hak pilih (5 cast plus 15 tidak memilih), permitted korda rows and turnout statistics, with no nomor urut and no outcome line

### Requirement: Published Abstain includes non-voters

On the public pages, non-voters SHALL count as Abstain, derived from the frozen Hak pilih minus participation, and the Abstain total SHALL be shown with its parts: the Abstain answers cast and "tidak memilih (dihitung Abstain)".

#### Scenario: Published with no ballots

- **WHEN** results are published in single candidate mode and no ballots were cast at all
- **THEN** every eligible member counts as "tidak memilih (dihitung Abstain)" and no outcome wording appears

#### Scenario: Closed but not published

- **WHEN** voting is closed but results have not been published
- **THEN** the landing page says "Pemungutan suara sudah ditutup. Hasil akan diumumkan panitia." without counts
