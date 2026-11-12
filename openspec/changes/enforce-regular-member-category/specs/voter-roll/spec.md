# Spec Delta: Anggota Biasa eligibility and portal member data

## ADDED Requirements

### Requirement: Category-based roll membership

The Pemilih roll SHALL hold only members the portal reports as `ACTIVE` with
`member_category` `BIASA`. A sync SHALL store `member_category` on every roll row it
writes and SHALL remove a roll row whose member the portal no longer reports as an
`ACTIVE` `BIASA` member. The sync summary and its audit detail SHALL report how many
returned `ACTIVE` members were excluded because their category is not `BIASA`.

#### Scenario: Anggota Luar Biasa is not enrolled

- **WHEN** a sync returns an `ACTIVE` member with `member_category` `LUAR_BIASA`
- **THEN** the member is absent from the roll and the summary counts one exclusion

#### Scenario: Category undetermined is not enrolled

- **WHEN** a sync returns an `ACTIVE` member with `member_category` null
- **THEN** the member is absent from the roll and the summary counts one exclusion

#### Scenario: Category change removes a roll row

- **WHEN** a member on the roll becomes `LUAR_BIASA` and the next sync returns that member
- **THEN** the row is removed from the roll and counted under `removed`

### Requirement: Frozen roll is rebuilt from the portal

Kunci & Jadwalkan SHALL read the complete in-scope member set from the Service API and
SHALL replace the roll with exactly the `ACTIVE` `BIASA` members it returns before
locking. A failed full read SHALL block locking and leave the Draf roll untouched. The
sync watermark SHALL be the `as_of` returned by the Service API, never the local clock.

#### Scenario: Rebuild drops a pre-category row

- **WHEN** a roll row predates category syncing and the portal reports the member as
  `LUAR_BIASA`
- **THEN** Kunci's rebuild leaves the member out of the frozen roll

#### Scenario: Failed full read

- **WHEN** the first page of the full read fails
- **THEN** nothing locks, the Draf roll keeps its rows and the election stays Draf

### Requirement: Roll maintenance refreshes category

Perbarui Nama dari Portal SHALL refresh the official name, card number and category of
existing roll rows for every status the portal returns, without adding or removing roll
members. The frozen roll SHALL NOT change shape after lock.

#### Scenario: Frozen roll member recategorised

- **WHEN** Admin Voting refreshes a frozen roll whose member is now `LUAR_BIASA`
- **THEN** the row stays on the frozen roll, stores `LUAR_BIASA`, and the member cannot vote

## MODIFIED Requirements

### Requirement: Pemilih page

Admin Voting SHALL see a searchable member list with the member's official name, card
number, category, unit display names from the synced unit table and sudah/belum memilih
filters with JST participation times. It SHALL show no member UUID, no raw unit path and
no one's choice, phone or email.

#### Scenario: Who has not voted

- **WHEN** an Admin Voting filters PPI Okayama and "Belum memilih"
- **THEN** only its frozen-roll members without a participation row are listed with their
  card number and "Anggota Biasa"/"Anggota Luar Biasa" category

### Requirement: Member data on every screen

Every page and admin view that shows a member SHALL show the portal's values: official
name from the roll, `member_number`, unit display name from the synced unit table and the
member category. No screen SHALL render a member UUID as text, a name fallback made from
an id, or a display name derived from a unit path when the unit is synced.

#### Scenario: Account page

- **WHEN** a signed-in member opens `/akun`
- **THEN** the card shows the official name, the card number, the unit display name and
  the category, and no member UUID

#### Scenario: Candidate added by card number

- **WHEN** an Admin Voting adds a candidate by card number
- **THEN** the candidate is created for the member behind that card number and the
  candidate list shows the card number instead of the member UUID

#### Scenario: Audit stream

- **WHEN** an Admin Voting opens Audit
- **THEN** member targets render as "Nama · Nomor kartu" and unit paths render as unit
  display names
