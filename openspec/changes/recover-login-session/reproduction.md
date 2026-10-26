# Reproduction and evidence for the next agent

## Observed evidence

- The affected user's screenshot shows `pemira2026.ppijepang.app/akun`, the
  amber "Sesi masuk tidak tersimpan" banner, and the ordinary "Belum masuk"
  card at the same time.
- The exact banner body was introduced by commit `bfd0591` on October 25, so
  the screenshot is from a build containing that fix. It does not establish
  which auth boundary failed.
- In the current source, `Base.astro` shows the banner whenever there is no
  readable session and the request has a `masuk` parameter. The inline script
  removes that parameter from the visible address, explaining why the
  screenshot's address bar shows only `/akun`.
- `recoverBrowserOrBadRequest` sends several callback failures to the same
  `/akun?masuk=ulang` destination. The existing test named "navigasi peramban
  (Accept: text/html) pada callback gagal..." covers the invalid-state path.
- On October 26, the focused existing test passed locally (1 passed, 15
  skipped): `npm test -- test/auth-session.test.ts -t 'navigasi peramban'
  --configLoader runner`. This confirms the callback redirect, while the
  account-page banner follows from the current `Base.astro` condition above.

## Deterministic local reproduction

Use the existing in-memory Hono/OIDC fixture in `test/auth-session.test.ts`.
Its test issuer, signed token stub, and `CookieJar` avoid a live account and
external network. Keep the browser-style `Accept: text/html` header.

1. **Callback fails before session creation (current screenshot path).** Start
   `/auth/login`, capture its `state`, then omit `ppij_auth_tx` on the callback
   request or use an unmatched state. Current behavior: HTTP 302 to
   `/akun?masuk=ulang`; an unsigned page request with that parameter renders
   the amber banner and the separate "Belum masuk" card. This reproduces the
   visible state without proving the affected user's root cause.
2. **Session fails to persist after successful callback.** Start login and
   complete a valid callback. Assert the response includes `Set-Cookie` for
   `ppij_session`, but deliberately do not apply that cookie to the next page
   request. Current behavior: the page again shows the same generic banner.
   This models cookie rejection or loss at the browser boundary.
3. **Token verification fails.** Keep `ppij_auth_tx`, then have the stub sign
   the ID token with the wrong key. Current browser navigation again redirects
   to the generic banner; it must be classified as callback incomplete.
4. **Regression controls.** Run the existing second-login-before-first-
   callback, duplicate stale `ppij_session`, and valid-session callback-replay
   cases. They must remain successful without silently weakening PKCE, state,
   token validation, or session checks.

Implement the new assertions against the distinct recovery outcomes before
changing auth code. The affected user's exact failure can be identified only
from an authorized browser reproduction or privacy-safe outcome information;
do not infer it from this screenshot.
