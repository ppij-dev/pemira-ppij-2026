# Spec Delta: Public invitation link pages

## Purpose

The pages a direct invitation link opens: a welcome page that follows the election stage,
a claim step and the invitee ballot, all under the same public rules (noindex, no emoji,
Bahasa Indonesia).

## ADDED Requirements

### Requirement: Invitation welcome page follows the stage

A direct invitation link SHALL open the welcome page "Selamat datang di Pemilihan Umum"
with "Lihat profil kandidat" and "Pilih". While the election is Draf or Terjadwal the page
SHALL show the schedule and no ballot; while Dibuka it SHALL lead to the claim form and
ballot; once Ditutup or Diumumkan it SHALL state that voting has closed or the results are
announced and SHALL offer no ballot.

#### Scenario: Before voting opens

- **WHEN** a person opens a valid link before voting opens
- **THEN** the welcome page shows the schedule or that no schedule is set yet, and no
  ballot is offered

#### Scenario: During voting

- **WHEN** a person opens a valid link while voting is open
- **THEN** the page offers "Lihat profil kandidat" and "Pilih", and "Pilih" leads to the
  claim form and then the ballot

#### Scenario: After voting closes

- **WHEN** a person opens a valid link while the election is Ditutup or Diumumkan
- **THEN** the page states that voting has closed or the results are announced and offers
  no ballot

### Requirement: Used, cancelled and unknown links show clear messages

A used link SHALL state that one link only admits one person. A cancelled link SHALL state
that the committee cancelled it. An unknown code SHALL show the ordinary not-found page
with no hint that invitation links exist, and no page SHALL list or expose link codes.

#### Scenario: Used link

- **WHEN** a person opens a link that is already Sudah Dipakai
- **THEN** the page explains that the link has been used and cannot admit another person

#### Scenario: Cancelled link

- **WHEN** a person opens a link that is Dibatalkan
- **THEN** the page explains that panitia cancelled the link

#### Scenario: Unknown code

- **WHEN** a person opens a code that does not match any invitation
- **THEN** the ordinary not-found page is shown with no difference that reveals whether
  invitation links exist

### Requirement: Invitation pages stay unindexed

Every invitation page SHALL carry the site's noindex behaviour and SHALL NOT be linked from
public navigation, because a link is a credential.

#### Scenario: Crawler visits an invitation page

- **WHEN** a crawler requests an invitation page
- **THEN** the response carries the noindex headers as every other public page does
