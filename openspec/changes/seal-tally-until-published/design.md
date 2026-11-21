# Design: Seal the tally until Umumkan Hasil

## Context

One election per site (`elections`). Stages are computed from the clock on every request
(`src/server/lib/stage.ts`): Draf, Terjadwal, Dibuka and Ditutup while
`status_lock='locked'`, then Diumumkan once `status_lock='published'`. All aggregates for
Dasbor, the landing page and the public Hasil page come from one function,
`computeResults` in `src/server/results/queries.ts`, which runs a single D1 batch so
totals and breakdowns observe one snapshot. `getDashboard` (Admin Voting, audit-logged)
and `getPublicResults` (public, null before Diumumkan) both build on it.

Choice data in that payload comes from two sources: the `candidates LEFT JOIN ballots`
aggregate (`candidates[].votes`, plus the per-region grouping behind
`korda[].candidates`) and the single candidate mode `GROUP BY choice` aggregates
(`setuju_count`, `tidak_setuju_count`, `abstain_cast_count`, and the per-region choice
map behind `korda[].setuju_count` and friends). The totals `abstain_count` and the
percentages are derived from them. Everything else in the payload — Hak pilih, used,
unused, turnout, participation and ballot totals, the count check, `tidak_memilih_count`
(Hak pilih minus participation) — is participation data.

Owner decision (2026-11-21) is fixed: no choice count is readable by anybody, Admin
Voting included, before Diumumkan; participation data stays visible; the flow Tutup →
Hitung Abstain → Umumkan Hasil must not need a look at the counts; no new audit action.

## Goals / Non-goals

- **Goal:** the committee cannot see the direction of the vote before the announcement,
  and that is enforced by the server, not by hiding a panel.
- **Goal:** the committee keeps every number it needs to run the closing and the
  announcement (turnout, participation, count check, non-voter count), so the flow is not
  slowed down.
- **Non-goal:** hiding participation data. Turnout is not a choice, and Hitung Abstain is
  built on it.
- **Non-goal:** a per-viewer exception for the Technical Admin; the seal is total for the
  committee because the committee is the audience that could act on the numbers.
- **Non-goal:** any schema change, new endpoint, polling or background job.

## Decisions

### D1: One boolean in the query layer, applied to the payload

`computeResults` computes `sealed = stage !== "published"` and builds the payload from it.
Sealed output is `null` for: `candidates[].votes`, `setuju_count`,
`tidak_setuju_count`, `abstain_cast_count`, `abstain_count`, `setuju_percentage`,
`tidak_setuju_percentage`, `abstain_percentage`; per korda the same fields plus
`korda[].candidates`. The payload gains `tally_sealed: boolean` so a screen tells "sealed"
apart from "no votes yet", and the type of `candidates[].votes` becomes
`number | null`.

Both the server payload and the UI read the same flag, so a future screen cannot quietly
re-render a sealed number. `getPublicResults` already returns `null` before Diumumkan; the
seal there is a second lock, not the first.

### D2: The aggregates still run, the seal is on the way out

The D1 batch keeps its shape (same statements, same snapshot semantics for the
participation numbers, no branch that changes the batch indexes). The seal is one
transformation of the result, in one place, with a comment. Reading aggregates inside the
worker is not a leak; returning them is, and that is what the seal removes. Keeping the
batch identical also keeps `count_matches` and the totals consistent with the numbers the
committee does see.

### D3: Participation data stays, including the non-voter count

`tidak_memilih_count` is Hak pilih minus participation, so it is participation data and is
not sealed. `abstain_count` is sealed because it is the Abstain answers cast plus that
figure: publishing it would hand back the cast figure by subtraction. Abstain in the
sealed state is therefore simply not shown; the Hitung Abstain dialog still shows the
figure it will add (`pending_count` from `getAbstainCount`, participation-based), and Dasbor
still warns when Hitung Abstain has not run, because Umumkan refuses until it has.

### D4: Draf is sealed too

The owner decision names announcement as the boundary, and one rule for every stage keeps
the implementation and the tests honest. Uji Coba in Draf therefore shows participation and
ballot counts, a receipt and its proof, but no choice counts; the choice counts appear on
announcement. A rehearsal that needs to see the tally can publish a preview election.

### D5: Dasbor copy and shape

A sealed panel is a card with the section title, a lock icon (`IconLock`, Tabler), the line
"Hasil disegel sampai Umumkan Hasil" and one sentence: the committee does not see the
direction of votes until the result is announced, so the count stays neutral and every
Pemilih's choice stays secret. The per-korda table keeps its Korda, Hak pilih, Digunakan
and Partisipasi columns (participation data) and collapses the choice columns into one
sealed cell. No new tab, no new page, Bahasa Indonesia, no emoji, Tabler icons only.

### D6: No new audit action

Loading Dasbor is still `admin_tally_viewed` with the stage in the detail. A sealed read is
a legitimate tally load, so it keeps that one entry (hard rule 7 is satisfied) and a reader
who tries to see sealed numbers gets nothing to record.

## Risks

- **Surprise after announcement.** The committee may expect the numbers while voting runs;
  the sealed panel explains the rule in one sentence, and the Pengaturan copy for Umumkan
  Hasil is unchanged.
- **A fork that wants live counts** has to change `sealed` in one place and the spec that
  governs it; that is deliberate.
