# Spec Delta: Vote-time eligibility against the live portal view

## Purpose

While "Tidak Membekukan DPT" is on and voting is open, the vote-time eligibility check
reads the live portal view instead of a frozen roll, in both directions: newly eligible
members can vote, members who lost eligibility cannot. Ballot secrecy, receipts, the
confirmation sheet, one-vote-per-member, rate limits and the eligibility rules themselves
(ACTIVE Anggota Biasa only, Admin Voting participation setting, scope, session rules) are
unchanged.

## ADDED Requirements

### Requirement: Live eligibility at vote time

While the switch is on, the stage is Dibuka and preview mode is off, vote authorization
SHALL refresh the live portal view as needed and then check the member against it, instead
of refusing for an unfrozen roll. The refusal rules SHALL be the existing ones read from
the view row, and the Admin Voting participation setting, affiliation-in-scope check and
session rules SHALL apply unchanged.

#### Scenario: Newly registered eligible member can vote

- **WHEN** a member who is on the portal but was never on any frozen roll signs in while voting is open in live mode and the view has refreshed
- **THEN** the member can vote once, with the same confirmation sheet, receipt and secrecy as any voter

#### Scenario: Member who lost eligibility can no longer vote

- **WHEN** a member on the live view becomes INACTIVE or loses `can_vote` on the portal and then tries to vote after the view has refreshed
- **THEN** the vote is refused with the existing membership or voting-rights message and nothing is recorded

#### Scenario: Rules unchanged

- **WHEN** a member outside the site scope, a non-regular member, or an Admin Voting when participation is disabled tries to vote in live mode
- **THEN** each is refused exactly as in a frozen-roll election

### Requirement: Frozen and preview flows unchanged

With the switch off, or while preview mode is on, vote authorization SHALL behave exactly
as today: the frozen-roll refusals stand, and the preview rehearsal flow keeps its
auto-registration even when the switch is also on. The live check SHALL govern only real
votes in non-preview elections.

#### Scenario: Preview mode keeps its flow

- **WHEN** preview mode is on, the rehearsal auto-registration and test-vote flow run as today even if the switch is also on
- **THEN** the live check governs only real votes in non-preview elections

#### Scenario: Switch off unchanged

- **WHEN** an election with the switch off is open and a member not on the frozen roll tries to vote
- **THEN** the refusal is today's frozen-roll refusal and no refresh runs

### Requirement: After a mid-vote freeze eligibility is the frozen roll

Once the roll is frozen mid-vote by turning the switch off (owner decision 2026-11-22),
vote authorization SHALL behave exactly as in a Kunci-frozen election: the member SHALL
be checked against the frozen roll with no portal refresh, and a member who joined the
portal after the freeze SHALL be refused. Votes already cast stay; secrecy, receipts,
confirmation, one-vote-per-member and rate limits are unchanged.

#### Scenario: Member added after the freeze cannot vote

- **WHEN** the roll is frozen mid-vote, an eligible member registers on the portal afterwards, and then tries to vote
- **THEN** the vote is refused with the existing not-on-the-roll message, no refresh runs, and a member who was on the roll at the freeze can still vote once as usual
