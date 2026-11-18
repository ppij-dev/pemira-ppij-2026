# Proposal: Undangan Langsung (direct invite links for voters without a portal account)

## Why

A PPIJ member who has no PPIJ One Login account in the Portal cannot vote at all today:
eligibility demands a frozen-roll row plus a fresh in-scope sign-in, and sign-in needs the
Portal. The owner's decision of 2026-11-19 is a second, committee-issued way in: Admin
Voting generates batches of **direct invitation links**, panitia hands them to korda and
komsat, and the person votes with the same ballot, confirmation sheet, receipt code and
secrecy rules as a Pemilih. The system **trusts the link**: it is the credential, and
panitia is responsible for checking that nobody receives two links or already has a
Portal account. There is no automatic duplicate check against Hak pilih.

Because the link is a vote in waiting, every active link counts as one Hak pilih from the
moment it is generated. An unused link therefore behaves exactly like a member who did not
vote: it is non-voter, so in single candidate mode it becomes Abstain once Admin Voting
runs Hitung Abstain. Cancelling an unused link removes its +1 again. Every generation and
every cancellation is audit-logged, and the link code is stored only as a hash.

## What Changes

- **New Admin Voting page "Undangan Pemilih"** (`/admin/undangan`). It generates N links
  at once (1–50 per action) while the election is Draf, Terjadwal or Dibuka, and lists
  them in a table of **Link | Dibuat Pada | Oleh | Status** with a copy button per row.
  Statuses are exactly **Belum Dipakai**, **Sudah Dipakai** and **Dibatalkan**. Any Admin
  Voting may generate and cancel; all rights are equal. The table has a status filter
  (Belum Dipakai / Sudah Dipakai / Dibatalkan) and a text search on the reference, and an
  **Unduh Excel** button that builds an `.xlsx` in the browser from the loaded JSON list
  (local processing, no upload) with the columns Link, Referensi, Dibuat Pada, Oleh,
  Status and — for used links — Dipakai Pada, Nama, Email and Korda/Komsat.
- **The link is the credential.** Opening `/undangan/<kode>` shows a welcome page
  ("Selamat datang di Pemilihan Umum") with "Lihat profil kandidat" and "Pilih". "Pilih"
  asks for **Nama, Email and Korda/Komsat**, the Komsat chosen from the same `units` list
  synced from the Portal, and then hands the person to the **same ballot** a logged-in
  Pemilih sees — including single candidate mode, the confirmation sheet, the one-time
  receipt code and every secrecy rule. After the vote the link is **Sudah Dipakai**.
- **Stage behaviour of a link.** Before voting opens (Draf, Terjadwal) a link shows the
  welcome page and the schedule and no ballot. While Dibuka it works. Once voting closes
  (Ditutup) or results are published (Diumumkan) it shows a clear closed message. A used
  or cancelled link shows its own message. Generation and cancellation are refused once
  voting has closed, so Hak pilih cannot move after the count.
- **Hak pilih is the frozen roll plus the active links.** Each active (not cancelled) link
  adds exactly one, computed live, so a link generated after Kunci counts and cancelling
  an unused link subtracts one. A used link keeps its +1 because its voter now exists.
  The frozen column itself is never rewritten; the next Kunci rebuilds only the roll term,
  so nothing is counted twice.
- **Storage.** A new table `direct_invitations` (migration
  `0017_direct_invitations.sql`; `0015` and `0016` belong to the live-roll change),
  deliberately named so it can never be confused with the existing `invitations` table,
  which stays the Admin Voting invitation table. The row stores the link token twice: the
  SHA-256 hash for lookup, and the token sealed with `APP_MASTER_KEY` so Admin Voting can
  copy the link again. A short non-secret `reference` (6 Crockford characters) names the
  row in the table and in the audit log. The decrypted link is never written to the audit
  log, and it is no longer offered once the link is used or cancelled.
- **The guest identity lives on the invitation row, never on the ballot.** Nama, Email and
  the chosen Komsat are stored on `direct_invitations`. The ballot keeps only the chosen
  `komsat_path` (as today), so the per-korda results include invitees and the ballot stays
  unlinkable to the person. The participation row uses the reserved `member_id`
  `undangan:<reference>` (its `member_name` is the guest Nama), so the existing one-vote
  constraint covers links too; per-korda used counts join participation to the invitation
  row's `komsat_path`.
