# Spec Delta: Undangan Langsung (direct invite links)

## Purpose

Admin Voting issues direct invitation links for members who have no Portal account; the
system trusts the link. Each active link is one Hak pilih, cancelled links return it, and
the person who opens a valid link votes with the same ballot, confirmation sheet, receipt
code and secrecy rules as a Pemilih.

## ADDED Requirements

### Requirement: Undangan Pemilih page and batch generation

The Admin Voting area SHALL offer an "Undangan Pemilih" page that generates direct
invitation links in batches. Any Admin Voting SHALL be able to generate links while the
election is Draf, Terjadwal or Dibuka, and generation SHALL be refused once voting has
closed or the results are Diumumkan. The batch size SHALL be between 1 and 50 links per
action and at most 500 rows per election including cancelled ones.

#### Scenario: Batch generated while Dibuka

- **WHEN** an Admin Voting requests 10 links while the election is Dibuka
- **THEN** 10 invitation rows are created with status Belum Dipakai, each counted in Hak
  pilih, and one audit entry records the batch

#### Scenario: Links generated before voting opens

- **WHEN** an Admin Voting generates links while the election is Draf or Terjadwal
- **THEN** the links are created and count in Hak pilih, and each link's page shows the
  welcome and the schedule with no ballot

#### Scenario: Generation refused after close

- **WHEN** an Admin Voting requests new links while the election is Ditutup or Diumumkan
- **THEN** the request is refused with a message that links cannot be created after voting
  closes, no row is created and nothing is recorded

#### Scenario: Batch size outside the limit refused

- **WHEN** an Admin Voting requests 0, 51, or more than the remaining allowance links
- **THEN** the request is refused with a message naming the allowed batch size and nothing
  is created

#### Scenario: Non-admin refused

- **WHEN** a link-generation request arrives without an Admin Voting session
- **THEN** the request is refused by the admin guard, no row is created and nothing is
  recorded

### Requirement: Invitation table and status

The Undangan Pemilih page SHALL list every invitation with the columns Link, Dibuat Pada,
Oleh and Status. Status SHALL be exactly Belum Dipakai, Sudah Dipakai or Dibatalkan,
derived from the row (`cancelled_at`, else `used_at`). The Link column SHALL offer a
copy-link button for every row that is not used or cancelled, and the table SHALL always
name the row by its short reference.

#### Scenario: Statuses shown

- **WHEN** an Admin Voting opens the page and the election has a fresh, a used and a
  cancelled invitation
- **THEN** the three rows show Belum Dipakai, Sudah Dipakai and Dibatalkan with their
  creation time and the Admin Voting who created them

#### Scenario: Any active link can be copied again

- **WHEN** an Admin Voting opens the page in any later session and copies a row that is
  Belum Dipakai
- **THEN** the row's full link is returned to the Admin Voting session and copied

#### Scenario: Used and cancelled rows have no link

- **WHEN** an Admin Voting looks at a Sudah Dipakai or Dibatalkan row
- **THEN** the row shows its short reference and no link, and no endpoint returns that
  link

#### Scenario: List view is audit-logged

- **WHEN** an Admin Voting opens the list
- **THEN** one audit entry records the action with the stage and the row count, and no
  link or code appears in it

### Requirement: Status filter, reference search and Excel export

The page SHALL filter the loaded list by status (Semua status, Belum Dipakai, Sudah
Dipakai, Dibatalkan) and by a case-insensitive text search on the reference, and SHALL
build an `.xlsx` download in the browser from the rows matching the current filter. The
server SHALL only return the JSON list; it SHALL never build, stream or store the file.
The columns SHALL be Link, Referensi, Dibuat Pada, Oleh, Status, and for used rows Dipakai
Pada, Nama, Email and Korda/Komsat.

#### Scenario: Filter narrows the table

- **WHEN** an Admin Voting selects Belum Dipakai and types part of a reference
- **THEN** only the rows matching both the status and the reference search are shown

#### Scenario: Export follows the filter

- **WHEN** an Admin Voting clicks "Unduh Excel" with a filter active
- **THEN** the browser builds an `.xlsx` containing only the matching rows, with the
  listed columns, and no file is requested from the server

#### Scenario: Export never includes a hidden link

