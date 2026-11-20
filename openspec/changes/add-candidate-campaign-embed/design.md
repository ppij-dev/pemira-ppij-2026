# Design: Portal kampanye kandidat (embedded campaign page)

## Context

Candidates are structured fields (`candidates`: `number`, `name`, `nickname`,
`komsat_path`, `description`, `short_intro`, `color`, `photo_key`) maintained by Admin
Voting in `/admin/kandidat` through `POST/PUT /api/election/candidates`
(`src/server/election/candidates.ts`). Every write goes through `draft(db)`, which refuses
anything but `status_lock = 'draft'`, so Kunci & Jadwalkan freezes candidates. Each write
also appends one hash-chained `audit_log` entry (`buildAuditInsert`) with
`target = <candidate id>` and, today, a `null` detail.

The public profile is `src/pages/kandidat/[slug].astro`, resolved by
`resolveCandidateProfile` (`src/server/election/profile.ts`, `PROFILE_COLUMNS`). The same
page serves the invitation flow (`?undangan=<kode>`), and the invitation welcome page
(`src/pages/undangan/[kode].astro`) renders candidate cards that link to it. Hard rule 8
restricts candidate content to structured fields; the owner's decision of 2026-11-20 makes
the campaign embed an explicit exception.

The app ships no `Content-Security-Policy` and no `X-Frame-Options`: `src/middleware.ts`
only redirects unauthenticated admin pages, `src/fetch.ts` mounts the Hono app, and the
only header middleware (`src/server/middleware/noindex.ts`) sets `X-Robots-Tag`. There is
no `public/_headers` file. Nothing therefore has to be widened for a frame today; this
design records the constraint for the day a CSP is added.

## Goals / Non-goals

- **Goal:** one optional `https://` campaign address per candidate, set by Admin Voting
  only in Draf, frozen at Kunci, shown on the public profile as an embedded page with a
  always-available fallback link.
- **Goal:** the embed is inert with respect to our origin — it can run its own scripts but
  cannot read our DOM, cookies, storage or navigation.
- **Non-goal:** storing, sanitising, mirroring or proxying the campaign page. We store an
  address and the browser fetches the page from its own origin.
- **Non-goal:** any change to the ballot, the confirmation sheet, the receipt, the
  invitation welcome page or the 1.1 rich-media deferrals (upload, editor, photo/video).

## Decisions

### D1: One nullable column, migration `0018_candidate_campaign_url.sql`

```sql
ALTER TABLE candidates ADD COLUMN campaign_url TEXT;
```

Nullable with no default, so every existing row keeps `NULL` and nothing is backfilled.
No `CHECK` constraint beyond the length bound: a URL's shape is enforced in one place (the
server validator, D2) so the error message can explain itself, and a stale constraint
cannot reject a value the API would accept.

Players: `candidates.campaign_url` is a *presentation* pointer. It is never read by the
ballot, the tally, the receipt board, eligibility or the results queries.

### D2: `https`-only, server-side, one validator

`normalizeCampaignUrl(value)` in `src/server/election/candidates.ts`:

1. Not a string → `400` "Portal kampanye harus berupa tautan." (an omitted field is not
   an error: `undefined` keeps the stored value, `""`/`null` clears it).
2. Trim; empty → `null`.
3. Longer than `CAMPAIGN_URL_MAX_CHARS = 300` → `400` naming the limit.
4. Contains whitespace or control characters → `400`.
5. Must match `^https://` (case-insensitive) → otherwise `400` "Portal kampanye harus
   diawali https://" naming `http://`, `javascript:` and `data:` as refused.
6. Must parse with `new URL()`; a host is required, and `username`/`password` must be
   empty → `400` "Tautan tidak boleh memuat nama pengguna atau kata sandi."
7. Return `url.toString()` (canonical absolute form).

The rules are applied on create and on update; the value is stored exactly as the
canonical string, so the profile page and the audit entry cannot disagree.

### D3: Draf only, frozen at Kunci, audited with the URL

`createCandidate` and `updateCandidate` already call `draft(db)` first, which is the whole
freeze rule; `campaign_url` therefore needs no separate guard. The audit detail carries
the address because the URL is a published, non-secret pointer and panitia needs to see
which campaign page was attached to which candidate:

- create with a URL → `Kandidat ditambahkan`, detail `{"campaign_url": "..."}`
- update whose URL changed (including to empty, `{"campaign_url": null}`) →
  `Kandidat diperbarui`, detail `{"campaign_url": "..."}`
