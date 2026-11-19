# Spec Delta: Tidak Membekukan DPT switch, no-freeze locking, closing Hak pilih

## Purpose

Lets Admin Voting run an election whose Pemilih roll does not freeze at Kunci & Jadwalkan:
a Draf-only "Tidak Membekukan DPT" switch frozen at lock (owner decision 2026-11-19), a
locking rule that leaves the roll unfrozen while it is on, and a closing-time Hak pilih
snapshot written once by the first read that observes the election closed, because the
stage is computed from the clock and no cron exists.

## ADDED Requirements

### Requirement: Tidak Membekukan DPT switch in Pengaturan

While Draf, Pengaturan SHALL let Admin Voting turn the "Tidak Membekukan DPT" switch on or
off, and each toggle SHALL be recorded in the audit log. In later stages the switch SHALL
be shown read-only and SHALL refuse changes. The switch SHALL be off for a new election
and SHALL be independent of single candidate mode and preview mode.

#### Scenario: Turn on in Draf

- **WHEN** an Admin Voting switches "Tidak Membekukan DPT" on in Pengaturan while Draf
- **THEN** the value is saved, the switch shows on, and an audit entry records the Admin Voting action

#### Scenario: Turn off again in Draf

- **WHEN** an Admin Voting switches it off again while Draf
- **THEN** the value is saved and a further audit entry records the action

#### Scenario: Frozen after Kunci

- **WHEN** an Admin Voting tries to toggle the switch after Kunci & Jadwalkan
- **THEN** the request is refused, the switch stays read-only and the value is unchanged

### Requirement: Switch value frozen and recorded at Kunci & Jadwalkan

On successful Kunci & Jadwalkan, the switch value SHALL be recorded in the lock audit
entry's detail and SHALL no longer be changeable, in the same way as single candidate
mode.

#### Scenario: Lock detail records the frozen value

- **WHEN** Kunci & Jadwalkan succeeds with the switch on or off
- **THEN** the lock audit entry's detail records the frozen switch value

### Requirement: Kunci locks without freezing while the switch is on

While the switch is on, Kunci & Jadwalkan SHALL set the election to locked with
`frozen_at` and `frozen_hak_pilih` left NULL, and SHALL still run the final full Service
API sync so the live view starts complete — a failed full read SHALL block locking as
today. The lock audit detail SHALL record the starting view count. With the switch off,
locking SHALL freeze the roll exactly as today.

#### Scenario: Locked without a frozen roll

- **WHEN** Kunci & Jadwalkan succeeds with the switch on
- **THEN** the election is locked, `frozen_at` and `frozen_hak_pilih` stay NULL, and the lock audit detail records the starting portal view count

#### Scenario: Failed final sync still blocks

- **WHEN** the final full Service API read fails while the switch is on
- **THEN** Kunci fails, nothing locks and the election stays Draf

#### Scenario: Switch off unchanged

- **WHEN** Kunci & Jadwalkan succeeds with the switch off
- **THEN** the roll is frozen with `frozen_at` and `frozen_hak_pilih` set exactly as today

### Requirement: Closing Hak pilih saved once on first read after close

While the switch is on, the live Hak pilih count SHALL be fixed and saved into
`elections.closing_hak_pilih` with its time exactly once when voting closes — by deadline
or by Tutup Sekarang — with one system audit entry naming the saved number. Because the
stage is computed from the clock, the snapshot SHALL be written by the first read that
observes the election closed, or inside the Tutup Sekarang batch. With the switch off,
the columns SHALL stay NULL.

#### Scenario: Deadline close finalized on first read

- **WHEN** the deadline passes in live mode and any read (board, results, Hitung Abstain state or turnout) observes the election Ditutup
- **THEN** the live count at that moment is saved with its time, one system audit entry names the number, and later reads return the saved value

#### Scenario: Early close saved in the close batch

- **WHEN** an Admin Voting presses Tutup Sekarang in live mode
- **THEN** the same batch that closes the election saves the Hak pilih count and writes the audit entry, and no later read rewrites it

#### Scenario: Concurrent first reads produce one snapshot

- **WHEN** two reads finalize at the same time after the deadline
- **THEN** exactly one snapshot and one audit entry are written and both reads return the same saved number

#### Scenario: Switch off never writes the snapshot

- **WHEN** an election with the switch off closes
- **THEN** `closing_hak_pilih` stays NULL and every Hak pilih figure comes from `frozen_hak_pilih` as today

### Requirement: Saved Hak pilih governs after close

After the closing snapshot exists in live mode, results, Dasbor, the landing stat, Hitung
Abstain and Umumkan SHALL use the saved number, not a recomputed live count.

#### Scenario: Saved number governs after close

- **WHEN** voting has closed in live mode and results, Dasbor, Hitung Abstain or the landing stat read Hak pilih
- **THEN** each uses the saved `closing_hak_pilih`, not a recomputed live count

#### Scenario: Umumkan and Hitung Abstain on the saved number

- **WHEN** Admin Voting runs Hitung Abstain or Umumkan after close in live single candidate mode
- **THEN** the pending Abstain count and every share are computed from the saved number

### Requirement: Kembali ke Draf clears the saved Hak pilih

When Kembali ke Draf discards the closing data of a stage, it SHALL also clear
`closing_hak_pilih` and `closing_hak_pilih_at`, so the next Kunci & Jadwalkan starts
without one. The switch value itself SHALL be kept, as other Draf settings are.

#### Scenario: Reset on return to Draf

- **WHEN** a live-mode election is returned to Draf after the snapshot was saved
- **THEN** the saved count and time are cleared and the switch keeps its value
