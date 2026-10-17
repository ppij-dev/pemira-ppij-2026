# Spec Delta

## Purpose

Gives Admin Voting one screen with the countdown, regional map, live tally and voter statistics,
refreshed only when they ask, so the committee can follow the election without background traffic.

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

### Requirement: Regional map
Dasbor SHALL show a map of Japan (Leaflet, OpenStreetMap) with korda circles that split into komsat circles when zoomed in, showing turnout per region and, from the tally, the leading candidate's color per region.

#### Scenario: Zoom into a korda
- **WHEN** an Admin Voting zooms into Korda Kansai
- **THEN** each komsat of Kansai shows its own circle with turnout and leading color

### Requirement: Small regions folded into the korda
A komsat with fewer than 10 ballots SHALL have no result of its own: its ballots count toward its korda, and its circle shows "Data terlalu sedikit".

#### Scenario: Komsat with 4 ballots
- **WHEN** PPI Tottori has 4 ballots
- **THEN** its circle shows turnout and "Data terlalu sedikit", and its 4 ballots are included in the korda's result

### Requirement: Live tally for Admin Voting
Dasbor SHALL show candidate chips (number, nickname, color) and a bar chart of votes per candidate to Admin Voting in every stage, including while voting is open. Each load of the tally SHALL be audit-logged as "<nama> membuka perolehan suara".

#### Scenario: Tally viewed during voting
- **WHEN** Rina refreshes Dasbor at 02.40 JST during voting
- **THEN** she sees the current tally and the audit log gains "Rina Putri membuka perolehan suara, 02.40 JST"

### Requirement: Voter statistics
Dasbor SHALL show Hak pilih (eligible count from the Pemilih list, split into the count at opening plus new members), Sudah digunakan, Belum digunakan and turnout percentage.

#### Scenario: New members during voting
- **WHEN** 1.240 members were eligible at opening, 35 became ACTIVE since, and 710 voted
- **THEN** Dasbor shows "Hak pilih 1.275 (1.240 saat dibuka + 35 anggota baru)", "Sudah digunakan 710", "Belum digunakan 565"

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
