# Spec Delta

## Purpose

Gives each election a promotional landing page that members reach through shared links, shows results
once published, and keeps every page of the site out of search engines.

## ADDED Requirements

### Requirement: Landing page sections
The landing page SHALL show, in order: a hero with the chapter logo and name, election title and tagline; one card per candidate (number, photo, nickname, color) linking to the candidate page; a countdown; and a call-to-action button.

#### Scenario: Before voting opens
- **WHEN** a visitor opens the landing page while the election is Terjadwal
- **THEN** they see the hero, candidate cards and a countdown to the opening time

### Requirement: Call-to-action follows the voter's state
The button SHALL read "Pilih Sekarang" (to Pilih Suara) while voting is open, "Lihat Bukti Suara" for a signed-in member who already voted, and SHALL be hidden after voting closes.

#### Scenario: Already voted
- **WHEN** Budi, who already voted, opens the landing page while voting is open
- **THEN** the button reads "Lihat Bukti Suara"

### Requirement: Extension notice
When the closing time was extended, the landing page SHALL show "Diperpanjang hingga <waktu JST>" with the new countdown.

#### Scenario: Extended voting
- **WHEN** closing moved from 20.00 to 22.00 JST
- **THEN** the countdown targets 22.00 JST and the notice is shown

### Requirement: Results after publication
Once Diumumkan, the countdown SHALL be replaced by the results: tally chart, regional map with leading colors (with the small-region rule), and statistics (hak pilih, digunakan, partisipasi). Voters SHALL get a Hasil tab with the same view. Before Diumumkan no tally SHALL be visible to anyone but Admin Voting.

#### Scenario: Results published
- **WHEN** an Admin Voting publishes results
- **THEN** the landing page and the Hasil tab show the tally, map and statistics

#### Scenario: Closed but not published
- **WHEN** voting has closed and results are not yet published
- **THEN** the landing page says "Pemungutan suara sudah ditutup. Hasil akan diumumkan panitia." and shows no numbers per candidate

### Requirement: Hidden from search engines
Every response SHALL carry `X-Robots-Tag: noindex, nofollow`, every HTML page SHALL include `<meta name="robots" content="noindex, nofollow">`, `/robots.txt` SHALL disallow all paths, and no sitemap SHALL exist.

#### Scenario: Crawler visits
- **WHEN** a search crawler requests `/robots.txt` and `/surat-suara`
- **THEN** robots.txt answers `User-agent: *` and `Disallow: /`, and the page carries the noindex header

### Requirement: Branding on public pages
Public pages SHALL use the chapter logo and name from Identitas, defaulting to the round PPI Jepang logo and "PPI Jepang", and SHALL hide the name text when "Logo sudah memuat nama chapter" is set. The logo SHALL also be the favicon.

#### Scenario: Logo with name inside
- **WHEN** PPI Okayama uploaded its logo with the lettering "ppiokayama" and ticked the checkbox
- **THEN** the hero shows only the logo, without a repeated "PPI Okayama" text
