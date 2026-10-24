# Spec Delta

## Purpose
Lets Admin Voting maintain basic candidates and gives voters a safe, structured public
sample page without a rich editor or uploaded media in 1.0.

## ADDED Requirements

### Requirement: Candidate from the Pemilih list
Each candidate SHALL be exactly one member selected from the Pemilih list by `member_id`,
with their name and komsat copied from the roll. An Admin Voting SHALL NOT be a candidate.

#### Scenario: Admin Voting selected
- **WHEN** an Admin Voting attempts to add Rina, who is on the committee
- **THEN** the request fails with "Admin Voting tidak dapat menjadi kandidat"

### Requirement: Basic candidate fields
Admin Voting SHALL set a unique positive number, a display name, a nickname unique ignoring
case, and a plain-text description. A candidate SHALL have no arbitrary HTML field in the
1.0 public rendering. At most ten candidates SHALL be locked so each can receive a distinct
color from the fixed ten-color white-text-safe palette.

Admin Voting MAY set a separate plain-text `short_intro` of at most 100 characters.
This field SHALL be shown only on candidate cards on Beranda and the Kandidat list;
the full candidate profile SHALL continue to use the description. Empty introductions
SHALL remain empty rather than falling back to an article excerpt. Candidate portrait
slots SHALL fill the card width and keep a 3:4 aspect ratio. The candidate number SHALL
appear in a separate horizontal strip directly below the photo, with the same width as
the photo. Candidate details and the short introduction SHALL appear below that strip.
Cards SHALL use one column on phones and two columns from 640px. Cards SHALL use the existing PPIJ semantic
border, radius, typography and color tokens.

#### Scenario: Separate card introduction
- **WHEN** an Admin Voting saves a short introduction and a different description in Draf
- **THEN** candidate cards show the introduction and the profile shows the description
- **AND** an introduction longer than 100 characters is rejected with HTTP 400

#### Scenario: Duplicate nickname
- **WHEN** two candidates are saved with nicknames "Budi" and "budi"
- **THEN** the second save is refused without changing either candidate

#### Scenario: Too many candidates
- **WHEN** eleven candidates are present at Kunci & Jadwalkan
- **THEN** the election is not locked and the page explains the ten-candidate limit

### Requirement: Structured public sample page
Each candidate SHALL have a public page at `/kandidat/<nomor>-<nickname>` showing their
number, name, nickname, komsat, escaped plain-text description, assigned color and a
bundled local placeholder image. It SHALL link to Pilih Suara only while voting is Dibuka.
The image SHALL not be fetched from `placehold.co` by a visitor.

#### Scenario: Candidate page during voting
- **WHEN** a visitor opens `/kandidat/01-budi` while voting is open
- **THEN** the page shows Budi's fields and a "Pilih Sekarang" link

#### Scenario: Description contains markup
- **WHEN** a description contains `<script>alert(1)</script>`
- **THEN** the page displays it as text and no script executes

### Requirement: Edit lock
Candidates SHALL be added, changed or deleted only in Draf. In later stages the API
SHALL refuse edits with HTTP 409.

#### Scenario: Edit during voting
- **WHEN** an Admin Voting changes a nickname while voting is open
- **THEN** the request answers 409 and the candidate remains unchanged