- **WHEN** a used or cancelled row is exported
- **THEN** its Link cell is empty because the server never returned a link for it

### Requirement: Token stored encrypted, with the hash kept for lookup

Each invitation SHALL store the SHA-256 of the canonical token for lookup and the token
sealed with `APP_MASTER_KEY` for retrieval, plus a short non-secret reference that names
the row. Admin Voting SHALL be able to read the full link again at any time before the link
is used or cancelled. The decrypted link SHALL never be written to the audit log, to logs,
or to any server-side file, and it SHALL not be returned once the row is used or cancelled.

#### Scenario: Link readable again before use

- **WHEN** an Admin Voting requests the list while a link is Belum Dipakai
- **THEN** the response contains that link's full URL and the row is named by its
  reference

#### Scenario: Lookup still goes through the hash

- **WHEN** a link URL is opened
- **THEN** the server resolves it by hashing the normalized code and comparing the hash,
  and the sealed token is only decrypted to re-show the link to an Admin Voting session

#### Scenario: No link in the log

- **WHEN** links are generated, listed, copied, exported or cancelled
- **THEN** no audit entry, server log or response outside an Admin Voting session contains
  a link or its code

### Requirement: Cancelling an unused link

An Admin Voting SHALL be able to cancel an invitation that is Belum Dipakai while the
election has not closed; cancellation SHALL set Dibatalkan, remove that link's one Hak
pilih, and append one audit entry. An invitation that is Sudah Dipakai SHALL be refused,
and cancellation SHALL be refused once voting has closed or the results are Diumumkan.

#### Scenario: Unused link cancelled

- **WHEN** an Admin Voting cancels a Belum Dipakai link before voting closes
- **THEN** the row shows Dibatalkan, Hak pilih drops by one, and one audit entry records
  the cancellation with the row reference

#### Scenario: Used link refused

- **WHEN** an Admin Voting tries to cancel a Sudah Dipakai link
- **THEN** the request is refused with a message that a used link cannot be cancelled and
  the row stays Sudah Dipakai

#### Scenario: Cancellation refused after close

- **WHEN** an Admin Voting tries to cancel a Belum Dipakai link while the election is
  Ditutup or Diumumkan
- **THEN** the request is refused and the row and Hak pilih stay unchanged

### Requirement: Opening a link before, during and after voting

Opening a link SHALL show the welcome page "Selamat datang di Pemilihan Umum" with "Lihat
profil kandidat" and "Pilih", and the stage SHALL decide whether a ballot is reachable:
no ballot before voting opens, the claim form and ballot while it is open, and a closed
message after it closes or the results are Diumumkan. A used or cancelled link SHALL show
its own message instead.

#### Scenario: Link opened before voting opens

- **WHEN** a person opens a valid link while the election is Draf or Terjadwal
- **THEN** the welcome page and the schedule are shown and no ballot can be reached

#### Scenario: Link opened while voting is open

- **WHEN** a person opens a valid link while the election is Dibuka
- **THEN** the welcome page offers "Lihat profil kandidat" and "Pilih", and "Pilih" leads
  to the claim form

#### Scenario: Link opened after voting closes

- **WHEN** a person opens a valid, unused link while the election is Ditutup or Diumumkan
- **THEN** a message states that voting has closed or the results are announced, and no
  ballot can be reached

#### Scenario: Used link opened again

- **WHEN** a person opens a link that is Sudah Dipakai
- **THEN** a message states that one link only admits one person and no ballot can be
  reached

#### Scenario: Cancelled link opened

- **WHEN** a person opens a link that is Dibatalkan
- **THEN** a message states that the committee cancelled the link and no ballot can be
  reached

#### Scenario: Page left open across the deadline cannot vote

- **WHEN** a person has the ballot open and submits it after voting has closed
- **THEN** the vote is refused as outside the open stage and nothing is recorded

### Requirement: Claim form asks for Nama, Email and Korda/Komsat

The "Pilih" step SHALL ask for Nama, Email and Korda/Komsat before the ballot.
Korda/Komsat SHALL be a single choice from the synced `units` rows of type korda or komsat
inside the scope, shown with the Portal names and no free text; the form SHALL not submit
while that list is empty. The values SHALL be stored on the invitation row, never on the
ballot, and the chosen path SHALL become the ballot's `komsat_path`.

