# Design: Undangan Langsung (direct invite links)

## Context

One election per site (`elections`); stages are computed from the clock on every request
(`src/server/lib/stage.ts`): Draf, then after Kunci & Jadwalkan Terjadwal, Dibuka, Ditutup,
and after "Publikasikan" Diumumkan. Eligibility today is one door only: a `voters` row on
the roll frozen at Kunci (`frozen_hak_pilih`, `frozen_at`) plus a One Login sign-in at most
10 minutes old whose `affiliation` lies inside `SITE_SCOPE`. A PPIJ member without a Portal
account therefore cannot vote at all.

Ballots are secret: `participation` (who, when; `PRIMARY KEY(election_id, member_id)`) and
`ballots` (random id, candidate, komsat path, receipt hash, optional Setuju/Tidak
Setuju/Abstain `choice`, `WITHOUT ROWID`, no timestamp) are written in one D1 batch with
nothing linking them. `castVote` (`src/server/voting/vote.ts`) does that with three
`INSERT ... SELECT ... WHERE changes() = 1` statements guarded by the audit tip, retried up
to three times. Receipt codes are 128-bit Crockford Base32 (current 16 chars, legacy 26),
stored only as SHA-256 (`src/server/voting/receipt.ts`). Rate limits live in the D1
`rate_limits` table (`key`, `count`, `reset_at`), consumed with an atomic UPSERT. Sessions
are sealed cookies encrypted with `APP_MASTER_KEY` (`src/server/auth/session.ts`). Every
accepted Admin Voting action appends one hash-chained `audit_log` entry; the admin module
`src/server/admin/routes.ts` is the only place with the `requireAdmin` guard, and the
existing `invitations` table there holds **Admin Voting invitations** (invite a person to
become a committee member) — a different feature that must never be confused with this one.

`units` (synced from the Portal) holds `path`, `name`, `parent_path`, `type` in
(`national`, `korda`, `komsat`); `regionKey` maps a komsat path to its korda prefix for
results. Single candidate mode adds Setuju/Tidak Setuju/Abstain answers and the manual
"Hitung Abstain" action: `abstain_counted_count` is frozen once as
Hak pilih − participation and cannot be repeated; Umumkan is refused until it has run.

Owner decisions (2026-11-19) are fixed: the system **trusts the link**; Admin Voting
generates batches of links until voting closes; each link adds one Hak pilih; an unused
link is a non-voter (Abstain once Hitung Abstain runs) and can be cancelled to remove its
+1; the invitee gets the same ballot, confirmation sheet, receipt code and secrecy rules as
a Pemilih; the guest's Nama, Email and Komsat live on the invitation row and never on the
ballot; only a hash of the token is stored; panitia checks duplicates by hand and the
system performs no automatic duplicate check against Hak pilih. Bahasa Indonesia copy
without emoji.

## Goals / Non-goals

- **Goal:** a person without a Portal account votes through a committee-issued link, with
  exactly the ballot, confirmation, receipt, one-use and secrecy guarantees a logged-in
  Pemilih gets, and their vote counts in Hak pilih, participation and the per-korda rows.
- **Goal:** the ledger stays honest — every link is visible in one table with a status,
  generation and cancellation are audit-logged, and nothing moves after voting closes.
- **Non-goal:** automatic deduplication against the roll or against other links (owner
  decision: panitia checks by hand).
- **Non-goal:** verifying that the person who opens the link is the person panitia meant;
  the link is a bearer credential, which is the whole point of the feature.
- **Non-goal:** sending links by email in 1.0 (no outgoing email) and any polling,
  WebSocket or background job.

## Decisions

### D1: A new `direct_invitations` table, named so it cannot be confused

Migration `0015_direct_invitations.sql` adds:

