# Spec Delta

## Purpose

Keeps the Pemilih roll of the members inside the site's scope, synced from the ppij-identity Service API
and frozen at Kunci & Jadwalkan, so the committee can see who has voted and send personal reminders
against a fixed electorate.

## ADDED Requirements

### Requirement: Pemilih list synced from the Service API
The system SHALL keep a list of members in scope (member_id, name, nickname, komsat path, status, map point of the komsat) synced from the Service API (`anggota.dasar`, `organisasi`) with `changed_since`, when an Admin Voting presses "Sinkronkan Data Pemilih". The button SHALL be available only in stage Draf.

#### Scenario: Sync adds new members
- **WHEN** three members became ACTIVE in scope since the last sync and an Admin Voting presses "Sinkronkan Data Pemilih" in Draf
- **THEN** the list gains three members, the last-sync time is shown in JST and an audit entry records "+3 baru"

#### Scenario: Sync only in Draf
- **WHEN** an Admin Voting opens the Pemilih page while the election is Dibuka
- **THEN** "Sinkronkan Data Pemilih" is not offered and the page says the roll was frozen at Kunci

#### Scenario: Service API not granted
- **WHEN** the Service API answers `no_grant`
- **THEN** the Pemilih page explains that the Portal admin has not granted data access yet, and sign-in itself keeps working

### Requirement: Frozen roll at Kunci & Jadwalkan
"Kunci & Jadwalkan" SHALL run one final sync of the Pemilih list and freeze the roll as the snapshot of the ACTIVE members in scope at that moment. After the lock the system SHALL NOT sync the Pemilih list again in any stage. Hak pilih SHALL be exactly the size of the frozen roll for the rest of the election.

#### Scenario: Final sync freezes the roll
- **WHEN** an Admin Voting presses "Kunci & Jadwalkan" with a reachable Service API
- **THEN** the final sync runs first, the roll is frozen with its member count recorded in the audit log, and the last-sync time is shown in JST

#### Scenario: Failed final sync blocks locking
- **WHEN** the final sync fails or answers `no_grant` at "Kunci & Jadwalkan"
- **THEN** nothing is locked and the page shows the failing check so the committee can retry

### Requirement: Eligibility needs the frozen roll and a fresh sign-in
The frozen roll SHALL never grant a vote by itself: voting eligibility SHALL require both membership of the frozen roll and the sign-in rule in `auth-and-eligibility`. A member who becomes ACTIVE after the lock is not on the frozen roll and SHALL NOT vote this election.

#### Scenario: Member who joined after the lock
- **WHEN** Dewi becomes ACTIVE in PPI Okayama on day 3 of voting and signs in to the PPI Okayama site
- **THEN** she cannot vote, and Pilih Suara explains in a friendly message that the daftar pemilih was frozen when the election was locked

### Requirement: Pemilih page
Admin Voting SHALL see the list with search by name, filter by komsat and voting state (sudah memilih, belum memilih), and for those who voted the time in JST. The page SHALL never show what anyone chose.

#### Scenario: Who has not voted in PPI Okayama
- **WHEN** an Admin Voting filters komsat PPI Okayama and "Belum memilih"
- **THEN** only Okayama members without a participation record are listed

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
The frozen Pemilih roll SHALL be kept as long as the site exists. Phone numbers and email addresses fetched for reminders SHALL NOT be stored.

#### Scenario: After results
- **WHEN** results were published 60 days ago
- **THEN** the Pemilih list is still available to Admin Voting and contains no phone numbers