- any other write keeps `detail_json = null`, exactly as today.

The audit entry never contains candidate content, only the URL.

### D4: The profile section and its exact attributes

Rendered in `src/pages/kandidat/[slug].astro` only when `campaign_url` is a non-empty
string, as a normal article section (not inside the Markdown article):

```html
<section aria-labelledby="campaign-heading">
  <h2 id="campaign-heading">Portal kampanye</h2>
  <p>Konten di bawah ini disiapkan oleh tim kandidat, bukan oleh panitia pemilihan.</p>
  <iframe src="{campaign_url}"
          title="Portal kampanye {nickname}"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerpolicy="no-referrer"
          loading="lazy"
          class="h-[clamp(520px,78dvh,900px)] w-full ..."></iframe>
  <p>Jika halaman tidak tampil, buka di tab baru.</p>
  <a href="{campaign_url}" target="_blank" rel="noopener noreferrer">Buka di tab baru</a>
</section>
```

- `allow-scripts` lets the campaign site run at all; `allow-popups` and
  `allow-popups-to-escape-sandbox` let its own links open normally.
- **Never** `allow-same-origin`: without it the frame is an opaque origin, so it cannot
  reach our cookies, storage, DOM or session. **Never** `allow-top-navigation`: the frame
  cannot move our tab. `referrerpolicy="no-referrer"` keeps the invitation/undangan URL out
  of the candidate's logs.
- Height `clamp(520px, 78dvh, 900px)` gives roughly 660 px on a 390×844 phone, is tall on
  a desktop without becoming a 2000 px column, and needs no JavaScript.
- The note and the fallback link sit outside the frame, so a site that refuses framing
  (`X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`) or fails to load still leaves the
  voter a working link. No client script is added: nothing retries, nothing hides.
- The invitation-mode profile (`?undangan=<kode>`) is the same page and shows the same
  section; the invitation welcome page does not, it keeps linking to the profile.

### D5: Headers

No `Content-Security-Policy`, no `X-Frame-Options` and no `frame-ancestors` exist in this
app (verified in `src/middleware.ts`, `src/fetch.ts`,
`src/server/middleware/noindex.ts`, and there is no `public/_headers`), so the frame is
allowed as is. If a CSP is introduced later, `frame-src` must allow `https:` for this
section — a `'self'`-only policy would silently kill the feature. That constraint is
recorded in `AGENTS.md` next to rule 8.

### D6: Copy (Bahasa Indonesia, no emoji)

- Section heading: **"Portal kampanye"**.
- Note: "Konten di bawah ini disiapkan oleh tim kandidat, bukan oleh panitia pemilihan."
- Link: **"Buka di tab baru"**, with "Jika halaman tidak tampil, buka di tab baru." above
  it; the iframe title is "Portal kampanye <nama panggilan>".
- Admin field label: **"Portal kampanye (opsional)"**, help "Tautan https:// halaman
  kampanye kandidat. Tampil tersemat di halaman profil kandidat."
- Validation messages: "Portal kampanye harus diawali https://, misalnya
  https://contoh.id/kampanye."; "Portal kampanye terlalu panjang. Maksimal 300 karakter.";
  "Portal kampanye tidak boleh memuat spasi."; "Tautan tidak boleh memuat nama pengguna
  atau kata sandi."

## Risks / Trade-offs

- **We publish a link we do not control.** The candidate's team can change the page after
  Kunci. The field is frozen (D3) but its target's content is not; the attribution note
  and the absence of `allow-same-origin` bound what that page can do to a voter, and it is
  never shown inside the voting flow.
- **A framed page can be heavy** (the example is 1.8 MB). `loading="lazy"` means it loads
  only when the voter scrolls to the section, and the iframe cannot block the profile
  itself. That is why the invitation welcome page links instead of embedding.
- **Some sites refuse framing.** Accepted: the fallback link is the primary path for those
  candidates, and the note tells the voter to use it.

## Migration plan

`0018_candidate_campaign_url.sql` is one additive `ALTER TABLE ... ADD COLUMN`. Existing
elections start with `campaign_url = NULL`, so no public page changes until panitia sets a
value. Rollback is dropping the column (SQLite requires a table rebuild) or simply leaving
it `NULL`; either way the profile renders exactly as today.
