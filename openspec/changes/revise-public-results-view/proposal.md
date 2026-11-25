# Revise public results view (Hasil per korda + beranda)

## Why
Owner request 2026-11-26, after Umumkan Hasil of Pemira 2026: the public result must read as a
plain Setuju vs Tidak Setuju outcome. The korda table hid rows below 10 ballots ("Data terlalu
sedikit") and mixed Abstain into the percentages, which made the published outcome hard to read.

## What changes
- Remove the per-korda minimum-ballot suppression (`KORDA_MIN_BALLOTS`). Every korda shows its
  Setuju and Tidak Setuju counts once results are published (owner decision, accepted trade-off:
  a korda with very few ballots can reveal how its voters chose). The `suppressed` field stays in
  the API for compatibility and is always `false`.
- `/hasil` (single candidate mode): no Abstain anywhere. Perolehan suara and Hasil per korda use two
  denominators: Partisipasi = suara masuk / Hak pilih; Setuju and Tidak Setuju = share of suara masuk
  (they sum to 100%). Korda rows render a turnout bar and a stacked Setuju/Tidak Setuju bar using
  tokens only (`--status-green`, `--primary`, `--foreground`, `--muted`, `--border`, `--card`).
  Zero ballots render "Belum ada suara masuk".
- Beranda: once Diumumkan, the Hasil card shows the final Setuju / Tidak Setuju result with a stacked
  bar and links to `/hasil` ("Lihat detail").
- Not changed: Rekapitulasi Excel, admin Rekapitulasi, the stored Abstain count, the API fields.

## Stack note
The owner brief named React + Recharts; this app has neither. The same layout is built in Astro with
plain HTML/CSS bars and a native tooltip, so no new runtime dependency ships.
