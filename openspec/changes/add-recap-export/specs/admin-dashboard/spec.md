# Spec Delta: The Rekapitulasi page and the Dasbor wording

## Purpose

Owner decisions Q232–Q234 (2026-11-22): a new Admin Voting page "Rekapitulasi" carries
the recap action and the post-recap tabs, replacing the Hitung Abstain card in
Pengaturan. This modifies the sealed-dashboard delta of `seal-tally-until-published`:
the seal now lifts for Admin Voting when the recap is done, and the committee-facing
wording moves from Hitung Abstain to Rekapitulasi.

## ADDED Requirements

### Requirement: The Rekapitulasi page is in the navigation and renders by stage

The page at `/admin/rekap` SHALL sit in the Admin Voting navigation (after Undangan;
under Lainnya on phones) and SHALL render three states from the recap state. Outside
single candidate mode the page SHALL say the recap applies to single candidate
elections. The page SHALL follow the admin design language: semantic tokens, Tabler
icons only, Bahasa Indonesia, no polling, 44px minimum controls.

#### Scenario: Note before the close

- **WHEN** an Admin Voting opens the page while voting is Draf, Terjadwal or Dibuka
- **THEN** the page shows the recap heading with a note that it opens after voting closes and no recap button

#### Scenario: Dialog before the recap

- **WHEN** an Admin Voting opens the page while voting is Ditutup and the recap has not run
- **THEN** the page shows the heading, the explanation, and a Rekapitulasi Suara button whose dialog states the non-voter count and the one-way nature before any request is sent

#### Scenario: Tabs after the recap

- **WHEN** the recap is done and an Admin Voting opens the page
- **THEN** the five tabs Ringkasan, Korda, Komsat, Kotak suara and Abstain render the recap data, the Abstain tab shows anonymised counts per komsat with no name or member number, the Unduh Excel button builds the .xlsx in the browser from the loaded JSON, and a link points to Umumkan Hasil in Pengaturan

### Requirement: The recap confirmation dialog is one-way

After the close and before the recap, the page SHALL show the heading, a short
explanation, and the "Rekapitulasi Suara" button with a confirmation dialog that
states the non-voter count that will become Abstain, the count of unused invite links
that will be cancelled, and that the action is one-way.

#### Scenario: Dialog states the counts

- **WHEN** an Admin Voting opens the confirmation dialog before the recap has run
- **THEN** the dialog names the pending non-voter count that will become Abstain, states how many unused links will be cancelled, and says the action cannot be undone

#### Scenario: Excel is built in the browser

- **WHEN** the Unduh Excel button is used
- **THEN** the page audits the download with the server, then builds one .xlsx with the same five tabs as sheets using the bundled write-excel-file library, with no CDN script and no server file generation

## ADDED Requirements

### Requirement: Sealed choice counts on Dasbor lift at the recap

Before Diumumkan AND before the recap is done, Dasbor SHALL NOT show Setuju, Tidak
Setuju or Abstain answers cast, nor any candidate vote count, to any Admin Voting
(supersedes the "sealed until Diumumkan" wording of `seal-tally-until-published`).
Once `recap_at` is set, Dasbor SHALL show the counts to Admin Voting even while the
stage is Ditutup, and continue to show them after Diumumkan.

#### Scenario: Sealed until recap or announcement

- **WHEN** an Admin Voting loads Dasbor before Diumumkan and before the recap in either candidate mode
- **THEN** the tally section shows the sealed line and no choice figure

#### Scenario: Unsealed after the recap, before Diumumkan

- **WHEN** the recap has run in single candidate mode and an Admin Voting loads Dasbor while the stage is Ditutup
- **THEN** the "Sikap suara" section shows Setuju, Tidak Setuju and Abstain with their shares of Hak pilih, and the per-korda table keeps its participation columns

#### Scenario: Unsealed after Diumumkan

- **WHEN** results are Diumumkan and an Admin Voting loads Dasbor
- **THEN** the tally sections render exactly as they did before this change

### Requirement: Committee wording names Rekapitulasi, not Hitung Abstain

Where the committee-facing screens previously told the committee to run Hitung Abstain
(the Dasbor warning while Ditutup, the Pengaturan card), they SHALL now point to
Rekapitulasi Suara on the Rekapitulasi page. The public Abstain copy MAY keep its
explanation but SHALL NOT tell visitors to run an admin action.

#### Scenario: Dasbor warning points to the recap page

- **WHEN** voting is Ditutup in single candidate mode, the recap has not run, and an Admin Voting loads Dasbor
- **THEN** the tally section warns that the recap has not run and links to the Rekapitulasi page, with no Hitung Abstain wording

#### Scenario: Pengaturan loses the Hitung Abstain card

- **WHEN** an Admin Voting opens Pengaturan
- **THEN** no Hitung Abstain card or dialog exists, and the Umumkan Hasil card explains the recap comes first in single candidate mode
