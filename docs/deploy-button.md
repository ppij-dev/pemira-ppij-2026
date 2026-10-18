# Deploy to Cloudflare button and `APP_MASTER_KEY`

Research from task 1.1 (2026-10-18). Sources: official Cloudflare docs,
<https://developers.cloudflare.com/workers/platform/deploy-buttons/> (last updated 2026-10-12)
and the changelog entry of 2025-07-29 ("Deploy to Cloudflare buttons now support Worker
environment variables, secrets, and Secrets Store secrets").

## Verified (documented by Cloudflare)

- The button clones this repo into the deployer's GitHub/GitLab account, builds via Workers
  Builds, and deploys; resources declared in `wrangler.jsonc` are provisioned automatically
  and their IDs are rewritten in the cloned copy. D1 and R2 are both supported, so `DB`
  (D1) and `MEDIA` (R2) need no manual creation.
- **Worker secrets are prompted for.** Secrets listed in a `.dev.vars.example` (or
  `.env.example`) file in dotenv format are presented to the deploying user in the dashboard
  during setup. We therefore ship `.dev.vars.example` with `APP_MASTER_KEY=`.
- An optional per-binding description can be set in `package.json` under
  `cloudflare.bindings.<NAME>.description`; ours explains generating the key with
  `openssl rand -base64 32`.
- D1 migrations should run inside the `deploy` script using the binding name
  (`wrangler d1 migrations apply DB --remote`); our `deploy` script does this.
- Limitations: only public github.com/gitlab.com repos; no Pages projects; monorepos are
  not fully supported (not relevant for this repo root layout).

## Consequence for the design (design.md decision 2)

The fallback "generate `APP_MASTER_KEY` on first boot and store it in `system_config`"
remains as a safety net for deploys where the value was left empty, but the button path
makes the secret a first-class input.

## Unverified / needs a real Cloudflare account

- We could not execute the actual deploy flow on a Cloudflare account in this task, so it is
  unconfirmed that the prompt renders exactly as documented for this repo (docs-verified,
  not exercised).
- Unverified: whether an empty value in `.dev.vars.example` still triggers the prompt
  (docs show a filled example value, `COOKIE_SIGNING_KEY=my-secret`).
- Unverified: the newer wrangler `secrets` config property (declaring required secret names
  loaded from `.dev.vars`/`.env` for local dev) is not mentioned in the deploy-button docs as
  a prompt mechanism, so we did not rely on it. If a later test account run shows the button
  honors it, `wrangler.jsonc` can adopt it.
- Task 1.1 also asks to verify on a test account that the button provisions D1 and R2 —
  still open until someone with an account runs the button.
