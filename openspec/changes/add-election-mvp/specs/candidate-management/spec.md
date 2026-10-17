# Spec Delta

## Purpose

Lets Admin Voting set up the candidates of the election, each with a number, nickname, photo and a
free-form profile page, while keeping voters safe from anything placed on those pages.

## ADDED Requirements

### Requirement: Candidate is one member from the Pemilih list
"Tambah Kandidat" SHALL search the Pemilih list. Each candidate SHALL be exactly one member linked by `member_id`, with full name and komsat filled from the list. An Admin Voting SHALL NOT be added as a candidate.

#### Scenario: Add candidate
- **WHEN** an Admin Voting searches "Budi" and picks Budi Santoso of PPI Okayama
- **THEN** a candidate is created linked to Budi's `member_id` with name and komsat prefilled

#### Scenario: Admin Voting picked
- **WHEN** an Admin Voting picks Rina, who is Admin Voting
- **THEN** the system refuses with "Admin Voting tidak dapat menjadi kandidat"

### Requirement: Candidate fields
Each candidate SHALL have a number typed by Admin Voting (unique), a display name (editable), a nickname (unique ignoring case), a komsat, a photo, an optional YouTube link and page content.

#### Scenario: Duplicate number
- **WHEN** an Admin Voting saves a second candidate with number 1
- **THEN** the save fails with "Nomor urut 1 sudah dipakai Budi Santoso"

### Requirement: Photo cropped in the browser
The candidate photo SHALL be cropped to 3:4 in the browser from a PNG, JPEG or WebP of at most 5 MB and uploaded as an image of 600×800 pixels and at most 200 KB to R2. The server SHALL check the type from the file bytes.

#### Scenario: Large photo
- **WHEN** an Admin Voting picks a 4 MB phone photo and crops it
- **THEN** a 600×800 image under 200 KB is stored and shown on the candidate card

### Requirement: Free HTML page in a sandboxed frame
Page content SHALL be edited with CKEditor including a source view, accepting any HTML5 such as embeds and slides, with images uploaded to R2. Voter-facing pages SHALL render it inside an iframe with `sandbox="allow-scripts allow-popups"` that resizes to its content.

#### Scenario: Slides embed
- **WHEN** an Admin Voting pastes a Google Slides embed code into the source view
- **THEN** the slides show and work on the candidate page

#### Scenario: Script in candidate content
- **WHEN** candidate content contains a script that calls `/api/elections/vote`
- **THEN** the request carries no session of the viewer and cannot read or change anything on the site

### Requirement: YouTube link
An optional YouTube link SHALL be parsed to its video ID and shown as a `youtube-nocookie.com` embed above the page content. Links that are not YouTube SHALL be rejected.

#### Scenario: Watch link
- **WHEN** an Admin Voting saves `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- **THEN** the candidate page embeds `https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ`

### Requirement: Public candidate page
Each candidate SHALL have a public page at `/kandidat/<nomor>-<nickname>` showing number, photo, name, nickname, komsat, color, video and content, with a "Pilih Sekarang" button while the election is Dibuka.

#### Scenario: Candidate page during voting
- **WHEN** a visitor opens `/kandidat/01-budi` while voting is open
- **THEN** the page shows Budi's profile and a "Pilih Sekarang" button leading to Pilih Suara

### Requirement: Colors from a fixed palette
At lock time each candidate SHALL get a color drawn at random without repetition from 10 colors with at least 4.5:1 contrast against white text: `#B91C1C`, `#1D4ED8`, `#15803D`, `#C2410C`, `#7E22CE`, `#BE185D`, `#0F766E`, `#4338CA`, `#92400E`, `#155E75`. The color SHALL never change afterwards.

#### Scenario: Color stays
- **WHEN** Dasbor is reloaded several times after locking
- **THEN** each candidate shows the same color every time, always next to their number

### Requirement: Candidates editable only in Draf
Adding, editing and deleting candidates SHALL be possible only in Draf. In any later stage the API SHALL answer HTTP 409.

#### Scenario: Edit during voting
- **WHEN** an Admin Voting tries to change Budi's nickname while voting is open
- **THEN** the system answers HTTP 409 and nothing changes
