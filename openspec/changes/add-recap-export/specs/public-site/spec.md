# Spec Delta: The public site stays sealed until Diumumkan

## Purpose

The recap lifts the seal for Admin Voting only (owner decisions Q232–Q234,
2026-11-22). This clarifies the public-site delta of `seal-tally-until-published`: the
public payload, pages and export surface do not change.

## ADDED Requirements

### Requirement: The public seal ignores the recap

`/api/results` SHALL keep answering 409 `hasil_belum_diumumkan` before Diumumkan even
after the recap is done, and `/hasil` and the landing page SHALL keep rendering without
choice counts until Diumumkan. No public page or endpoint SHALL expose the recap
payload, its tabs, or any part of the Excel content (ballot hashes with choices, the
Abstain list, per-korda or per-komsat figures) before Diumumkan.

#### Scenario: Recap done, result not announced

- **WHEN** the recap has run and a visitor requests `/api/results` or opens `/hasil` or the landing page
- **THEN** no choice count is returned or rendered, and the turnout strip keeps showing counts only

#### Scenario: After Diumumkan everything appears as before

- **WHEN** the result is announced after a recap
- **THEN** `/api/results`, `/hasil` and the landing page show the counts, percentages and per-korda breakdowns exactly as they did before this change
