# Tasks

## 1. Schema and server
- [x] 1.1 Migration `0006_preview_mode.sql` (elections.preview_mode) and `0007_candidate_short_intro.sql` (candidates.short_intro).
- [x] 1.2 Preview mode: auto-register from session claims in `authorizeVoter`, readiness relaxations, Kunci skips final sync and allows current opens_at, schedule toggle stores the flag.
- [x] 1.3 Receipt v2: 80-bit / 16-char grouped encoder-decoder with legacy-26 verification, updated board and receipt-check clients.
- [x] 1.4 Vote guard: `julianday` instant comparison; drop the 10-minute cap (reject only future `auth_time`).
- [x] 1.5 Candidates: name/nickname length validation (60/24), `short_intro` validation (≤100), photo path helper.

## 2. Auth and account
- [x] 2.1 `return_to` on all Masuk links; `no-store` on auth redirects; `masuk=ulang` marker and `prompt=login` re-auth.
- [x] 2.2 `/akun` page (identity, election status, admin entry, Keluar) with recovery classification; header avatar chips on voter and admin layouts; admin middleware redirect with loop breaker; cookie normalizer in the worker fetch.

## 3. Pages and content
- [x] 3.1 Two-step radio bottom-sheet ballot; success screen with save-copy copy and link to the secrecy section.
- [x] 3.2 Bukti Suara ticket page: device-saved code/choice, manual check, disabled proof board until close, "Tentang kerahasiaan suara Anda" section.
- [x] 3.3 Candidate listing cards (`CandidateCard`) with portraits and `short_intro`; Markdown profile with YouTube facade/fallback and photo lightbox; white canvas.
- [x] 3.4 Admin editor: Markdown textarea, maxlengths; admin Pemilih/Kandidat unit-name formatting; countdown "X hari HH:MM:SS".

## 4. Tests and docs
- [x] 4.1 New `test/preview-mode.test.ts`, `test/lib/markdown.test.ts`; update vote-api, receipt-board, auth-session, candidates, election-lifecycle, schema tests.
- [x] 4.2 `npm run check`, focused vitest layers, `scripts/gate.sh` green.
- [x] 4.3 README and design/DESIGN.md updated (receipt format, preview mode, photos/Markdown, account home).
