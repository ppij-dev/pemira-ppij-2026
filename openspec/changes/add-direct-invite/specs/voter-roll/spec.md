# Spec Delta: Hak pilih with direct invitation links

## Purpose

Hak pilih becomes two terms: the Pemilih roll frozen at Kunci & Jadwalkan, plus every
direct invitation link that has not been cancelled. The frozen column keeps its old meaning
and is never rewritten with links.

## ADDED Requirements

### Requirement: Hak pilih includes active direct invitation links

Hak pilih SHALL be the frozen Pemilih roll plus every direct invitation row that is not
cancelled, counted from the moment the link is generated; a used link keeps its one and a
cancelled link stops counting. `frozen_hak_pilih` SHALL keep the roll term only, so a Kunci
& Jadwalkan after links exist cannot count a link twice, and the Draf roll count SHALL gain
the same term. The `allow_admin_voting` exclusion SHALL apply to the roll term only.

#### Scenario: Link generated while Draf increases Hak pilih

- **WHEN** an Admin Voting generates 5 links while the election is Draf with a roll of 100
- **THEN** Hak pilih is 105, and the frozen roll of the later Kunci & Jadwalkan is still
  the roll term (105 = frozen 100 + 5 links)

#### Scenario: Link generated after Kunci increases Hak pilih

- **WHEN** 5 more links are generated after Kunci & Jadwalkan froze Hak pilih at 100
- **THEN** Hak pilih is 110 and no write touches `frozen_hak_pilih`

#### Scenario: Used link keeps its one

- **WHEN** a link is used to vote
- **THEN** Hak pilih does not change and the link is not counted twice

#### Scenario: Cancelled link removes its one

- **WHEN** an unused link is cancelled
- **THEN** Hak pilih drops by exactly one

### Requirement: Invite voters are not Pemilih roll rows

An invite voter SHALL NOT be added to the `voters` table or to the Daftar Pemilih, SHALL
NOT need a One Login sign-in, and SHALL NOT be part of the frozen roll. Their one-vote
guarantee SHALL come from the invitation row and a reserved participation identity, not
from the roll.

#### Scenario: Invite voter absent from the roll

- **WHEN** an invitee votes
- **THEN** no `voters` row is created for them, the frozen roll and its count are
  unchanged, and Daftar Pemilih does not list them

#### Scenario: Roll sync does not touch links

- **WHEN** a Pemilih roll sync or the final sync at Kunci & Jadwalkan runs
- **THEN** direct invitation rows are not read, written or deleted

### Requirement: Links are not counted twice across a re-lock

A Kunci & Jadwalkan SHALL recompute only the roll term. Direct invitation rows SHALL
survive a "Kembali ke Draf" and the next Kunci untouched, and SHALL keep counting once
each.

#### Scenario: Re-lock after a return to Draf

- **WHEN** an election with 5 active links is returned to Draf, given 2 more links, and
  locked again with a fresh roll
- **THEN** the frozen roll reflects only the fresh roll and Hak pilih is frozen roll + 7
  links, each link counted exactly once
