# Spec Delta: Tidak Membekukan DPT switch, no-freeze locking, closing Hak pilih

## Purpose

Lets Admin Voting run an election whose Pemilih roll does not freeze at Kunci & Jadwalkan:
a "Tidak Membekukan DPT" switch frozen at Kunci & Jadwalkan (owner decision 2026-11-19)
but free in Draf, a locking rule that leaves the roll unfrozen while it is on, a
closing-time Hak pilih snapshot written once by the first read that observes the election
closed, because the stage is computed from the clock and no cron exists — and, since the
owner decision of 2026-11-22, a one-way mid-vote freeze driven by the same switch while
the election is locked and running.

## ADDED Requirements

### Requirement: Tidak Membekukan DPT switch in Pengaturan

While Draf, Pengaturan SHALL let Admin Voting turn the "Tidak Membekukan DPT" switch on or
off, and each toggle SHALL be recorded in the audit log. After Kunci & Jadwalkan the only
possible change is turning it off while the election is locked and running, which freezes
the roll (next requirement); it SHALL never be turned back on outside Draf. The switch
SHALL be off for a new election and independent of the other mode switches.

#### Scenario: Turn on in Draf

- **WHEN** an Admin Voting switches "Tidak Membekukan DPT" on in Pengaturan while Draf
- **THEN** the value is saved, the switch shows on, and an audit entry records the Admin Voting action

#### Scenario: Turn off again in Draf

- **WHEN** an Admin Voting switches it off again while Draf
- **THEN** the value is saved and a further audit entry records the action

#### Scenario: Turning on after Kunci is refused

- **WHEN** an Admin Voting tries to switch it on after Kunci & Jadwalkan
- **THEN** the request is refused, the value is unchanged and no audit entry is written

#### Scenario: Already frozen refuses further changes

- **WHEN** the roll is frozen (at Kunci & Jadwalkan or mid-vote) and an Admin Voting tries to change the switch
- **THEN** the request is refused, the switch shows off and disabled while locked, and no audit entry is written

### Requirement: Turning the switch off mid-vote freezes the roll one-way

While the election is locked and running (stage Terjadwal or Dibuka) in preview-off
elections, an Admin Voting SHALL be able to turn the switch off, which freezes the voter
roll immediately (owner decision 2026-11-22). The freeze SHALL first run one final full
Service API sync; a failed sync SHALL refuse the freeze and freeze nothing. A confirmed
freeze SHALL write `frozen_at`, `frozen_hak_pilih` and `live_voter_roll = 0` in one
guarded batch, exactly once, and SHALL be one-way.

#### Scenario: Confirmation dialog before freezing

- **WHEN** an Admin Voting turns the switch off while the election is locked and running in live mode
- **THEN** a confirmation dialog states the current Hak pilih and that the action is one-way, and nothing is frozen until the Admin Voting confirms

#### Scenario: Freeze succeeds with a final portal refresh

- **WHEN** an Admin Voting confirms the freeze while Terjadwal or Dibuka and the final full sync succeeds
- **THEN** `frozen_at`, `frozen_hak_pilih` and `live_voter_roll = 0` are written in one batch, and the Hak pilih afterwards equals the frozen count

#### Scenario: Portal failure refuses the freeze

- **WHEN** the final full sync fails (portal unreachable or returning errors)
- **THEN** the freeze is refused through the same sync path as Kunci & Jadwalkan with a clear error, `frozen_at` and `frozen_hak_pilih` stay NULL, the switch stays on, and no freeze audit entry is written

#### Scenario: Refused in Draf, after close and when already frozen

- **WHEN** the freeze is attempted while Draf, after the vote has closed, or when the roll is already frozen
- **THEN** each attempt is refused, the election data is unchanged, and no audit entry is written

### Requirement: Frozen switch shows disabled with the freeze time

After a successful freeze the batch SHALL write one audit entry naming the frozen count
and the time. While the election stays locked, Pengaturan SHALL show the switch off and
disabled beside a note naming the freeze time in JST, and turning it back on SHALL only
be possible in Draf.

#### Scenario: Switch disabled with the freeze time after freezing

- **WHEN** the roll has been frozen mid-vote and an Admin Voting opens Pengaturan while the election is still locked
- **THEN** the switch shows off and disabled beside a note naming the freeze time in JST

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
