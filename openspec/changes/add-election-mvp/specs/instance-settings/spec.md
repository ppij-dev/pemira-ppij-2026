# Spec Delta

## Purpose

Lets Admin Voting change everything set during setup, brand the site and its emails for their chapter,
and send the few personal emails the election needs, without exposing stored secrets.

## ADDED Requirements

### Requirement: Pengaturan sections
Pengaturan SHALL have the sections Identitas, Pemilihan, One Login, Cakupan, Domain, Email and Data Pemilih, available to every Admin Voting.

#### Scenario: Open settings
- **WHEN** an Admin Voting opens Pengaturan
- **THEN** all seven sections are listed and editable within their stage rules

### Requirement: Secrets never shown again
Client secrets, API keys and SMTP passwords SHALL be stored encrypted and, after saving, shown only as `••••••••` with a "Ganti" action.

#### Scenario: Viewing email settings
- **WHEN** an Admin Voting opens the Email section after setup
- **THEN** the API key field shows `••••••••` and "Ganti", never the key

### Requirement: Stage rules for settings
Cakupan and the setting "Admin Voting boleh ikut memilih" SHALL be editable only in Draf. During Dibuka, saving One Login or Domain SHALL require a successful "Uji Koneksi" and SHALL show "Pemilih bisa gagal masuk jika ini salah".

#### Scenario: Scope change after lock
- **WHEN** an Admin Voting tries to change Cakupan in stage Terjadwal
- **THEN** the field is read-only with "Cakupan dikunci sejak pemilihan dikunci"

### Requirement: Domain change shows the callback
Before switching to a custom domain, the Domain section SHALL show the new callback URL with "Kontak PPIJ Portal admin untuk mendaftarkan URL ini" and SHALL save only after "Uji Koneksi" signs in successfully through the new URL.

#### Scenario: Switch to own domain
- **WHEN** an Admin Voting enters `https://pemilu.ppiokayama.jp`
- **THEN** the page shows `https://pemilu.ppiokayama.jp/api/auth/callback` to register before saving

### Requirement: Logo upload and crop
Identitas SHALL accept a PNG or JPEG logo of at least 256×256 pixels and at most 2 MB, crop it square in the browser, and upload two versions: 192×192 PNG of at most 40 KB for email and 512×512 PNG of at most 150 KB for the site and favicon.

#### Scenario: Okayama logo
- **WHEN** an Admin Voting uploads a 688×720 PNG logo and crops it
- **THEN** both versions are stored within their size limits and the preview updates

#### Scenario: Too small
- **WHEN** an Admin Voting uploads a 120×120 logo
- **THEN** the upload is refused with "Logo persegi, minimal 256×256 px, PNG atau JPG, maks. 2 MB"

### Requirement: Identity fields
Identitas SHALL hold the chapter name, the checkbox "Logo sudah memuat nama chapter" and the organisation website URL used as the link in the email footer.

#### Scenario: Website in footer
- **WHEN** the organisation website is `https://ppiokayama.jp`
- **THEN** email footers read "PPI Okayama · ppiokayama.jp" linking to that URL

### Requirement: Live email preview
Identitas SHALL show a live preview of the email layout that updates as the logo, name or website change, and a "Kirim Email Tes" button that sends the preview to the Admin Voting's own email.

#### Scenario: Preview after crop
- **WHEN** an Admin Voting changes the crop of the logo
- **THEN** the preview shows the new logo at 64 px without saving

### Requirement: Email delivery providers
The Email section SHALL support HTTP email APIs (ZeptoMail, Resend, Mailgun) and SMTP over TLS on port 465 or 587, with sender name and address, and SHALL mark email as configured only after a test email is sent.

#### Scenario: Provider test
- **WHEN** an Admin Voting saves Resend credentials and the test email is accepted
- **THEN** email is marked configured and invitations, receipts and reminders start sending

### Requirement: Four email templates only
The system SHALL send only four emails, each to one person in Bahasa Indonesia: Tes Email, Undangan Admin Voting, Bukti Suara and Pengingat. Each SHALL use one simple layout (logo, election title, content, footer) of about 20 KB at most, with no tracking pixel, and SHALL never be sent in bulk.

#### Scenario: Bukti Suara email
- **WHEN** Budi votes and email is configured
- **THEN** he receives one email with the logo, "Pemilu Raya PPI Okayama 2026", his receipt code, a "Cek Bukti Suara" button and the chapter footer
