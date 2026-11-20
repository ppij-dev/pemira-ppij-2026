# Spec Delta: Campaign portal section on the candidate profile page

## ADDED Requirements

### Requirement: Embedded campaign portal section

The public candidate profile page `/kandidat/<slug>` SHALL show a "Portal kampanye"
section when the candidate's `campaign_url` is set, and SHALL NOT render the section at
all when it is empty. The section SHALL embed the address in an iframe with
`sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`,
`referrerpolicy="no-referrer"`, `loading="lazy"` and a title naming the candidate, and the
iframe SHALL NOT carry `allow-same-origin` or `allow-top-navigation`.

#### Scenario: Section with a set address

- **WHEN** a visitor opens the profile of a candidate whose campaign URL is `https://ereksoforppi.netlify.app/`
- **THEN** the page shows the "Portal kampanye" heading and an iframe whose `src` is that address

#### Scenario: Sandbox attributes are exact

- **WHEN** the profile markup is inspected
- **THEN** the iframe carries `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`,
  `referrerpolicy="no-referrer"`, `loading="lazy"` and a title, and nowhere on the page does
  `allow-same-origin` or `allow-top-navigation` appear

#### Scenario: No address, no section

- **WHEN** a visitor opens the profile of a candidate without a campaign URL
- **THEN** the page renders no "Portal kampanye" heading and no iframe

### Requirement: Fallback link and attribution note

The section SHALL show, outside the iframe, a link "Buka di tab baru" to the same address
with `target="_blank"` and `rel="noopener noreferrer"`, at least 44 px tall, plus a note
stating that the content is prepared by the candidate's team and not by panitia. The
section SHALL keep working when the framed site refuses framing or fails to load, and
SHALL NOT add a script that retries, hides or replaces the frame.

#### Scenario: Site refuses framing

- **WHEN** the candidate's site sends `X-Frame-Options: DENY`
- **THEN** the profile still shows the note and a working "Buka di tab baru" link

#### Scenario: Attribution is visible

- **WHEN** the section is shown on any viewport
- **THEN** a note says the content belongs to the candidate's team, not to panitia

### Requirement: Tall responsive height on a phone

The embedded frame SHALL use a responsive height that is tall on a 390 px phone and on a
desktop, without JavaScript and without horizontal overflow.

#### Scenario: 390 px phone

- **WHEN** the profile is opened on a 390 px wide phone
- **THEN** the iframe fills the panel width, is at least 500 px tall, and the page does not scroll sideways

### Requirement: Campaign embed on the invitation-mode profile only

The profile page opened from an invitation link (`/kandidat/<slug>?undangan=<kode>`) SHALL
show the same "Portal kampanye" section. The ballot, the confirmation sheet and the
invitation welcome page SHALL NOT embed the campaign URL; the welcome page SHALL link to
the profile view instead.

#### Scenario: Invitation profile view

- **WHEN** an invitee opens the profile from `/undangan/<kode>`
- **THEN** the page shows the "Portal kampanye" section and still offers the way back to the invitation

#### Scenario: Voting flow stays clean

- **WHEN** the ballot, the confirmation sheet or the invitation welcome page is opened
- **THEN** none of them renders the campaign iframe, and the welcome page links to the profile view

### Requirement: Framing headers

The application SHALL NOT deny framing of the candidate profile page through
`X-Frame-Options` or a CSP `frame-ancestors` directive, and any future
`Content-Security-Policy` SHALL allow `frame-src https:` so this section keeps working.

#### Scenario: No restrictive header today

- **WHEN** the profile page is served
- **THEN** the response carries no `X-Frame-Options` and no CSP that would block the embedded campaign page
