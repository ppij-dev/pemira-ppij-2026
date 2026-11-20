# Spec Delta: Campaign portal URL on candidates

## ADDED Requirements

### Requirement: Optional campaign portal URL

A candidate SHALL have one optional `campaign_url` column, empty by default, holding an
absolute `https://` address of the candidate team's campaign page. An empty value SHALL
mean "no portal" and SHALL NOT fall back to any other field.

#### Scenario: Existing candidate without a portal

- **WHEN** the migration is applied to a database whose candidates have no campaign page
- **THEN** every candidate reads `campaign_url` as empty and its profile page is unchanged

#### Scenario: Portal address stored

- **WHEN** an Admin Voting saves `https://ereksoforppi.netlify.app/` for a candidate
- **THEN** the candidate stores exactly that address and the list and profile read it back

### Requirement: https-only campaign URL validation

The server SHALL accept a campaign URL only when it is a string of at most 300 characters,
contains no whitespace or control characters, starts with `https://`, parses as an absolute
URL with a host, and carries no user name or password. It SHALL refuse `http://`,
`javascript:`, `data:`, `mailto:`, protocol-relative, host-less and oversized values with
HTTP 400 and a Bahasa Indonesia message that names the accepted shape, and SHALL write
nothing when it refuses.

#### Scenario: Plain http is refused

- **WHEN** a candidate save carries `http://ereksoforppi.netlify.app/`
- **THEN** the request answers 400, the message names `https://`, and no candidate row changes

#### Scenario: Script and data schemes are refused

- **WHEN** a candidate save carries `javascript:alert(1)` or `data:text/html,<h1>x</h1>`
- **THEN** both are refused with 400 and nothing is stored

#### Scenario: Credentials in the URL are refused

- **WHEN** a save carries `https://user:secret@example.org/kampanye`
- **THEN** it is refused with 400 and the message says the link may not carry a user name or password

#### Scenario: Oversized and whitespace values are refused

- **WHEN** a save carries an `https://` address longer than 300 characters or one containing a space
- **THEN** it is refused with 400 and the stored value is unchanged

#### Scenario: Validation happens on the server

- **WHEN** a client posts a campaign URL with the browser-side checks bypassed
- **THEN** the API still applies every rule above before writing

### Requirement: Campaign URL edited only in Draf

Admin Voting SHALL set or change a candidate's campaign URL in the candidate form only
while the election is Draf; a create or update in any later stage SHALL be refused with
HTTP 409 and SHALL leave the stored value unchanged. The value SHALL be frozen at Kunci &
Jadwalkan together with the other candidate fields.

#### Scenario: Edit while locked

- **WHEN** an Admin Voting changes a campaign URL after Kunci & Jadwalkan
- **THEN** the request answers 409 and the profile still shows the frozen address

#### Scenario: Clear before Kunci

- **WHEN** an Admin Voting empties the field in Draf
- **THEN** the stored value becomes empty and the profile section disappears

### Requirement: Campaign URL in the audit log

Each candidate create or update that carries a campaign URL SHALL append the normal
hash-chained audit entry, and its `detail_json` SHALL hold `{"campaign_url": "<url>"}`
(`null` when the URL was cleared). A write that does not change the URL SHALL NOT add a
detail and SHALL NOT add an extra entry.

#### Scenario: URL change is audited

- **WHEN** an Admin Voting sets a campaign URL on an existing candidate
- **THEN** exactly one `Kandidat diperbarui` entry is appended with the URL in its detail

#### Scenario: Unrelated edit keeps the detail empty

- **WHEN** an Admin Voting changes only the candidate's name
- **THEN** one `Kandidat diperbarui` entry is appended with an empty detail
