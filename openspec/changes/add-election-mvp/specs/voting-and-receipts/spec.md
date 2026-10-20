# Spec Delta

## Purpose

Lets an eligible member cast one secret ballot from their phone, confirm it by typing the candidate's
nickname, and later prove that their ballot is in the ballot box without revealing their choice.

## ADDED Requirements

### Requirement: Mobile-first voter layout
Voter screens SHALL be mobile-first with a fixed bottom navigation of Kandidat, Pilih Suara and Bukti Suara (plus Hasil once results are published), Tabler icons only, times in JST and numbers in Indonesian format.

#### Scenario: Voter on a phone
- **WHEN** a signed-in voter opens the site on a phone during voting
- **THEN** the bottom navigation shows Kandidat, Pilih Suara and Bukti Suara with Tabler icons

### Requirement: Mode Pemilih for Admin Voting
Admin pages SHALL have a "Mode Pemilih" button that switches to the voter screens, and voter screens SHALL show "Mode Admin" to an Admin Voting.

#### Scenario: Admin Voting votes
- **WHEN** Rina presses "Mode Pemilih" while the setting allows Admin Voting to vote
- **THEN** she sees the voter navigation and can vote under the same rules as any member

### Requirement: Confirm by typing the nickname
After a voter picks a candidate, a confirmation sheet SHALL require typing that candidate's nickname, compared ignoring case and surrounding spaces, before "Kirim Suara" is enabled. The server SHALL repeat the check and answer HTTP 400 on a mismatch.

#### Scenario: Correct confirmation
- **WHEN** a voter picks 01 Budi Santoso and types " budi "
- **THEN** "Kirim Suara" is enabled and the server accepts the confirmation

#### Scenario: Mismatch sent directly
- **WHEN** a request to the vote API carries `confirmation_text` "Sari" for candidate Budi
- **THEN** the server answers HTTP 400 and records nothing

### Requirement: One atomic ballot per member
A valid vote SHALL write, in one D1 batch, a participation row (`member_id`, name, `voted_at`) unique per member and a ballot row (random ID, candidate, voter's komsat path, receipt hash) with no member reference and no timestamp. The ballots table SHALL use `WITHOUT ROWID`.

#### Scenario: First vote
- **WHEN** an eligible voter who has not voted submits a confirmed vote while voting is open
- **THEN** both rows are written together and the voter receives a receipt code

#### Scenario: Second vote or double tap
- **WHEN** the same member submits again, including two requests at the same moment
- **THEN** the unique constraint rejects the batch, no ballot is added, and the server answers HTTP 409 leading to Bukti Suara

#### Scenario: No link from voter to ballot
- **WHEN** someone with full database access compares participation and ballots
- **THEN** no column, ordering or timestamp in ballots connects a ballot to a member

### Requirement: Receipt code
Each ballot SHALL get a random 128-bit receipt encoded as 26 Crockford Base32 characters.
The UI MAY group the characters for readability; normalization SHALL remove separators
and ignore letter case before hashing. Only SHA-256 of the canonical code SHALL be stored.
The code SHALL be shown once on the success screen with "Salin" and "Buka Bukti Suara"
and kept in this browser's local storage. No outgoing receipt email is sent in 1.0.

#### Scenario: After voting
- **WHEN** Budi's vote is recorded
- **THEN** he can copy the 26-character code and open the proof page without the code reaching a request path

### Requirement: Receipt page keeps the code out of the URL sent to the server
`/surat-suara#<code>` SHALL normalize and hash the code in the browser, send only
the hash to the server, and show whether that ballot exists, never the candidate chosen.

#### Scenario: Valid receipt
- **WHEN** Budi opens a valid code in the fragment
- **THEN** the page confirms his ballot is in the box without revealing his choice

#### Scenario: Unknown code
- **WHEN** a code that matches no ballot is checked
- **THEN** the page says it was not found and suggests checking typing

### Requirement: Bukti Suara tab
The Bukti Suara tab SHALL show when the voter voted (from participation), the code if
stored on this device, and a field to check any code. The server SHALL NOT return a
voter's raw code or promise an email copy in 1.0.

#### Scenario: Different device
- **WHEN** Budi opens Bukti Suara on a new phone
- **THEN** he sees when he voted and a field to enter his saved code, but no code is returned

### Requirement: Public receipt-hash board after close
From Ditutup onward, a public page SHALL list every ballot's receipt hash in random
ballot-ID order without candidates, with participation/ballot counts and the fixed
closing audit snapshot hash. A browser SHALL hash a code locally to highlight its
matching entry. Raw receipt codes SHALL never be published or stored.

#### Scenario: Voter checks the board
- **WHEN** Budi enters his code after close
- **THEN** its hash is highlighted locally, totals are shown, and no code is sent to the server

### Requirement: Rate limits on voting and receipt checks
Vote requests SHALL be limited to 5 per minute per session and receipt checks to 30 per minute per IP, answering HTTP 429 beyond that.

#### Scenario: Guessing receipt codes
- **WHEN** a script checks 31 codes within a minute
- **THEN** the 31st request answers HTTP 429

### Requirement: Ballot choices never logged
Logs, audit entries and error reports SHALL never contain the candidate a voter chose or a receipt code.

#### Scenario: Vote audit entry
- **WHEN** Budi votes
- **THEN** the audit entry reads "Budi Santoso memilih" with time and nothing about the candidate or code
