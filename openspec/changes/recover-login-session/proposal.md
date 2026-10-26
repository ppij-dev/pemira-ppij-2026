# Proposal: Recover an incomplete One Login sign-in

## Why

After the October 25 cookie and redirect fixes, a voter still reached `/akun` with
"Sesi masuk tidak tersimpan". The text in the screenshot confirms the revised UI
was deployed, but the screen does not identify where sign-in failed. Today an
invalid or expired OIDC state, a missing authorization code, a failed token
verification, and a session cookie that is absent on the next request can all
lead to the same warning. It asserts a browser storage problem without evidence
and shows a second "Belum masuk" card with another sign-in button.

## What Changes

- Classify the *observed stage* of an unsuccessful browser sign-in: canceled,
  callback incomplete, or callback completed but no readable session on the
  destination request. Do not present a browser-cookie diagnosis for a callback
  failure.
- Show one recovery card on `/akun` with one primary retry action. Keep the
  ordinary signed-out card only for visits without a failed sign-in attempt.
- Retry with a fresh OIDC transaction and preserve a safe original destination
  when it is available. Never start an automatic redirect loop.
- Show a short, stable help code for repeated failures; record only a bounded
  failure category for support. Never expose or log state, codes, tokens, cookie
  values, member IDs, names, or other personal data.
- Add deterministic local regression cases for each failure boundary, including
  a browser-like request that drops the session cookie after a successful
  callback. The exact cause in the affected user's browser remains unconfirmed.

## Capability

- `auth-and-eligibility`: additional sign-in recovery requirements. This change
  extends the active `add-election-mvp` capability without changing voter
  eligibility, ballot handling, or the One Login protocol.

## Scope

The handoff covers the Pemira site (`src/server/auth`, `src/layouts/Base.astro`,
`src/pages/akun.astro`, and focused auth tests). Use the isolated local OIDC
fixture. Do not use the affected person's account or run a production login
probe. The proposal does not claim that browser cookie rejection is the root
cause of the reported incident.
