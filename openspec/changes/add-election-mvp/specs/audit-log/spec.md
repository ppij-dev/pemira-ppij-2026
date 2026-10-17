# Spec Delta

## Purpose

Records what Admin Voting, voters and the system do on the site in a log that cannot be edited through
the app and shows tampering, and lets Admin Voting search and export it.

## ADDED Requirements

### Requirement: What is recorded
The audit log SHALL record Admin Voting actions (settings, candidates, stage changes, syncs, invitations, removals, reminders, tally views, exports), voter actions (sign-in, eligibility refused, voted, receipt checked) and system actions (Uji Coba deletion, schedule transitions), with time, actor, action, target and changes, and without IP address or device.

#### Scenario: Settings change
- **WHEN** Rina switches the email provider from Resend to ZeptoMail
- **THEN** an entry reads "Rina Putri mengubah Email: penyedia Resend → ZeptoMail" with no key values

### Requirement: Append-only with a hash chain
Entries SHALL only be added. Each entry SHALL store the SHA-256 hash of the previous entry together with its own content, so that any edit or deletion in D1 breaks the chain from that point.

#### Scenario: Row deleted in D1
- **WHEN** someone deletes an audit row directly in D1
- **THEN** the chain check reports the first entry after the gap as broken

### Requirement: Audit page
The Audit page SHALL be read-only for Admin Voting and SHALL filter by name, actor type (Admin Voting, Pemilih, Sistem), action type, komsat and JST date range, keep filters in the URL, load more on request, and expand entries to show before and after values with secrets masked.

#### Scenario: Shared filter link
- **WHEN** Rina filters "Jenis: Pengaturan" for 1–7 Dec and sends the URL to Dimas
- **THEN** Dimas sees the same filtered entries

### Requirement: Chain check on the page
Opening the Audit page SHALL verify the chain and show "Rantai log utuh" with the time, or in red the first broken entry.

#### Scenario: Intact log
- **WHEN** no entry was changed outside the app
- **THEN** the page shows "Rantai log utuh (diperiksa 14.05 JST)"

### Requirement: CSV export built in the browser
"Ekspor CSV" SHALL page through the filtered audit API at 500 entries per request and build the CSV in the browser, starting with a UTF-8 byte order mark. Starting an export SHALL be audit-logged with the filters and row count.

#### Scenario: Export
- **WHEN** Rina exports entries filtered to Pengaturan with 42 rows
- **THEN** she downloads a CSV with 42 rows that opens correctly in Excel, and the log gains "Rina Putri mengekspor CSV Audit (Jenis: Pengaturan, 42 baris)"

### Requirement: Final chain hash published
When voting closes, the hash of the last audit entry SHALL be fixed and shown on the public receipt board.

#### Scenario: Board after close
- **WHEN** a visitor opens the board after close
- **THEN** it shows the final audit hash, which matches the hash on the Audit page at closing time