```sql
CREATE TABLE direct_invitations (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,      -- short non-secret display code (6 Crockford chars)
  token_hash TEXT NOT NULL UNIQUE,     -- SHA-256 of the canonical link code
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,            -- Admin Voting member_id
  created_by_name TEXT NOT NULL,
  claimed_at TEXT,                     -- last claim start (reservation)
  claim_id TEXT,                       -- random id of the claim that holds the link
  guest_name TEXT,                     -- filled at claim, never on the ballot
  guest_email TEXT,                    -- filled at claim, never on the ballot
  komsat_path TEXT,                    -- chosen unit path, never on participation
  used_at TEXT,                        -- set once, in the vote batch
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancelled_by_name TEXT
);
CREATE INDEX idx_direct_invitations_status ON direct_invitations(used_at, cancelled_at);
```

Names are deliberately different from the Admin Voting `invitations`
(`token_hash`/`member_id`/`expires_at`/`accepted_at`) so the two can never be mixed up in
code review or SQL. The Admin Voting table is not touched. The status shown in the UI is
derived, never stored: `Dibatalkan` when `cancelled_at IS NOT NULL`, else `Sudah Dipakai`
when `used_at IS NOT NULL`, else `Belum Dipakai`.

### D2: The link code is shown once; only its hash is stored

The code is 128 random bits (16 bytes) encoded as 26 Crockford Base32 characters, grouped
for display — the same alphabet, normalization and SHA-256 storage as legacy receipt codes,
reusing `encodeReceipt`/`normalizeReceiptCode`/`hashReceipt` from
`src/server/voting/receipt.ts`. The URL is `/undangan/<26 chars>`. The table stores
`token_hash = SHA-256(normalized code)` and a separate 6-character `reference` drawn from
the same alphabet, which is **not** the credential and only names the row.

**Decided: show once.** Generation returns the full links in the HTTP response; the admin
page renders them in a result panel with a "Salin semua" button and a copy button per row
and warns that they cannot be shown again. While the same browser tab still holds the
codes (sessionStorage, never sent to the server) the table row keeps its copy button; once
that is gone the row shows the reference and a "Buat ulang" action (cancel, then generate).
**Alternative rejected:** keep the token retrievable, sealed with `APP_MASTER_KEY`, so the
table can always show the link. That is a second, always-on route to a live credential: an
attacker with the database *and* the key (the same key that protects session cookies) could
harvest every unused link. The owner's copy button is satisfied by the show-once panel plus
the tab-scoped convenience copy, so the stricter rule wins.

### D3: Hak pilih = frozen roll + live active links

`frozen_hak_pilih` keeps meaning exactly what it means today: the roll term, frozen at
Kunci, **never** containing links. The links are always a second, live term:

```
hak_pilih_efektif = (frozen_hak_pilih ?? roll_count_in_draf) + COUNT(direct_invitations
                     WHERE cancelled_at IS NULL)
```

- Every generated link adds 1 immediately, whether it was generated before or after Kunci.
  A link generated in Draf is *not* baked into the frozen number, so the next Kunci (which
  recomputes only the roll term) cannot count it twice.
- A used link keeps its +1: its voter exists (there is a participation row and a ballot).
- Cancelling an unused link removes its +1; a used link cannot be cancelled (D6).
- The Draf fallback (`eligibleFallbackRow`) also gains the link term.
- `allow_admin_voting = 0` removes Admin Voting roll members from the roll term only; a
  link is issued by panitia for a person who by construction can vote, so links are never
  subtracted there.

Every consumer of the denominator (results payload, Dasbor statistics, Hitung Abstain
pending count, participant shares) reads the same effective number from one helper, so the
pages cannot drift apart.

### D4: An invite participation row with a reserved member id

An invite vote writes a normal `participation` row with `member_id = 'undangan:<reference>'`
and `member_name` = the guest's Nama, plus `is_test = 0`. Nothing about `participation`
changes (no new column), the existing `PRIMARY KEY(election_id, member_id)` becomes the
second line of defense against double voting, and the guest identity itself stays on the
invitation row (`guest_name`, `guest_email`, `komsat_path`). The `undangan:` prefix can
never collide with a Portal member id.

The ballot stays exactly as it is today: random id, `candidate_id`, `komsat_path` = the
chosen Komsat, receipt hash, optional `choice`, no member id, no timestamp, written in the
same batch with nothing linking it to the participation row. Per-korda results therefore
count the invitee in the komsat they chose (D9) without ever joining a ballot to a person.

### D5: One use, safe under concurrency