#### Scenario: Valid claim

- **WHEN** a person fills Nama, Email and a Korda/Komsat and continues while voting is open
- **THEN** the invitation row stores the guest details and the chosen path, a sealed
  short-lived session is set, and the ballot opens

#### Scenario: Unit list empty

- **WHEN** the `units` table has no korda or komsat row inside the scope yet
- **THEN** the form cannot be submitted and the page explains that the unit list is not
  available yet

#### Scenario: Guest details never on the ballot

- **WHEN** an invite vote is cast
- **THEN** the ballot row holds only the candidate, the chosen komsat path, the receipt
  hash and the optional choice, and the Nama and Email exist only on the invitation row

### Requirement: Claimed links are reserved for 30 minutes

While a claimed-but-unused link has a live reservation (30 minutes from its last claim),
the person holding it SHALL be able to continue, and a different claim on the same link
SHALL be refused with a message that the link is being filled by someone else. The
reservation SHALL lapse by the clock alone and SHALL never bypass the one-use rule: the
vote batch is what consumes the link.

#### Scenario: Second claimer refused while reserved

- **WHEN** a second person submits the claim form on a link that another person claimed
  less than 30 minutes ago and has not used
- **THEN** the claim is refused with a message that the link is being filled by someone
  else, and the existing reservation is unchanged

#### Scenario: Reservation lapses by itself

- **WHEN** the claim holder abandons the link and 30 minutes pass
- **THEN** a new claim on the link succeeds without any background job, and only the vote
  itself marks the link Sudah Dipakai

### Requirement: Invitee ballot is the same ballot as a Pemilih

While voting is open, a person who has claimed a link SHALL vote with the same ballot,
confirmation sheet and receipt code as a logged-in Pemilih, including single candidate mode
with its Setuju, Tidak Setuju and Abstain answers. The server SHALL enforce the same
nickname confirmation, the same choice rules, the same one ballot per person and the same
ballot secrecy, and the receipt SHALL be verifiable through the existing receipt board
flow.

#### Scenario: Multi-candidate invite vote

- **WHEN** an invitee confirms the candidate's nickname and submits the ballot
- **THEN** one participation row and one ballot are written in one batch and a one-time
  receipt code is shown

#### Scenario: Single candidate mode invite vote

- **WHEN** single candidate mode is on and an invitee chooses Setuju, Tidak Setuju or
  Abstain
- **THEN** the vote is stored with that choice and counted exactly like a Pemilih's answer

#### Scenario: Wrong confirmation refused

- **WHEN** an invitee submits a ballot whose confirmation text is not the candidate's
  nickname
- **THEN** the vote is refused and nothing is written

#### Scenario: Receipt verifies after close

- **WHEN** the election closes and the invitee checks the receipt code
- **THEN** the code verifies against the board exactly like a Pemilih's receipt

### Requirement: One use per link under concurrency

A link SHALL admit exactly one vote. The one-use mark, the participation row, the ballot
and the audit entry SHALL be written in one guarded D1 batch, so a double tap or two
devices produce exactly one vote. A second attempt with a used link SHALL be refused and
SHALL record nothing.

#### Scenario: Double submission yields one vote

- **WHEN** the same link is submitted twice concurrently
- **THEN** exactly one participation row and one ballot exist, the link is Sudah Dipakai
  once, and the other request is refused

#### Scenario: Used link cannot vote again

- **WHEN** a claim session is replayed after the link already voted
- **THEN** the vote is refused with a message that the link is used, and Hak pilih,
  participation and ballots are unchanged

### Requirement: Rate limits on link opening, claiming and voting

Link resolution, claiming and invite voting SHALL be rate limited through the D1
`rate_limits` table, with limits per link code hash and per invitation row, plus a global
ceiling on link resolution. No client IP address SHALL be stored as a rate-limit key.

#### Scenario: Code guessing is throttled

- **WHEN** a client resolves many different link codes in a short time
- **THEN** the global resolution ceiling returns a rate-limit refusal and no code is
  resolved

#### Scenario: Repeated claim submissions throttled

- **WHEN** a client submits the claim form repeatedly for the same link
- **THEN** the requests beyond the claim limit are refused with a rate-limit message
