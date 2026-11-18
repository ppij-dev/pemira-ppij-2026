# Spec Delta: Link lifecycle across the election stages

## Purpose

Direct invitation links are preparation data that can appear until voting closes, survive
a "Kembali ke Draf", and are recorded separately from the frozen roll at Kunci &
Jadwalkan.

## ADDED Requirements

### Requirement: Links can only be generated or cancelled before the close

Generating and cancelling direct invitation links SHALL be allowed while the election is
Draf, Terjadwal or Dibuka, and SHALL be refused while it is Ditutup or Diumumkan. The
refusal SHALL be enforced on the server at write time, so a race with "Tutup Sekarang" or
the clock cannot add or remove a link after the close. Readiness checks and Kunci &
Jadwalkan SHALL be unchanged by the presence of links.

#### Scenario: Closed election refuses both actions

- **WHEN** an Admin Voting tries to generate or cancel a link while the election is
  Ditutup by the clock or by "Tutup Sekarang"
- **THEN** the request is refused and no invitation row changes

#### Scenario: Race with close cannot move Hak pilih

- **WHEN** a generation request is processed while the election is closing
- **THEN** the write only succeeds while the election is still inside the allowed window,
  and Hak pilih afterwards is final

#### Scenario: Readiness and Kunci unaffected

- **WHEN** readiness is checked or Kunci & Jadwalkan runs while links exist
- **THEN** the readiness checks are the same as without links and the lock succeeds or
  fails on those checks alone

### Requirement: Kunci & Jadwalkan records the frozen roll and the active links separately

The lock audit detail SHALL record the frozen roll count and the number of non-cancelled
direct invitation links as separate values, so the two Hak pilih terms can always be
reconciled. The frozen column SHALL stay the roll term only.

#### Scenario: Lock audit detail

- **WHEN** Kunci & Jadwalkan runs with 7 active links
- **THEN** the audit detail records the frozen roll count and 7 active links, and
  `frozen_hak_pilih` holds the roll count alone

### Requirement: Links survive Kembali ke Draf and the next Kunci

A "Kembali ke Draf" SHALL leave direct invitation rows untouched, and the next Kunci &
Jadwalkan SHALL neither delete nor rewrite them. Their statuses SHALL persist across the
return: a used link stays Sudah Dipakai, a cancelled link stays Dibatalkan, and remaining
links stay Belum Dipakai and keep counting.

#### Scenario: Return to Draf keeps link statuses

- **WHEN** an election with a used, a cancelled and two unused links returns to Draf
- **THEN** all four rows are unchanged and Hak pilih is the fresh roll plus the two unused
  and one used link

#### Scenario: Next Kunci does not touch links

- **WHEN** the returned election is locked again
- **THEN** the direct invitation rows are byte-for-byte unchanged and each counts exactly
  once in the effective Hak pilih
