# Spec Delta: Roll membership from the portal's voting rights

## ADDED Requirements

### Requirement: Roll membership follows the portal's can_vote

The Pemilih roll SHALL hold only members the portal marks `can_vote: true`. A sync SHALL
store the portal's `can_vote` (`1` true, `0` false, null = not decided) and
`member_category` on every roll row it writes, and SHALL remove a roll row whose member
the portal no longer marks `can_vote: true`. Pemira SHALL NOT re-derive voting rights from
`status` and `member_category`; the category is display data only. The sync summary and its
audit detail SHALL report how many returned `ACTIVE` members were excluded because the
portal does not mark them `can_vote: true`.

#### Scenario: Portal refuses an active member

- **WHEN** a sync returns an `ACTIVE` member with `can_vote` false
- **THEN** the member is absent from the roll and the summary counts one exclusion

#### Scenario: Portal has not decided

- **WHEN** a sync returns an `ACTIVE` member with `member_category` null and `can_vote` null
- **THEN** the member is absent from the roll and the summary counts one exclusion

#### Scenario: Portal withdraws voting rights

- **WHEN** a member on the roll becomes `can_vote` false and the next sync returns that member
- **THEN** the row is removed from the roll and counted under `removed`

### Requirement: Frozen roll is rebuilt from the portal

Kunci & Jadwalkan SHALL read the complete in-scope member set from the Service API and
SHALL replace the roll with exactly the members the portal marks `can_vote: true` before
locking. A failed full read SHALL block locking and leave the Draf roll untouched. The
sync watermark SHALL be the `as_of` returned by the Service API, never the local clock.

#### Scenario: Rebuild drops a pre-can_vote row

- **WHEN** a roll row predates the voting-rights field and the portal marks the member
  `can_vote` false
- **THEN** Kunci's rebuild leaves the member out of the frozen roll

#### Scenario: Failed full read

- **WHEN** the first page of the full read fails
- **THEN** nothing locks, the Draf roll keeps its rows and the election stays Draf

### Requirement: Roll maintenance refreshes category and voting rights

Perbarui Nama & Kategori dari Portal SHALL refresh the official name, card number,
category and `can_vote` of existing roll rows for every status the portal returns,
without adding or removing roll members. The frozen roll SHALL NOT change shape after
lock.

#### Scenario: Frozen roll member loses voting rights

- **WHEN** Admin Voting refreshes a frozen roll whose member is now `can_vote` false
- **THEN** the row stays on the frozen roll, stores `can_vote` 0, and the member cannot vote

## MODIFIED Requirements

### Requirement: Candidate reference

An Admin Voting SHALL add or move a candidate by the member's card number
(`member_number`), which the portal owns. In preview mode only, a roll row that has no
card number SHALL also be referenceable by `member_id`, because preview voters are
registered from One Login claims and never synced with the portal. Outside preview mode a
`member_id` reference SHALL be refused with one identical message whether or not the
member exists, so membership is never confirmed by an internal id. An update that sends no
reference SHALL keep the member recorded on the candidate without requiring a card number.

#### Scenario: Card number outside preview

- **WHEN** an Admin Voting adds a candidate with card number `OKA-2026-0001`
- **THEN** the candidate is created for the member behind that card number

#### Scenario: Member id outside preview

- **WHEN** an Admin Voting submits a `member_id` while preview mode is off
- **THEN** the request is refused and the message asks for the card number

#### Scenario: Member id in preview without a card number

- **WHEN** preview mode is on and an Admin Voting submits the `member_id` of a roll row
  that has no card number
- **THEN** the candidate is created for that member

#### Scenario: Member id in preview for a carded row

- **WHEN** preview mode is on and the submitted `member_id` belongs to a roll row that has
  a card number
- **THEN** the request is refused and the message asks for the card number

### Requirement: Pemilih page

Admin Voting SHALL see a searchable member list with the member's official name, card
number, the portal's category and voting-rights state, unit display names from the synced
unit table and sudah/belum memilih filters with JST participation times. It SHALL show no
member UUID, no raw unit path and no one's choice, phone or email, and it SHALL name the
fix when the portal has not decided a member's voting rights.

#### Scenario: Who has not voted

- **WHEN** an Admin Voting filters PPI Okayama and "Belum memilih"
- **THEN** only its frozen-roll members without a participation row are listed with their
  card number and category

#### Scenario: Undecided voting rights

- **WHEN** roll rows exist whose `can_vote` the portal has not set
- **THEN** the page counts them, shows an amber "Belum ditentukan" chip on those rows and
  tells Admin Voting to have Admin Portal set the category and to refresh from the portal

### Requirement: Member data on every screen

Every page and admin view that shows a member SHALL show the portal's values: official
name from the roll, `member_number`, unit display name from the synced unit table and the
member category. No screen SHALL render a member UUID as text, a name fallback made from
an id, or a display name derived from a unit path when the unit is synced.

#### Scenario: Account page

- **WHEN** a signed-in member opens `/akun`
- **THEN** the card shows the official name, the card number, the unit display name and
  the category, and no member UUID

#### Scenario: Audit stream

- **WHEN** an Admin Voting opens Audit
- **THEN** member targets render as "Nama · Nomor kartu" and unit paths render as unit
  display names
