# Spec Delta: Published single-candidate results

## Purpose

Once results are published in single candidate mode, the public pages show the same three
counts and their shares of Hak pilih with no nomor urut and no outcome line, with the
korda suppression and the publish-before-visible rule unchanged. The system does not state
whether the candidate is elected (owner decision 2026-11-16, superseding W7 Q37/Q38).
Results cannot be published before Admin Voting has run Hitung Abstain (owner decision Q193), so public pages show non-voters counted as Abstain, which is the only thing Abstain means since the owner decision of 2026-11-22 removed it as a ballot answer.

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

- **WHEN** a visitor opens the landing page after publication in single candidate mode with Hak pilih 100, 50 Setuju, 30 Tidak Setuju and 20 who did not vote
- **THEN** the page shows Setuju 50%, Tidak Setuju 30% and Abstain 20% of Hak pilih (the 20 who did not vote), permitted korda rows and turnout statistics, with no nomor urut and no outcome line

### Requirement: Published Abstain is the non-voters

On the public pages, Abstain SHALL be the non-voters counted with the number stored when Admin Voting ran Hitung Abstain (Hak pilih minus participation at that time), shown as one figure with no "Abstain diberikan" part, because Abstain is not a ballot answer since the owner decision of 2026-11-22. A payload without a stored count SHALL show Abstain as 0 plus "N tidak memilih (belum dihitung)" rather than adding non-voters.

#### Scenario: Published with no ballots

- **WHEN** results are published in single candidate mode and no ballots were cast at all
- **THEN** every eligible member counts as Abstain and no outcome wording appears

#### Scenario: Closed but not published

- **WHEN** voting is closed but results have not been published
- **THEN** the landing page says "Pemungutan suara sudah ditutup. Hasil akan diumumkan panitia." without counts
