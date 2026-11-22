# Design: Rekapitulasi Suara and the Excel export

## D1. One guarded batch, one source of truth

The recap action mirrors the Hitung Abstain batch it replaces: the non-voter count is
read from the same helper chain (the existing Hak pilih resolver minus participation),
then one D1 batch writes a gated UPDATE and a hash-chained audit entry that is only
appended when the UPDATE changed a row. The gate is
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

## D4. Sheet contents follow the owner's Q229/Q230 decisions

Kotak suara carries only `receipt_hash` and the choice label (Setuju / Tidak Setuju; a
legacy Abstain ballot keeps its label, a multi-candidate ballot would show the
candidate nickname — unreachable while recap is single-candidate-only). No komsat, no
time, no member column. Abstain lists non-voting roll members with name, member number,
korda and komsat, and appends one row per unused non-cancelled link ("Tautan undangan
<reference> (tidak dipakai)"), so the row count equals the stored Abstain count by
construction: Hak pilih − participation = non-voting members + unused links (used links
correspond one-to-one to `undangan:<reference>` participation rows).

## D5. Percentages and totals

Ringkasan separates the roll term (Total DPT, labelled with its resolver source:
"Dibekukan", "Snapshot penutupan", or "Portal langsung") from DPT final (roll +
non-cancelled links, the figure every share divides by). For the closing snapshot,
whose stored figure already includes the link term, the roll term is recovered as the
snapshot minus the non-cancelled links (links cannot change after close, so this is
exact at recap time). Setuju + Tidak Setuju + Abstain = DPT final: Setuju and Tidak
Setuju are the ballot choice totals, Abstain is the stored `recap_abstain_count`.

## D6. Page states and copy

The page renders from one fetch of `/api/admin/recap`: before close it shows a note
that recap opens after voting closes; after close it shows the heading, the one-way
confirmation dialog with the pending non-voter count, and the Rekapitulasi Suara
button; after recap it shows the five tabs, the Unduh Excel button and a link to
Umumkan Hasil in Pengaturan. Bahasa Indonesia, friendly-helpful-secure, Tabler icons,
no polling — the committee refreshes manually like every other admin page.
