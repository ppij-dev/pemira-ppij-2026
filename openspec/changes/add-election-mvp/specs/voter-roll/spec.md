# Spec Delta

## Purpose

Keeps a Pemilih list of the members inside the site's scope, synced from the ppij-identity Service API,
so the committee can see who has voted, follow membership changes during voting and send personal reminders.

## ADDED Requirements

### Requirement: Pemilih list synced from the Service API
The system SHALL keep a list of members in scope (member_id, name, nickname, komsat path, status, map point of the komsat) synced from the Service API (`anggota.dasar`, `organisasi`) with `changed_since`, when an Admin Voting presses "Sinkronkan Data Pemilih", in every stage except Diumumkan.

#### Scenario: Sync adds new members
- **WHEN** three members became ACTIVE in scope since the last sync and an Admin Voting presses "Sinkronkan Data Pemilih"
- **THEN** the list gains three members, the last-sync time is shown in JST and an audit entry records "+3 baru"

#### Scenario: Service API not granted
- **WHEN** the Service API answers `no_grant`
- **THEN** the Pemilih page explains that the Portal admin has not granted data access yet, and voting itself keeps working

### Requirement: Pemilih list never decides eligibility
The Pemilih list SHALL only be used for counts, the map, reminders and the membership-change panel. Voting eligibility SHALL come only from the sign-in rule in `auth-and-eligibility`.

#### Scenario: Member missing from the list
- **WHEN** Dewi became ACTIVE an hour ago, no sync has happened since, and she signs in to vote
- **THEN** Dewi can vote, and she appears in the list after the next sync

### Requirement: Pemilih page
Admin Voting SHALL see the list with search by name, filter by komsat and voting state (sudah memilih, belum memilih), and for those who voted the time in JST. The page SHALL never show what anyone chose.

#### Scenario: Who has not voted in PPI Okayama
- **WHEN** an Admin Voting filters komsat PPI Okayama and "Belum memilih"
- **THEN** only Okayama members without a participation record are listed

### Requirement: Membership changes during voting
With `anggota.riwayat`, Dasbor SHALL show changes since voting opened: new members by source (daftar sendiri, didaftarkan Admin Portal, impor) and how many of them voted, suspensions, komsat moves and expiries, per komsat, with a detail list naming each person and the Admin Portal who acted.

#### Scenario: Members added by an Admin Portal
- **WHEN** an Admin Portal of PPI X registered 12 people during voting and 10 of them voted
- **THEN** the panel shows PPI X with "Didaftarkan Admin Portal 12 (10 sudah memilih)" and the detail list names each person and the Admin Portal

#### Scenario: Names stay internal
- **WHEN** a visitor opens the public receipt board after close
- **THEN** it shows per-komsat totals of membership changes and no names

### Requirement: WhatsApp reminder per voter
For a voter who has not voted, the Pemilih page SHALL show a WhatsApp icon. Clicking it SHALL fetch that voter's phone from the Service API (`anggota.kontak`, on behalf of the clicking Admin Voting) and open `wa.me` with a prefilled message, without storing the number.

#### Scenario: Japanese number
- **WHEN** an Admin Voting clicks the icon for Budi, whose phone is `090-1234-5678`
- **THEN** WhatsApp opens `https://wa.me/819012345678` with "Halo Kak Budi, kami tunggu suaramu ya. Klik tautan berikut untuk memilih: <base URL>", and the audit log records "Pengingat WA ke Budi"

#### Scenario: Number not stored
- **WHEN** the reminder link has been opened
- **THEN** the phone number exists nowhere in D1 or in logs

### Requirement: Email reminder when there is no phone
When the Service API returns no phone, the icon SHALL be an email icon that sends the Pengingat email to that voter, at most once per voter per 24 hours.

#### Scenario: Second email the same day
- **WHEN** an Admin Voting presses the email icon for Andi again 3 hours after the first reminder
- **THEN** the button is disabled with "Pengingat terakhir 14.05 JST, bisa dikirim lagi besok"

### Requirement: Group announcement text
Dasbor SHALL offer "Salin Teks Pengumuman", copying a ready message with the election title, time left until closing in JST and the site link, for pasting into chat groups. The system SHALL send nothing itself.

#### Scenario: Copy announcement
- **WHEN** an Admin Voting presses "Salin Teks Pengumuman" two days before closing
- **THEN** the clipboard holds the title, "Ditutup 7 Des 2026, 20.00 JST (2 hari lagi)" and the link

### Requirement: Data kept while the site exists
The Pemilih list SHALL be kept as long as the site exists. Phone numbers and email addresses fetched for reminders SHALL NOT be stored.

#### Scenario: After results
- **WHEN** results were published 60 days ago
- **THEN** the Pemilih list is still available to Admin Voting and contains no phone numbers
