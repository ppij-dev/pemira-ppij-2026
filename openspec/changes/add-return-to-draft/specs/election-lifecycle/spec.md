# Spec Delta: Kembali ke Draf action, state reset and kept votes

## Purpose

Lets Admin Voting return a locked election to Draf from Pengaturan — permissively in Mode
Pratinjau, only before voting opens in a real election, never after Diumumkan — while
votes already cast stay kept, counted and protected.

## ADDED Requirements

### Requirement: Kembali ke Draf action availability

Pengaturan SHALL offer a "Kembali ke Draf" action to any Admin Voting only while the
election is locked and either Mode Pratinjau is on or voting has not opened yet
(now < opens_at). The action SHALL be refused while the election is Draf, in a real
election once voting has opened or closed, and once results are Diumumkan in every mode.

#### Scenario: Preview open returns to Draf

- **WHEN** an Admin Voting uses "Kembali ke Draf" in Pengaturan while Mode Pratinjau is
  on and the locked election is Dibuka
- **THEN** the election returns to Draf with the votes cast so far kept

#### Scenario: Preview closed returns to Draf

- **WHEN** an Admin Voting uses "Kembali ke Draf" while Mode Pratinjau is on and the
  locked election is Ditutup, whether by the clock or by "Tutup Sekarang"
- **THEN** the election returns to Draf with the kept votes, and the early-close and
  snapshot data of the abandoned closing is cleared

#### Scenario: Preview Terjadwal returns to Draf

- **WHEN** an Admin Voting uses "Kembali ke Draf" while Mode Pratinjau is on and the
  locked election is Terjadwal (before opens_at)
- **THEN** the election returns to Draf

#### Scenario: Real election before open returns to Draf

- **WHEN** an Admin Voting uses "Kembali ke Draf" in a real election (Mode Pratinjau
  off) while the locked election is Terjadwal and now < opens_at
- **THEN** the election returns to Draf, with zero ballots kept by construction

#### Scenario: Real election after open refused

- **WHEN** an Admin Voting tries "Kembali ke Draf" in a real election after opens_at
  (Dibuka or Ditutup)
- **THEN** the request is refused with a message that voting has already opened, the
  election stays locked and nothing changes

#### Scenario: Published refused in every mode

- **WHEN** an Admin Voting tries "Kembali ke Draf" after the results are Diumumkan, in
  Mode Pratinjau or a real election
- **THEN** the request is refused with a message that announced results are final, the
  election stays Diumumkan and nothing changes

#### Scenario: Draf refused

- **WHEN** the election is already Draf and a return-to-draft request arrives
- **THEN** the request is refused and nothing changes

### Requirement: Pengaturan presentation of Kembali ke Draf

Pengaturan SHALL show a helper text with the action stating that returning keeps the
votes already cast, SHALL hide the action outside the allowed stages, and where kept
ballots exist SHALL state how many are kept.

#### Scenario: Action hidden in Draf and after Diumumkan

- **WHEN** an Admin Voting opens Pengaturan while the election is Draf or Diumumkan
- **THEN** the "Kembali ke Draf" action is not offered

#### Scenario: Kept votes stated with the action

- **WHEN** an Admin Voting opens Pengaturan for a locked election that has kept ballots
- **THEN** the helper text says returning keeps the votes already cast and states how
  many are kept

### Requirement: Confirmation phrase for Kembali ke Draf

The "Kembali ke Draf" action SHALL require the Admin Voting to type the confirmation
phrase "KEMBALI KE DRAF" in a dialog before it runs, and the server SHALL re-check the
phrase, accepting case and whitespace variants and refusing anything else. The dialog
SHALL state that kept votes stay saved and cannot be retracted, naming the kept count
when ballots exist.

#### Scenario: Correct phrase confirms

- **WHEN** an Admin Voting types "KEMBALI KE DRAF" (or a case/whitespace variant) in the
  dialog and submits while the stage allows the return
- **THEN** the return proceeds and the election is back in Draf

#### Scenario: Wrong phrase refused

- **WHEN** an Admin Voting types a different or empty phrase
- **THEN** the request is refused with a message that the phrase does not match, and the
  election stays unchanged

#### Scenario: Non-admin refused