The claim step (D7) only reserves; the vote is what consumes. `castVoteInvite` mirrors
`castVote`'s single guarded batch, with the invitation row as the consumed resource:

1. `INSERT INTO participation (...) SELECT ... FROM direct_invitations WHERE id = ? AND
   used_at IS NULL AND cancelled_at IS NULL AND <open stage guard>` — the invitation must
   still be unused and the election must be open at that instant.
2. `UPDATE direct_invitations SET used_at = ? WHERE id = ? AND used_at IS NULL AND
   changes() = 1` — marks the link used only if statement 1 inserted.
3. `INSERT INTO ballots (...) SELECT ... FROM participation WHERE ... AND changes() = 1`.
4. `INSERT INTO audit_log (...) SELECT ... WHERE ... AND changes() = 1`, with the audit tip
   guard and up to three retries, exactly like `castVote`.

D1 runs a batch as one serialized transaction, so two taps on two devices cannot both
insert: the loser sees zero changes on statement 1 and gets a 409 "Tautan sudah dipakai."
The code path reuses `generateReceipt`, the choice rules (`isVoteChoice`, single candidate
mode) and the confirmation-text check from the Pemilih vote path, so an invite vote cannot
drift from a normal one.

### D6: Generation and cancellation, only before voting closes

Any Admin Voting may generate and cancel — all rights are equal, as everywhere else. Both
actions are refused once the election is Ditutup (by clock or "Tutup Sekarang") or
Diumumkan, and the refusal is the load-bearing rule that keeps the ledger frozen: after
close no link can appear or disappear, so `abstain_counted_count` (frozen once at Hitung
Abstain) and the closing snapshot can never be invalidated by a later generate or cancel.
Before close the window is the whole of Draf, Terjadwal and Dibuka.

Generation is one batch of 1–50 links (owner-visible limit; bounded so a slip cannot inflate
Hak pilih unboundedly) and at most 500 rows per election, cancelled rows included. Every
created link appends one audit entry (D10); the batch is written in one D1 batch, and the
whole generation is refused if the election is no longer inside the window at write time
(the `INSERT ... SELECT ... WHERE status_lock ... AND NOT closed` guard), so a race with
"Tutup Sekarang" cannot slip a link in after close.

Cancellation targets one `Belum Dipakai` row: `UPDATE direct_invitations SET cancelled_at
= ?, cancelled_by = ?, cancelled_by_name = ? WHERE id = ? AND used_at IS NULL AND
cancelled_at IS NULL AND <not closed guard>`. A used row is refused with a message naming
why (its vote exists; cancelling would subtract a Hak pilih that has already been cast). A
row that is already cancelled is refused as such. Cancellation runs in the same batch as
its audit entry.

### D7: Opening a link, the claim form and the sealed invite session

`GET /undangan/<kode>` resolves the hash of the normalized code. The page shows, in order:
welcome ("Selamat datang di Pemilihan Umum") with "Lihat profil kandidat" and "Pilih";
then, while the stage allows it, the claim form (**Nama**, **Email**, **Korda/Komsat**).
"Lihat profil kandidat" links to the existing candidate pages, so no candidate rendering is
duplicated. The Korda/Komsat fields are a `<select>` (no free text) listing `units` rows of
type `korda` and `komsat` that sit inside the site's scope (`path = SITE_SCOPE` or under
it), labelled with the Portal names (`unitPathLabel`). If no units are synced yet, the form
cannot be submitted and the page says the unit list is not available yet.

Submitting the claim writes `guest_name`, `guest_email`, `komsat_path`, `claimed_at` and a
fresh `claim_id`, then seals `{invitation_id, token_hash, claim_id, guest_name,
komsat_path, auth_time}` into an HttpOnly `undangan_session` cookie with `APP_MASTER_KEY`
(the same sealing as `ppij_session`), short-lived (30 minutes), and redirects to
`/undangan/<kode>/surat-suara`. The ballot page reads the sealed session, never the raw
token, so the token is not re-sent with every request; when the sealed session is missing or
stale the person is sent back to the claim form (and the link may already be used).

