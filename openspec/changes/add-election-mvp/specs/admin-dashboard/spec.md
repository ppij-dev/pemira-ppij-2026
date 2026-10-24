# Spec Delta

## Purpose
Gives Admin Voting a manually refreshed countdown, overall tally, korda-level results
and fixed-electorate statistics without background traffic.

## ADDED Requirements

### Requirement: Manual refresh only
Dasbor SHALL load its data when opened and when an Admin Voting presses "Muat Ulang Data", showing "Diperbarui <jam> JST". It SHALL NOT poll, stream or use WebSockets.

#### Scenario: Refresh
- **WHEN** an Admin Voting presses "Muat Ulang Data"
- **THEN** all blocks reload once and the updated time changes

### Requirement: Countdown
Dasbor SHALL show a large countdown in days, hours, minutes and seconds to the opening time (before Dibuka) or the closing time (while Dibuka), computed in the browser from the server's times.

#### Scenario: Voting open
- **WHEN** voting closes in 2 days 14 hours
- **THEN** Dasbor shows "Pemungutan suara ditutup dalam 02 : 14 : mm : ss" ticking every second

### Requirement: Korda-level regional results
Dasbor SHALL show a table aggregated by korda, not a komsat map. A korda with fewer than
10 ballots SHALL show turnout and "Data terlalu sedikit" instead of candidate counts.
The same suppression SHALL apply to public results after publication.

#### Scenario: Small korda
- **WHEN** a korda has four ballots
- **THEN** its row shows turnout and "Data terlalu sedikit", with no candidate breakdown

#### Scenario: Larger korda
- **WHEN** a korda has 12 ballots
- **THEN** its row shows candidate counts for that korda

### Requirement: Overall tally for Admin Voting
Dasbor SHALL show candidate number, nickname, color and overall vote count to Admin Voting
in every stage, including while voting is open. Each tally load SHALL be audit-logged.

#### Scenario: Tally viewed during voting
- **WHEN** Rina refreshes Dasbor during voting
- **THEN** she sees current overall and permitted korda results and an audit entry records her tally view

### Requirement: Voter statistics
Dasbor SHALL show Hak pilih fixed at the eligible size of the frozen Pemilih roll,
Sudah digunakan, Belum digunakan and turnout percentage. When the locked setting
excludes Admin Voting, they SHALL be excluded from Hak pilih.

#### Scenario: Statistics against the frozen roll
- **WHEN** the frozen roll holds 1,240 members, 10 are excluded Admin Voting and 710 have voted
- **THEN** Dasbor shows "Hak pilih 1.230", "Sudah digunakan 710", "Belum digunakan 520"

### Requirement: Count check
Dasbor SHALL compare "Surat Suara Terkirim" (participation rows) with "Jumlah Suara di Kotak" (ballot rows) and show "Sesuai" in green when equal or "Tidak sesuai" in red otherwise.

#### Scenario: Rows edited outside the app
- **WHEN** a ballot row was inserted directly into D1
- **THEN** Dasbor shows "Surat Suara Terkirim 710 · Jumlah Suara di Kotak 711 · Tidak sesuai" in red

### Requirement: Committee size warning
When only one Admin Voting exists, Dasbor SHALL show "Sebaiknya ada minimal 2 Admin Voting" with a link to the Admin Voting page.

#### Scenario: Single committee member
- **WHEN** Dimas is the only Admin Voting
- **THEN** the warning is shown at the top of Dasbor
