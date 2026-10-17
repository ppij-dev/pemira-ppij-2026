# Spec Delta

## Purpose

Runs the one election a site holds through its stages, from preparation and test votes to opening,
closing and publishing results, with the schedule deciding when voting starts and stops.

## ADDED Requirements

### Requirement: One election per site
Each site SHALL hold exactly one election with a title, description, opening time and closing time in JST.

#### Scenario: Election created at setup
- **WHEN** setup completes
- **THEN** the site has one election in stage Draf with an empty schedule

### Requirement: Stages follow the schedule
The election SHALL be in stage Draf until locked, Terjadwal after Kunci & Jadwalkan until its opening time, Dibuka until its closing time, Ditutup afterwards, and Diumumkan once results are published. Stage SHALL be computed from the clock on every request, with no background job.

#### Scenario: Closing exactly on time
- **WHEN** the closing time is 7 Dec 2026 20.00 JST and a vote arrives at 20.00.01 JST
- **THEN** the election is Ditutup and the vote is rejected with "Pemungutan suara sudah ditutup"

### Requirement: Readiness checks before locking
"Kunci & Jadwalkan" SHALL succeed only when the schedule is set with the opening time in the future, there are at least 2 candidates, nicknames are unique ignoring case, the Pemilih list has been synced at least once, and no candidate is an Admin Voting. The page SHALL list each check with its state.

#### Scenario: One candidate only
- **WHEN** an Admin Voting presses "Kunci & Jadwalkan" with one candidate
- **THEN** nothing is locked and the check "Minimal 2 kandidat" is shown as failing

### Requirement: Locking freezes the election
On "Kunci & Jadwalkan" the system SHALL delete all Uji Coba data, draw a random color for each candidate from the palette, and freeze candidates, title, description, opening time and the setting "Admin Voting boleh ikut memilih".

#### Scenario: Test votes removed
- **WHEN** 4 test votes exist and the election is locked
- **THEN** participation and ballot tables are empty and the audit log records "Data uji coba dihapus: 4 suara"

### Requirement: Uji Coba in Draf
In Draf, Admin Voting SHALL be able to try the whole voting flow with test votes. Every voter screen SHALL show a yellow banner "Mode uji coba — suara akan dihapus saat pemilihan dikunci".

#### Scenario: Admin Voting tries voting
- **WHEN** Rina votes in Draf
- **THEN** she receives a receipt, sees the banner, and the vote appears on Dasbor marked as test data

### Requirement: Extend voting
While Dibuka, an Admin Voting SHALL be able to move the closing time later with a reason. The landing page SHALL show "Diperpanjang hingga <waktu JST>" and the reason SHALL be audit-logged. Moving it earlier SHALL NOT be possible this way.

#### Scenario: Extension
- **WHEN** an Admin Voting extends closing from 20.00 to 22.00 JST with reason "Gangguan login 30 menit"
- **THEN** voting stays open until 22.00 JST and the landing page shows the new time

### Requirement: Close early
While Dibuka, an Admin Voting SHALL be able to close voting at once with "Tutup Sekarang" and a reason, after confirming a dialog.

#### Scenario: Emergency close
- **WHEN** an Admin Voting presses "Tutup Sekarang" with reason "Dugaan penyalahgunaan akun"
- **THEN** the election is Ditutup immediately and the reason is audit-logged

### Requirement: Publish results
While Ditutup, an Admin Voting SHALL be able to press "Umumkan Hasil", after a confirmation dialog, which moves the election to Diumumkan permanently and makes results public.

#### Scenario: Results published
- **WHEN** an Admin Voting presses "Umumkan Hasil" and confirms
- **THEN** the landing page shows results, voters see the Hasil tab, and the action cannot be undone
