# Spec Delta: Server payloads omit choice counts until Diumumkan

## Purpose

The seal is a server rule, not a screen rule: the results payload never carries a choice
count before the result is announced (owner decision 2026-11-21). This supersedes "Before
Diumumkan, candidate vote counts SHALL be visible only to Admin Voting" in
`add-election-mvp` (public-site) and the "in every stage" tally wording of
`add-single-candidate-mode`.

## ADDED Requirements

### Requirement: No choice count in any payload before Diumumkan

The results payload that `/api/dashboard`, the landing page and the Hasil page read SHALL
carry `null` for every choice figure while the stage is not Diumumkan, in single candidate
mode and in multi-candidate mode, overall and per korda: Setuju, Tidak Setuju and Abstain
answers cast, the Abstain total, the candidate vote counts and every choice percentage.
The server SHALL be the only place that decides this, so no page or future client can
render a sealed figure.

#### Scenario: Seal flag in the payload

- **WHEN** any consumer reads the results payload before Diumumkan
- **THEN** `tally_sealed` is `true`, and it is `false` after Diumumkan


#### Scenario: Dashboard payload while voting is open

- **WHEN** an Admin Voting requests `/api/dashboard` in single candidate mode while voting is Dibuka
- **THEN** `tally_sealed` is true and `setuju_count`, `tidak_setuju_count`, `abstain_cast_count`, `abstain_count` and the choice percentages are null

#### Scenario: Dashboard payload in multi-candidate mode while voting is open

- **WHEN** an Admin Voting requests `/api/dashboard` in multi-candidate mode while voting is Dibuka
- **THEN** every `candidates[].votes` and every `korda[].candidates` is null while the candidate number, nickname and color stay in the payload

#### Scenario: Public results before Diumumkan

- **WHEN** anyone requests `/api/results` before Diumumkan
- **THEN** the request is refused with 409 `hasil_belum_diumumkan` and no count of any kind is in the response

#### Scenario: Public results after Diumumkan

- **WHEN** anyone requests `/api/results` after Diumumkan
- **THEN** the choice counts, percentages and permitted per-korda breakdowns are present as today

### Requirement: Participation figures stay in the payload

The payload SHALL keep Hak pilih, used, unused, turnout, participation and ballot totals,
the count check, the per-korda participation figures, the invitation term, the single
candidate mode flag, `abstain_counted`, `abstain_counted_at` and `tidak_memilih_count`
(Hak pilih minus participation) in every stage, sealed or not. It SHALL NOT add a per-voter
or per-ballot field to compensate for the sealed figures.

#### Scenario: Turnout figures while sealed

- **WHEN** an Admin Voting requests `/api/dashboard` while voting is Dibuka
- **THEN** `eligible_count`, `used_count`, `unused_count`, `turnout_percentage`, `participation_count`, `ballot_count`, `count_matches` and `tidak_memilih_count` carry their real values

#### Scenario: No identity in the payload

- **WHEN** any payload is inspected before or after Diumumkan
- **THEN** it contains no member id, ballot id, receipt hash or timestamp of a vote
