# Design: Rekapitulasi Suara and the Excel export

## D1. One guarded batch, one source of truth

The recap action mirrors the Hitung Abstain batch it replaces: the non-voter count is
read from the same helper chain (the existing Hak pilih resolver minus participation
minus the unused links that will be cancelled), then one D1 batch writes a gated
UPDATE, a hash-chained audit entry appended only when that UPDATE changed a row, and
the cancellation of every still-unused invite link. The audit guard reads `changes()`
from the elections UPDATE, and the link cancellation is itself gated by
`EXISTS(elections.recap_at = this batch's time)`, so the statements can never land
half-done: a lost race cancels nothing and records nothing. Cancellation is recorded
as ONE summary audit entry (the cancelled count in the recap entry's detail, no
references), not one entry per link. For a live roll, the stored closing Hak pilih is
adjusted inside the same UPDATE by the cancelled count, so every consumer of the
resolver reads the same post-recap DPT final (roll + used links). The gate is
`status_lock='locked' AND single_candidate_mode=1 AND recap_at IS NULL`, and the stage
(Ditutup, by clock or Tutup Sekarang) is checked in the state read first, exactly as
Hitung Abstain did. A second request, a concurrent request, or a request after
Kembali ke Draf + re-close all fail safely: `recap_at` is the one-way marker.

`recap_at` / `recap_abstain_count` are the single source of truth for "recap done" and
for the stored Abstain figure. The older `abstain_counted_at` / `abstain_counted_count`
columns are no longer written; the results payload keeps its `abstain_counted` /
`abstain_counted_at` field names (screens and the sealed-tally delta reference them) but
feeds them from the recap columns. Kembali ke Draf clears both column pairs so a
pre-recap election that already ran the old action cannot leak state into a new run.

## D2. The seal lifts only where the payload is admin-only

The seal is one boolean in the results query layer: `stage !== "published" &&
recap_at === null`. Because recap requires single candidate mode, a multi-candidate
election can never set `recap_at`, so its seal is byte-for-byte today's. The public
paths (`/api/results`, `/hasil`, the landing page) do not go through the sealed
dashboard payload at all: `getPublicResults` still returns `null` before Diumumkan and
`/api/results` still answers 409, so lifting the seal for `/api/dashboard` cannot leak
anything public. `/api/turnout` is counts-only and unchanged.

## D3. The recap payload is read-only JSON, computed set-based

`GET /api/admin/recap` returns the recap state in every stage (so the page can render
its three states) and, only when `recap_at` is set, the five data blocks. The endpoint
appends the "Rekapitulasi dilihat" audit entry exactly when it serves data, with an
empty detail — a state-only load before recap exposes no tally and records none. The
download marker `POST /api/admin/recap/download` appends "Rekapitulasi diunduh" and
returns only `{ok:true}`; the browser then builds the `.xlsx` from the JSON it already
loaded with the bundled `write-excel-file`, so the server never produces a file and the
audit and the download cannot drift apart. Ballot rows are ordered by receipt hash, a
64-hex digest of random codes, which is already a random order; the order is stable per
download so the file and the audit agree.

Numbers come from set-based SQL in one batch (the same style as the results query
layer): roll buckets by region and by exact komsat path with the same
`can_vote = 1` (and admin-exclusion) filter the Hak pilih resolver uses, participation
buckets, ballot buckets, choice totals, invite statuses, units and the guest rows. The
Korda/Komsat sheets list every unit row plus a remainder row per data path outside the
unit list and, when unused links exist, a "Tautan undangan belum dipakai" row, so each
column sums to the national figure without an unexplained gap.

## D4. Sheet contents follow the owner's Q229 and the anonymised Abstain decision

Kotak suara carries only `receipt_hash` and the choice label (Setuju / Tidak Setuju; a
legacy Abstain ballot keeps its label, a multi-candidate ballot would show the
candidate nickname — unreachable while recap is single-candidate-only). No komsat, no
time, no member column (Q229). Abstain is ANONYMISED (owner decision 2026-11-22,
replacing Q230): counts per komsat only — Korda, Komsat, the non-voter count, and the
share of that komsat's Hak pilih. The server never sends per-member non-voter data (no
name, no member number): the query aggregates by `komsat_path` and nothing else. Every
komsat is listed including those with 0; roll paths outside the komsat list form one
remainder row so the per-komsat sums still equal the Abstain count. Because the recap
cancels unused links, no link rows exist anywhere in the recap data: DPT final is the
roll + used links, and Abstain is roll non-voters only.

## D5. Percentages and totals

Ringkasan separates the roll term from the link term with an explicit three-line
breakdown so the two DPT figures cannot be misread as a contradiction (owner decision
2026-11-22): "DPT anggota (daftar anggota portal)" is the roll, labelled with its
resolver source ("Dibekukan", "Snapshot penutupan", or "Portal langsung");
"+ Pemilih undangan (tautan dipakai)" is the used links; "= DPT final (Hak pilih
hasil)" is their sum, the figure every share of DPT final divides by. The invite
counts (created / used / cancelled) stay in their own block with one note that unused
links are cancelled automatically at Rekapitulasi Suara and not counted. For the
closing snapshot, whose stored figure already includes the link term, the roll term is
recovered as the snapshot minus the links that were active at close (used plus the ones
the recap cancels; nothing changes between close and recap, so this is exact). After
the recap the resolver itself returns roll + used links, so the sheet can recover the
roll as DPT final minus used links in every source case.

The results table carries two percentage columns: "% dari DPT final" for Setuju,
Tidak Setuju and Abstain as today, and "% dari suara masuk" for Setuju and Tidak
Setuju only, based on the votes cast (Setuju + Tidak Setuju); Abstain gets "—" there
because non-voters are not votes cast, and when no votes were cast the column shows
"—" (null in the payload, never a division by zero). One note states that the system
declares no winner and any threshold (DPT or votes cast) is decided by the committee.
Setuju + Tidak Setuju + Abstain = DPT final: Setuju and Tidak Setuju are the ballot
choice totals, Abstain is the stored `recap_abstain_count`.

## D6. Page states and copy

The page renders from one fetch of `/api/admin/recap`: before close it shows a note
that recap opens after voting closes; after close it shows the heading, the one-way
confirmation dialog with the pending non-voter count, and the Rekapitulasi Suara
button; after recap it shows the five tabs, the Unduh Excel button and a link to
Umumkan Hasil in Pengaturan. Bahasa Indonesia, friendly-helpful-secure, Tabler icons,
no polling — the committee refreshes manually like every other admin page.