- **One use under concurrency.** The one-use mark, the participation row, the ballot and
  the audit entry are written in one guarded D1 batch, so a double tap or two devices
  produce exactly one vote and one ballot. The invitation link endpoints are rate limited.
- **Results, Dasbor and participation count invite voters.** "Sudah digunakan" includes
  invite voters; "Belum digunakan" includes unused links; per korda the invitee counts in
  the komsat they chose. The 10-ballot per-korda suppression is unchanged.
- **Audit.** Every created link, every cancellation and every invite vote appends a
  hash-chained entry: no link code, no email and never a choice.

## Capabilities

### New Capabilities

- `direct-invitations`: generating, listing, cancelling and opening direct invitation
  links; the claim form; link-code hashing and one-use enforcement; rate limits.

### Modified Capabilities

- `voter-roll`: Hak pilih = frozen roll + active direct invitation links, the frozen roll
  column never rewritten, invite voters are not roll rows.
- `voting-and-receipts`: the invitee ballot is the same ballot with the same confirmation,
  receipt, board and secrecy rules; the invite participation row; one use per link.
- `admin-dashboard`: Hak pilih, Sudah/Belum digunakan and per-korda rows count invite
  voters and unused links; single candidate mode and Hitung Abstain follow.
- `public-site`: the welcome page and the stage messages a link shows.
- `audit-log`: entries for generation, cancellation and invite votes.
- `election-lifecycle`: generating and cancelling only before the close; links survive
  Kembali ke Draf; the lock audit records the active link count.

## Impact

- **DB:** `migrations/0017_direct_invitations.sql` (the live-roll change owns `0015`
  and `0016`) — new table `direct_invitations` (`id`, `reference UNIQUE`,
  `token_hash UNIQUE`, `token_enc`, `created_at`, `created_by`, `created_by_name`,
  `claimed_at`, `claim_id`, `guest_name`, `guest_email`, `komsat_path`, `used_at`,
  `cancelled_at`, `cancelled_by`, `cancelled_by_name`) plus an index on (`used_at`,
  `cancelled_at`). No column is added to `voters`, `participation`, `ballots` or
  `elections`.
- **Server:** new `src/server/direct/` (the module name is "direct", never
  "invitations", so nobody confuses it with the Admin Voting `invitations` table) —
  `code.ts` (Crockford link code, seal, hash, normalize, short `reference`), `create.ts`
  (batch generation, listing with links, status), `cancel.ts`, `claim.ts` (guest details,
  sealed invite session, reservation), `open.ts` (link resolution and stage view),
  `vote.ts` (invite vote batch) and `routes.ts` (public `/api/undangan/*`); the admin
  endpoints `/api/admin/undangan*` are added to `src/server/admin/routes.ts` so they
  inherit its `requireAdmin` guard. `src/server/lib/hakPilih.ts` holds the single
  `+ non-cancelled links` Hak pilih term both consumers use — the same place the pending
  live-roll change will add its live term, so the two merge in one helper. Reuse of
  `src/server/voting/{receipt,choice}.ts` (the same Crockford code and hashing),
  `src/server/lib/secrets.ts` (the sealed token), and the audit helpers;
  `src/server/results/queries.ts` (Hak pilih and per-korda denominators);
  `src/server/election/lifecycle.ts` (Hitung Abstain pending count, lock audit detail);
  `src/server/audit/labels.ts` (`undangan:<reference>` targets).
- **Dependency:** one small, well-known browser Excel writer bundled by Vite (no CDN),
  loaded only by the Undangan Pemilih page for the local `.xlsx` export.
- **UI:** new `src/pages/admin/undangan.astro` (generation form, table with copy buttons,
  status filter, reference search, Excel download, cancel, statuses) and
  `src/pages/undangan/[kode].astro` plus `src/pages/undangan/[kode]/surat-suara.astro`
  (welcome, claim form, invitee ballot); navigation entry in `src/layouts/AdminLayout.astro`;
  `src/pages/admin/dasbor.astro`, `src/pages/hasil.astro` and `src/pages/index.astro` for
  the invite voters in the statistics.
