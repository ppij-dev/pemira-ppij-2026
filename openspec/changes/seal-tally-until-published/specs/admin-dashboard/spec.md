# Spec Delta: Dasbor shows a sealed tally until Diumumkan

## Purpose

Dasbor still shows the stage, the countdown, Hak pilih, participation and the count check
in every stage, but the way people voted stays sealed for the committee until the result
is announced (owner decision 2026-11-21). This supersedes the "in every stage, including
while voting is open" wording of the overall tally and single candidate tally requirements
in `add-election-mvp` and `add-single-candidate-mode`.

## ADDED Requirements

### Requirement: Sealed choice counts on Dasbor

Before Diumumkan, Dasbor SHALL NOT show Setuju, Tidak Setuju or Abstain answers cast, nor
any candidate vote count, to any Admin Voting.

#### Scenario: Sealed line replaces the numbers

- **WHEN** an Admin Voting loads Dasbor before Diumumkan in either candidate mode
- **THEN** the tally section shows a lock icon, "Hasil disegel sampai Umumkan Hasil" and one sentence saying the committee does not see the direction of votes until the result is announced, so the count stays neutral and every Pemilih's choice stays secret

#### Scenario: Figures come from the sealed payload

- **WHEN** the sealed payload reaches the page
- **THEN** the page renders the seal state from `tally_sealed` and never formats a choice figure

#### Scenario: Single candidate mode while voting is open

- **WHEN** an Admin Voting loads Dasbor in single candidate mode while voting is Dibuka
- **THEN** the "Sikap Suara" section shows a lock icon and "Hasil disegel sampai Umumkan Hasil" and no Setuju, Tidak Setuju or Abstain count

#### Scenario: Multi-candidate mode while voting is open

- **WHEN** an Admin Voting loads Dasbor in multi-candidate mode while voting is Dibuka
- **THEN** the "Perolehan suara keseluruhan" section shows the sealed line and no candidate vote count

#### Scenario: Voting closed but not announced

- **WHEN** an Admin Voting loads Dasbor after voting is Ditutup and before Umumkan Hasil
- **THEN** the tally sections stay sealed and the section that says Hitung Abstain has not run keeps its usual place

### Requirement: Sealed tally in the korda table

Before Diumumkan, the per-korda table SHALL show only the Korda, Hak pilih, Digunakan and
Partisipasi columns, with no choice column header or cell, and SHALL show the note "Angka
pilihan per korda muncul setelah Umumkan Hasil." under the table. After Diumumkan the
table SHALL show the choice columns exactly as today, including "Data terlalu sedikit" for
a korda under ten ballots.

#### Scenario: Regional table while sealed

- **WHEN** an Admin Voting loads Dasbor while voting is Dibuka
- **THEN** every korda row shows its Hak pilih, Digunakan and Partisipasi figures, no choice column is rendered, and the note says the per-korda choice figures appear after announcement

#### Scenario: Regional table after announcement

- **WHEN** results are Diumumkan and an Admin Voting loads Dasbor
- **THEN** the korda rows show the choice figures as today and a korda under ten ballots shows "Data terlalu sedikit"

### Requirement: Participation stays visible while sealed

While the tally is sealed, Dasbor SHALL keep showing the stage, the countdown, Hak pilih,
Sudah digunakan, Belum digunakan, turnout, Surat suara terkirim, Suara di kotak, the
"Sesuai" or "Tidak sesuai" count check, the per-korda participation figures, the Uji Coba
test counts and the count of members who did not vote (Hak pilih minus participation).

#### Scenario: Turnout during voting

- **WHEN** 710 of 1.230 eligible members have voted while voting is Dibuka
- **THEN** Dasbor shows "Hak pilih 1.230", "Sudah digunakan 710", "Belum digunakan 520" and the turnout percentage, while the choice counts stay sealed

#### Scenario: Non-voter count before Hitung Abstain

- **WHEN** voting is Ditutup, Hitung Abstain has not run and 520 eligible members did not vote
- **THEN** Dasbor still shows 520 members who did not vote and tells the committee that results cannot be published before Hitung Abstain runs

### Requirement: Tally opens after Umumkan Hasil

After Diumumkan, Dasbor SHALL show the choice counts, their percentages and the per-korda
breakdowns exactly as it did before this change, in single candidate mode and in
multi-candidate mode.

#### Scenario: After announcement in single candidate mode

- **WHEN** results are Diumumkan with Hak pilih 100, 50 Setuju, 30 Tidak Setuju, 5 Abstain answers and 15 members who did not vote
- **THEN** Dasbor shows Setuju 50 (50%), Tidak Setuju 30 (30%) and Abstain 20 (20%), with the Abstain parts and no outcome line

#### Scenario: After announcement in multi-candidate mode

- **WHEN** results are Diumumkan in multi-candidate mode and an Admin Voting loads Dasbor
- **THEN** the overall and per-korda candidate counts appear as today
