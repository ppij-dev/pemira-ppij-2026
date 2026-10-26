# Spec Delta: Candidate photos, short intro, Markdown profiles, length limits

## ADDED Requirements

### Requirement: Candidate portrait photos

A candidate MAY have a `photo_key`: an operator-managed same-origin path to a
static asset under `public/`. Listing cards and the profile SHALL render the
photo (3:4) and fall back to the shared placeholder when absent. The profile
SHALL label a missing photo honestly and offer a zoom lightbox for real photos.

#### Scenario: Photo rendering and fallback

- **WHEN** a candidate has a valid `photo_key` and another has none
- **THEN** the first renders its photo with a zoom control and the second
  renders the placeholder with a "photo not available" caption

### Requirement: Short intro

Candidates MAY carry a `short_intro` of at most 100 characters shown only on
listing cards; an empty value shows no intro and never falls back to the
article body.

#### Scenario: Length validation

- **WHEN** an admin submits a short intro over 100 characters
- **THEN** the API rejects it with a clear Indonesian error

### Requirement: Markdown profiles

The candidate `description` SHALL be rendered as Markdown through an
escape-first renderer (headings, emphasis, lists, quotes, rules, safe links).
A YouTube URL on its own line SHALL render as a click-to-load facade with a
sandboxed `youtube-nocookie` iframe on play and a new-tab fallback link; raw
HTML SHALL never execute; links to non-HTTPS non-same-origin schemes SHALL be
neutralized.

#### Scenario: Injected HTML is inert

- **WHEN** a description contains raw `<script>` or event-handler markup
- **THEN** the rendered profile escapes it as text

#### Scenario: Video facade

- **WHEN** a description contains a YouTube watch URL on its own line
- **THEN** the page renders a thumbnail facade that injects the sandboxed
  player only on user activation, plus a new-tab fallback link

### Requirement: Name length limits

Candidate `name` SHALL be at most 60 characters and `nickname` at most 24
characters (whitespace-collapsed, counted in code points); the API SHALL
reject longer values with a clear Indonesian error and the admin form SHALL
enforce the same limits.

#### Scenario: Over-long name rejected

- **WHEN** an admin submits a candidate with a 70-character name
- **THEN** the API rejects the change and the draft election is unchanged