- **Tests:** `test/schema.test.ts` (migration, CHECKs, uniqueness),
  `test/direct-invitations.test.ts` (generation, statuses, cancel, retrievable links,
  filtering, Hak pilih arithmetic, claim reservation, stage matrix, rate limits),
  `test/invite-vote.test.ts` (same ballot and receipt, single candidate mode, one use
  under concurrency, secrecy, audit), `test/results-api.test.ts` (invite voters in Hak
  pilih, participation and per-korda rows, unused links as non-voters, Hitung Abstain),
  `test/election-lifecycle.test.ts` (refusal after close, Kembali ke Draf keeps links,
  lock detail), `test/audit-api.test.ts` (entries, hash chain, no link ever logged), plus
  admin page render tests for the table, the filter and the export.
- **Risk:** an over-issued batch inflates Hak pilih. Mitigated by the 1–50 batch limit,
  the copy-again column so a link can be re-handed without regenerating it, cancellation
  that returns the +1, and refusal of generation and cancellation once voting closes. The
  sealed token is a second route to a live credential: it is protected by the same
  `APP_MASTER_KEY` as session cookies, is only ever returned to an Admin Voting session,
  and stops being readable the moment the link is used or cancelled. A panitia that hands
  out a duplicate is not caught by the system (by the owner's decision); the invitation
  table is the roster it checks against.
- **No change** to ballot secrecy mechanics, receipt codes and the receipt board for
  Pemilih, the frozen roll and its sync, the Admin Voting `invitations` table, readiness
  checks or the polling-free behaviour.

## Open questions

All nine were put to the owner and **accepted as recommended on 2026-11-19**, except the
first, which the owner replaced with a decision of their own. They are recorded here as
decisions.

1. **Retrievable or show-once links?** Owner decision (2026-11-19): links stay
   **retrievable**. Each token is stored sealed with `APP_MASTER_KEY` beside its SHA-256
   lookup hash, and Admin Voting can copy any link from the table at any time until it is
   used or cancelled. The show-once design and the sessionStorage copy are dropped; the
   decrypted link is never written to the audit log.
2. **What is the Email used for?** Accepted: contact and duplicate-check data for panitia
   only. No email is sent in 1.0 (no outgoing email), the field is never logged and never
   written to a ballot, and it is stored on the invitation row only.
3. **Do unused links belong to a korda in the per-korda table?** Accepted: no. An unused
   link counts in the national Hak pilih only; a used link counts in the komsat the person
   chose. The korda rows therefore sum to slightly less than Hak pilih while unused links
   exist, and the page says so.
4. **Does a claim reserve the link?** Accepted: yes, for 30 minutes. The first claim holds
   the link, the second sees "Tautan sedang diisi orang lain", the reservation lapses on
   its own if the person abandons it, and the vote still enforces one use. The table keeps
   the three statuses and adds a muted "sedang diisi <Nama>, sejak <jam>" line while a
   claim is live.
5. **May a link be cancelled after voting closes?** Accepted: no. Generation and
   cancellation stop when voting closes (Ditutup) so Hak pilih and the Hitung Abstain
   count stay consistent with what was counted.
6. **Batch size and ceiling?** Accepted: 1–50 links per action and at most 500 links per
   election (cancelled ones included), which bounds accidental inflation and keeps the
   table usable.
7. **Page and wording.** Accepted: name the new page "Undangan Pemilih" with the helper
   wording "undangan langsung", so it can never be mistaken for the Admin Voting
   invitation panel on the Panitia page.
8. **Should invite voters appear on the Daftar Pemilih page?** Accepted: no. They are not
   roll members; the Undangan Pemilih table is their roster, and Dasbor's statistics and
   the per-korda rows include them. A merge into the roll would blur the frozen-roll
   guarantee that a Pemilih needs a fresh One Login sign-in.
9. **What if one person receives two links?** Accepted: keep panitia's hand check and add
   no automatic block; a read-only "same Nama/Email on two invitation rows" hint on the
   Undangan Pemilih page is a later, separate change if panitia asks for it.