**Reservation (recommended, see Open questions).** A claim that finds a live claim
(`claimed_at` within 30 minutes) under a different `claim_id` shows "Tautan sedang diisi
orang lain" and does not overwrite it; the holder's own `claim_id` may continue. The
reservation is lapsed by the clock, never by a job, and it is advisory: the vote's one-use
guard (D5) is the only thing that decides. Reservation writes are never audit-logged (they
are not a ledger change — Hak pilih does not move).

### D8: Stage matrix of a link (and of the Guest pages)

| Stage | Link shows | Ballot | Generate / Cancel |
| --- | --- | --- | --- |
| Draf | welcome + "jadwal belum ditetapkan" | no | allowed |
| Terjadwal | welcome + schedule | no | allowed |
| Dibuka | welcome + claim + ballot | yes | allowed |
| Ditutup | "Pemungutan suara telah ditutup" | no | refused |
| Diumumkan | "Hasil sudah diumumkan" | no | refused |

A used link shows "Tautan ini sudah dipakai. Satu tautan hanya berlaku untuk satu orang."
A cancelled link shows "Tautan ini dibatalkan oleh panitia." An unknown code shows the same
404 page as any unknown public path, with no hint that links exist. Stage is computed from
the clock on each request (no polling), and the vote itself re-checks the open stage inside
the batch (D5), so a page left open across the deadline cannot vote.

### D9: Results, Dasbor and participation count invite voters

All read from the one effective Hak pilih helper (D3):

- **Overall:** `eligible_count` = frozen roll + active links; distribution percentages keep
  dividing by that; the count check compares participation and ballots against it as today.
- **Participation / "Sudah digunakan":** the invite participation rows are ordinary rows in
  the participation total, so invitees are counted as having voted.
- **Unused links:** they are inside the denominator and have no participation row, so they
  show up as non-voters — exactly the "unused link = Abstain once Hitung Abstain runs" rule
  of the owner's decision, with no special-casing in the tally code.
- **Per korda:** the eligible-by-region and used-by-region numbers gain the invitation
  side through the invitation row's chosen `komsat_path`: used links bucket by their chosen
  path, and unused links are not in any korda (their komsat is unknown until claimed).
  The per-korda table therefore sums to slightly less than the national Hak pilih while
  unused links exist, and the page states that instead of hiding it. The 10-ballot
  suppression is unchanged.
- **Hitung Abstain:** `pending_count` = effective Hak pilih − participation, so unused
  links become Abstain; because generate and cancel are refused after close, the frozen
  number cannot change afterwards.

### D10: Audit entries

Through the normal hash-chained path (`buildGuardedAuditInsert`/`buildAuditInsert`), three
actions, all with `target =` the row's short `reference` and never a token, an email or a
ballot choice:

- **"Undangan langsung dibuat"** — actor the Admin Voting, `detail_json` with
  `{"count": N, "references": ["A7K3M9", ...]}` (references only, never codes).
- **"Undangan langsung dibatalkan"** — actor, `detail_json` `{"reference": "..."}`.
- **"Pemungutan suara undangan"** — `actor_type: "voter"`, `actor_member_id:
  "undangan:<reference>"`, `actor_name` = guest Nama, `komsat_path` = chosen path, no
  candidate and no choice in the detail (the existing vote entry never carries them; this
  one must not either).

`src/server/audit/labels.ts` gains a rule for `undangan:<reference>` targets so the audit
page prints "Undangan A7K3M9" instead of a raw id (it currently returns nothing for
unknown targets).

### D11: Rate limits (no IP stored)

