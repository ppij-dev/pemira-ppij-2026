# Spec Delta: Vote-time category check

## MODIFIED Requirements

### Requirement: Eligibility at the moment of voting

A person SHALL be eligible to vote if and only if, when the vote is submitted: their
`member_id` is on the frozen Pemilih roll with stored status `ACTIVE` and stored category
`BIASA`, and their session comes from a valid One Login sign-in whose `affiliation` claim
lies inside the site's scope. A roll row whose stored category is null SHALL be treated as
undetermined and SHALL NOT vote until the portal determines the category and the roll is
refreshed. Neither the frozen roll alone nor the session alone SHALL grant a vote.

#### Scenario: Member on the roll with a valid session

- **WHEN** Budi is on the frozen roll as `ACTIVE` `BIASA`, signs in and submits a confirmed vote while voting is open
- **THEN** the vote is accepted

#### Scenario: Anggota Luar Biasa on the roll

- **WHEN** Rio is on the frozen roll and his stored category is `LUAR_BIASA`
- **THEN** the vote is refused with "Hanya Anggota Biasa yang berhak memilih pada pemilihan ini." and `not_regular_member`

#### Scenario: Category undetermined

- **WHEN** Dewi is on the frozen roll and the portal has not determined her category
- **THEN** the vote is refused with the category-undetermined message and `category_unknown`, and she is told to contact the committee

#### Scenario: Member joins after lock

- **WHEN** Dewi becomes `ACTIVE` after Kunci and signs in
- **THEN** she cannot vote and sees an explanation that the roll was frozen
