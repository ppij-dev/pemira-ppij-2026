# Spec Delta: Vote-time voting-rights check

## MODIFIED Requirements

### Requirement: Eligibility at the moment of voting

A person SHALL be eligible to vote if and only if, when the vote is submitted: their
`member_id` is on the frozen Pemilih roll with stored status `ACTIVE` and stored
`can_vote` `1` (the portal's decision, stored at sync time), and their session comes from
a valid One Login sign-in whose `affiliation` claim lies inside the site's scope. Pemira
SHALL NOT re-derive voting rights from `member_category`; the category is display data.
A roll row whose stored `can_vote` is null SHALL be treated as undecided and SHALL NOT
vote until the portal decides and the roll is refreshed. Neither the frozen roll alone nor
the session alone SHALL grant a vote.

#### Scenario: Member on the roll with a valid session

- **WHEN** Budi is on the frozen roll with `can_vote` 1, signs in and submits a confirmed vote while voting is open
- **THEN** the vote is accepted

#### Scenario: Portal says no

- **WHEN** Rio is on the frozen roll with `can_vote` 0
- **THEN** the vote is refused with "Hanya Anggota Biasa yang berhak memilih pada pemilihan ini." and `not_regular_member`

#### Scenario: Portal has not decided

- **WHEN** Dewi is on the frozen roll with `can_vote` null
- **THEN** the vote is refused with "Kategori keanggotaan Anda belum ditentukan portal PPIJ. Hubungi panitia pemilihan." and `category_unknown`

#### Scenario: Category disagrees with the flag

- **WHEN** a roll row carries `can_vote` 1 while its stored category label says Anggota Luar Biasa
- **THEN** the vote is accepted, because the portal's `can_vote` is the decision and the category is display only

#### Scenario: Member joins after lock

- **WHEN** Dewi becomes `ACTIVE` after Kunci and signs in
- **THEN** she cannot vote and sees an explanation that the roll was frozen