Reusing the `rate_limits` UPSERT, with keys built from the code hash or the row id, never
from a client IP (hard rule 5's spirit: no new personal data at rest):

- `undangan:buka:<16 hex of token_hash>` — 30 per 60 s per link, to blunt code guessing.
- `undangan:buka:semua` — 600 per 60 s global ceiling for link resolution.
- `undangan:klaim:<16 hex of token_hash>` — 10 per 60 s per link.
- `undangan:suara:<invitation_id>` — 5 per 60 s, the same shape and limit as `vote:<member>`.

128 random bits make guessing infeasible; the limits are defense in depth against a noisy
or hostile client, not the primary protection.

### D12: Copy (Bahasa Indonesia, no emoji)

- Page name **"Undangan Pemilih"**, helper wording "undangan langsung"; nav label
  "Undangan". The existing Admin Voting invitation panel (on `admin/index.astro`) keeps
  its own wording and is never called "Undangan Pemilih".
- Table columns exactly **Link | Dibuat Pada | Oleh | Status**; statuses exactly **Belum
  Dipakai**, **Sudah Dipakai**, **Dibatalkan**; a copy button per row while the code is
  still in the tab.
- Generation: "Buat undangan" with a count field, and the show-once result panel with
  "Tautan hanya ditampilkan sekali. Salin sekarang." plus "Salin semua".
- Public pages: "Selamat datang di Pemilihan Umum", "Lihat profil kandidat", "Pilih",
  form labels "Nama", "Email", "Korda/Komsat", "Lanjutkan ke surat suara".
- Refusals: used link "Tautan ini sudah dipakai. Satu tautan hanya berlaku untuk satu
  orang."; cancelled "Tautan ini dibatalkan oleh panitia."; closed "Pemungutan suara telah
  ditutup."; announced "Hasil sudah diumumkan."; not open yet "Pemungutan suara belum
  dibuka. Simpan tautan ini dan kembali sesuai jadwal."; being claimed "Tautan sedang
  diisi orang lain. Minta panitia mengirim tautan baru bila perlu."; after close, panitia
  "Tautan tidak dapat dibuat atau dibatalkan setelah pemungutan suara ditutup."; used-link
  cancel "Tautan ini sudah dipakai dan tidak dapat dibatalkan."
- Stage names stay Draf, Terjadwal, Dibuka, Ditutup, Diumumkan; roles Admin Voting,
  Admin Portal, Pemilih; no emoji; Tabler icons only.

## Risks / Trade-offs

- **An over-issued batch inflates Hak pilih**, and every unused link is a real Abstain once
  Hitung Abstain runs. Mitigated by the 1–50 per action and 500 per election limits, the
  "Belum Dipakai" count in the table, and cancellation that returns the +1 before close.
  The risk is stated, not hidden: the table is the roster panitia reconciles.
- **A lost link wastes one Hak pilih** and can only be fixed by cancelling the row (its
  reference is still listed) and generating a replacement. This is the cost of storing only
  the hash; the show-once panel with "Salin semua" is the mitigation.
- **A duplicate handed to the same person is not caught by the system** (owner decision),
  and if that person votes twice with two links, two ballots exist. Participation and the
  tally stay consistent; panitia's hand check is the control, and the reference list plus
  the audit entries are the evidence.
- **The link is a bearer credential**: anyone holding it can vote as the guest. Accepted —
  it is the feature, and panitia hands links to named korda/komsat channels.
- **Per-korda rows do not sum to the national Hak pilih while unused links exist** (their
  komsat is unknown until claimed). Stated on the page; the alternative — attributing
  unused links to a korda — would be a guess.
- **A claim reservation can lock out an abandoned tab for up to 30 minutes.** Bounded by
  the clock and by the holder resuming; panitia can cancel and reissue, which is the
  intended remedy.

## Migration plan

`0015_direct_invitations.sql` is additive: one new table and one index, no column on
`elections`, `voters`, `participation`, `ballots` or the Admin Voting `invitations`, and no
backfill (no link has ever existed). Existing elections start with zero links, so effective
Hak pilih equals today's frozen number and every result is byte-for-byte unchanged until the
first link is generated. Rollback is the usual one: dropping the table returns the site to
today's behaviour; rows would be lost with it, which is acceptable because a link only
matters while the election is open.

## Open questions

The real open questions and their recommendations live at the end of `proposal.md`. They
are: show-once versus retrievable links (D2 chooses show once), what the Email is for, unused
links in the per-korda table, whether a claim reserves the link (D7 recommends a 30-minute
lapse), cancelling after close (D6 refuses), batch size and ceiling, the page/wording
(Undangan Pemilih versus the Admin Voting invitation panel), invite voters on Daftar
Pemilih (no), and duplicate links (panitia checks, no system block).
