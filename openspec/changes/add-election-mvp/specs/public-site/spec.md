# Spec Delta

## Purpose

Gives each election a promotional landing page that members reach through shared links, shows results
once published, and keeps every page of the site out of search engines.

## ADDED Requirements

### Requirement: Landing page sections
The landing page SHALL show the configured chapter logo and name, election title, structured
candidate cards (number, nickname, assigned color, local placeholder image), countdown and
a state-aware call to action. The layout SHALL be mobile-first with templui patterns and
Tabler icons.

#### Scenario: Before voting opens
- **WHEN** a visitor opens the landing page while Terjadwal
- **THEN** they see candidate cards, countdown and local branding

### Requirement: Preview mode notice
When `preview_mode = 1`, Beranda SHALL show a warning between the timer panel and
candidate list: "Mode uji coba aktif" and "Semua pilihan hanya untuk tes."
The notice SHALL be absent when preview mode is disabled.

#### Scenario: Preview mode active
- **WHEN** a visitor opens Beranda while preview mode is enabled
- **THEN** the warning is visible after the timer panel and before the candidates

#### Scenario: Preview mode disabled
- **WHEN** a visitor opens Beranda while preview mode is disabled
- **THEN** the preview warning is not rendered

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
Once Diumumkan, the landing page and Hasil tab SHALL show the overall candidate tally,
the korda-level table with rows under ten ballots suppressed, and turnout statistics.
Before Diumumkan, candidate vote counts SHALL be visible only to Admin Voting.

#### Scenario: Results published
- **WHEN** an Admin Voting publishes results
- **THEN** the landing page and Hasil tab show the overall tally, permitted korda rows and statistics

#### Scenario: Closed but not published
- **WHEN** voting is closed but results have not been published
- **THEN** the landing page says "Pemungutan suara sudah ditutup. Hasil akan diumumkan panitia." without candidate counts

### Requirement: Hidden from search engines
Every response SHALL carry `X-Robots-Tag: noindex, nofollow`, every HTML page SHALL include `<meta name="robots" content="noindex, nofollow">`, `/robots.txt` SHALL disallow all paths, and no sitemap SHALL exist.

#### Scenario: Crawler visits
- **WHEN** a search crawler requests `/robots.txt` and `/surat-suara`
- **THEN** robots.txt answers `User-agent: *` and `Disallow: /`, and the page carries the noindex header

### Requirement: Static branding on public pages
Public pages SHALL use the operator-configured chapter name and local logo asset, defaulting
to bundled PPI Jepang branding. The logo SHALL be the favicon. No browser logo upload is
required in 1.0.

#### Scenario: Configured chapter
- **WHEN** the operator configures PPI Okayama and its local logo
- **THEN** the hero, header and favicon use that branding without fetching a remote placeholder