- **WHEN** a request to return-to-draft arrives without an Admin Voting session
- **THEN** the request is refused by the admin guard like every other Admin Voting
  action, nothing changes and nothing is recorded

### Requirement: Cleared state on return to Draf

On an accepted "Kembali ke Draf" the election SHALL return to `status_lock='draft'`, and
`frozen_hak_pilih`, `frozen_at`, `closed_early_at`, `closing_snapshot_hash` and
`closing_snapshot_at` SHALL be cleared. A Kunci & Jadwalkan after the return SHALL lock
and open normally instead of sitting in Ditutup.

#### Scenario: Re-locked election opens instead of sitting closed

- **WHEN** an election that was returned from Ditutup (Tutup Sekarang) is locked again
  by Kunci & Jadwalkan
- **THEN** no `closed_early_at` or closing snapshot remains from the abandoned closing,
  and the election opens or stays Terjadwal according to the clock, not Ditutup

### Requirement: Kept settings and readiness after the return

The schedule, title, description, Mode Pratinjau, Mode kandidat tunggal and Izinkan
Admin Voting memilih SHALL stay, Pengaturan settings SHALL become editable again, and
readiness SHALL be recomputed from the elections row on the next page load (manual
refresh only).

#### Scenario: Settings editable again

- **WHEN** the return completes and an Admin Voting reloads the Persiapan page
- **THEN** schedule, candidates, Uji Coba and the other Pengaturan settings accept edits
  again, as in any Draf election

#### Scenario: Readiness recomputed for the kept schedule

- **WHEN** the return completes with the schedule kept and the Persiapan page is loaded
- **THEN** the readiness checks are recomputed from the elections row, and a real
  election whose kept opens_at is still in the future passes `opens_future` again

### Requirement: Kept votes survive the return and the next Kunci

Votes already cast (participation, ballots and receipt hashes) SHALL be kept untouched by
the return. At the next Kunci & Jadwalkan the Pemilih roll SHALL be rebuilt and Hak pilih
SHALL be frozen anew; kept ballots SHALL be counted in results regardless of the fresh
roll; kept participation rows SHALL stay, so one vote per member still holds; and only
Uji Coba (test) data SHALL be purged, as today. Kept receipts SHALL stay verifiable
through the receipt board after the next close.

#### Scenario: Re-Kunci after return with kept votes

- **WHEN** Kunci & Jadwalkan runs after a return that kept ballots and participation
- **THEN** Hak pilih is frozen anew from the fresh roll, the earlier participation rows
  and ballots remain, only test data is purged, and the lock audit records the new
  frozen count

#### Scenario: Member dropped from the fresh roll keeps a counted ballot

- **WHEN** the next Kunci rebuilds the roll without a member who voted in the earlier
  open
- **THEN** that member's ballot stays counted in results and their participation row
  stays, and the member is not in the frozen roll anymore

### Requirement: Mode kandidat tunggal frozen while kept ballots exist

While kept (non-test) ballots exist, the Mode kandidat tunggal switch SHALL refuse
changes in both directions — turning it off and turning it on — on the server, and
Pengaturan SHALL show it read-only with a message naming the kept ballots, because a
ballot's meaning is fixed when it is cast and stored ballots cannot be rewritten without
breaking ballot secrecy.

#### Scenario: Turning the switch off refused with kept ballots

- **WHEN** an Admin Voting tries to turn Mode kandidat tunggal off while kept ballots
  exist
- **THEN** the request is refused with a message naming the kept ballots and the frozen
  value stays unchanged

#### Scenario: Turning the switch on refused with kept ballots

- **WHEN** an Admin Voting tries to turn Mode kandidat tunggal on in a Draf election
  that kept ballots cast while the mode was off
- **THEN** the request is refused with a message naming the kept ballots and the mode
  stays off

### Requirement: Uji Coba does not lock the mode switch

Uji Coba (test) ballots SHALL never lock the Mode kandidat tunggal switch, and a
returned election SHALL keep offering Uji Coba as rehearsal that the next Kunci purges
as today.

#### Scenario: Uji Coba does not lock the switch

- **WHEN** an Admin Voting performs a Uji Coba vote in Draf after the return
- **THEN** the Mode kandidat tunggal switch stays editable, and the next Kunci purges
  the Uji Coba rows as today
