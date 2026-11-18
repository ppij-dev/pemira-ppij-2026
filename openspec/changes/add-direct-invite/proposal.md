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
  Voting may generate and cancel; all rights are equal.
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
  `0015_direct_invitations.sql`), deliberately named so it can never be confused with the
  existing `invitations` table, which stays the Admin Voting invitation table. Only the
  SHA-256 of the link code is stored, plus a short non-secret `reference` (6 Crockford
  characters) that names the row in the table and in the audit log. The link code itself
  is shown once, at generation, and can never be read back from the server.
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

- **DB:** `migrations/0015_direct_invitations.sql` — new table `direct_invitations`
  (`id`, `reference UNIQUE`, `token_hash UNIQUE`, `created_at`, `created_by`,
  `created_by_name`, `claimed_at`, `claim_id`, `guest_name`, `guest_email`,
  `komsat_path`, `used_at`, `cancelled_at`, `cancelled_by`, `cancelled_by_name`) plus an
  index on (`used_at`, `cancelled_at`). No column is added to `voters`, `participation`,
  `ballots` or `elections`.
- **Server:** new `src/server/direct/` (the module name is "direct", never
  "invitations", so nobody confuses it with the Admin Voting `invitations` table) —
  `code.ts` (Crockford link code, hash, normalize, short `reference`), `create.ts` (batch
  generation, listing, status), `cancel.ts`, `claim.ts` (guest details, sealed invite
  session, reservation), `open.ts` (link resolution and stage view), `vote.ts` (invite
  vote batch) and `routes.ts` (public `/api/undangan/*`); the admin endpoints
  `/api/admin/undangan*` are added to `src/server/admin/routes.ts` so they inherit its
  `requireAdmin` guard. Reuse of `src/server/voting/{receipt,choice}.ts` (the same
  Crockford code and SHA-256 hashing) and the audit helpers; `src/server/results/
  queries.ts` (Hak pilih and per-korda denominators); `src/server/election/lifecycle.ts`
  (Hitung Abstain pending count, lock audit detail); `src/server/audit/labels.ts`
  (`undangan:<reference>` targets).
- **UI:** new `src/pages/admin/undangan.astro` (generation form, show-once result panel,
  table, copy buttons, cancel, statuses) and `src/pages/undangan/[kode].astro` plus
  `src/pages/undangan/[kode]/surat-suara.astro` (welcome, claim form, invitee ballot);
  navigation entry in `src/layouts/AdminLayout.astro`; `src/pages/admin/dasbor.astro`,
  `src/pages/hasil.astro` and `src/pages/index.astro` for the invite voters in the
  statistics.
- **Tests:** `test/schema.test.ts` (migration, CHECKs, uniqueness),
  `test/direct-invitations.test.ts` (generation, statuses, cancel, Hak pilih arithmetic,
  claim reservation, stage matrix, rate limits), `test/invite-vote.test.ts` (same ballot
  and receipt, single candidate mode, one use under concurrency, secrecy, audit),
  `test/results-api.test.ts` (invite voters in Hak pilih, participation and per-korda
  rows, unused links as non-voters, Hitung Abstain), `test/election-lifecycle.test.ts`
  (refusal after close, Kembali ke Draf keeps links, lock detail), `test/audit-api.test.ts`
  (entries and hash chain), plus an admin page render test.
- **Risk:** an over-issued batch inflates Hak pilih, and a lost link wastes one. Mitigated
  by the 1–50 batch limit, the show-once warning with copy buttons before leaving the
  page, cancellation that returns the +1, and refusal of generation and cancellation once
  voting closes. A panitia that hands out a duplicate is not caught by the system (by the
  owner's decision); the invitation table is the roster it checks against.
- **No change** to ballot secrecy mechanics, receipt codes and the receipt board for
  Pemilih, the frozen roll and its sync, the Admin Voting `invitations` table, readiness
  checks or the polling-free behaviour.

## Open questions

Each carries my recommendation; the owner can simply accept them.

1. **Is the full link shown once at creation or retrievable for ever?** Storing only a
   hash means it cannot be shown again, so a copy button can only exist where the code is
   still in the browser. **Recommend: show once.** The generation response renders the
   batch with a copy button per row, a "Salin semua" button and a warning to copy before
   leaving; while the same tab still holds the codes (browser sessionStorage, never sent
   to the server) the table row keeps its copy button; afterwards the row shows the short
   reference and a "Buat ulang" path (cancel, then generate). A retrievable link would
   need the token encrypted at rest and a second route into the credential, which is worse
   than the "store only a hash" rule the owner asked for.
2. **What is the Email used for?** **Recommend: contact and duplicate-check data for
   panitia only.** No email is sent in 1.0 (no outgoing email), the field is never logged
   and never written to a ballot, and it is stored on the invitation row only.
3. **Do unused links belong to a korda in the per-korda table?** The komsat is only known
   after the person fills the form. **Recommend: no.** An unused link counts in the
   national Hak pilih only; a used link counts in the komsat the person chose. The korda
   rows therefore sum to slightly less than Hak pilih while unused links exist, and the
   page says so.
4. **Does a claim reserve the link?** Two people can open the same forwarded link and both
   fill in the form. **Recommend: yes, for 30 minutes.** The first claim holds the link,
   the second sees "Tautan sedang diisi orang lain", the reservation lapses on its own if
   the person abandons it, and the vote still enforces one use. The table keeps the three
   statuses and adds a muted "sedang diisi <Nama>, sejak <jam>" line while a claim is live.
5. **May a link be cancelled after voting closes?** **Recommend: no.** Generation and
   cancellation stop when voting closes (Ditutup) so Hak pilih and the Hitung Abstain
   count stay consistent with what was counted.
6. **Batch size and ceiling?** **Recommend: 1–50 links per action and at most 500 links
   per election** (cancelled ones included), which bounds accidental inflation and keeps
   the table usable.
7. **Page and wording.** Admin Voting already has an "Undangan" panel for Admin Voting
   invitations on the Panitia page. **Recommend: name the new page "Undangan Pemilih"
   with the helper wording "undangan langsung"**, so the two can never be mistaken for
   each other.
8. **Should invite voters appear on the Daftar Pemilih page?** **Recommend: no.** They are
   not roll members; the Undangan Pemilih table is their roster, and Dasbor's statistics
   and the per-korda rows include them. A merge into the roll would blur the frozen-roll
   guarantee that a Pemilih needs a fresh One Login sign-in.
9. **What if one person receives two links?** The owner's decision is that panitia checks
   duplicates, and this change adds no automatic block. **Recommend: keep it that way**,
   and treat a read-only "same Nama/Email on two invitation rows" hint on the Undangan
   Pemilih page as a later, separate change if panitia asks for it.
