# Spec Delta: Closing and announcing without looking at the counts

## Purpose

Sealing the tally must not block the closing steps (owner decision 2026-11-21): Tutup →
Hitung Abstain → Umumkan Hasil runs on participation data only, and the announcement is
valid without a look at the counts.

## ADDED Requirements

### Requirement: Hitung Abstain and Umumkan Hasil work while the tally is sealed

Hitung Abstain SHALL keep using Hak pilih minus participation, so it runs while the tally
is sealed and its dialog still shows the number it will add. Umumkan Hasil SHALL be
accepted while the tally is sealed and SHALL NOT require, display or confirm any choice
count. Its confirmation SHALL NOT contain a Setuju, Tidak Setuju, Abstain or candidate
count.

#### Scenario: Tutup then Hitung Abstain while sealed

- **WHEN** voting is Ditutup in single candidate mode and an Admin Voting runs Hitung Abstain
- **THEN** the action succeeds, stores the non-voter count and the tally stays sealed

#### Scenario: Umumkan without counts

- **WHEN** Hitung Abstain has run and an Admin Voting presses "Umumkan Hasil"
- **THEN** the confirmation reads "Umumkan hasil pemilihan?" with no count and the election becomes Diumumkan

#### Scenario: Umumkan refused before Hitung Abstain

- **WHEN** voting is Ditutup in single candidate mode and Hitung Abstain has not run
- **THEN** Umumkan Hasil is refused with the existing message and nothing is published

### Requirement: Counts appear immediately after Diumumkan

Immediately after Umumkan Hasil, the next manual load of Dasbor, the Hasil page and the
landing page SHALL show the choice counts, with no separate publish step, no cache to
clear and no background job.

#### Scenario: Load right after announcing

- **WHEN** an Admin Voting loads Dasbor and a visitor opens Hasil right after Umumkan Hasil
- **THEN** both show the choice counts, the per-korda breakdowns with the under-ten-ballot suppression and the participation figures
