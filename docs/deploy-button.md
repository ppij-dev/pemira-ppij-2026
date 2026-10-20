# Deploy to Cloudflare button, environment variables, and `APP_MASTER_KEY`

Research from task 1.1 (2026-10-18), task 5.7 (2026-10-21), and task 5.9 (2026-10-21).
Sources:
- Cloudflare Workers documentation: <https://developers.cloudflare.com/workers/platform/deploy-buttons/> (last updated 2026-10-12).
- Cloudflare Developer Platform Changelog: 2025-07-29 ("Deploy to Cloudflare buttons now support Worker environment variables, secrets, and Secrets Store secrets", <https://developers.cloudflare.com/changelog/post/2025-07-01-workers-deploy-button-supports-environment-variables-and-secrets/>).

## Verified (documented by Cloudflare)

- **Repository cloning and provisioning**: The button clones this repo into the deployer's GitHub/GitLab account, builds via Workers Builds, and deploys. Resources declared in `wrangler.jsonc` are provisioned automatically and their IDs are rewritten in the cloned copy. D1 is supported, so `DB` (D1) needs no manual creation prior to deployment. Only D1 is provisioned and used: unused adapter KV sessions and Images bindings are disabled (`session: false` and `imageService: "passthrough"` in `astro.config.mjs`), so no KV namespaces or Cloudflare Images bindings are created or needed. (R2 is not used in 1.0; candidates show the shared `/placeholder-candidate.png` under `public/`, and only the site logo is configurable via `SITE_LOGO_PATH` using an absolute same-origin path starting with `/`).
- **Deploy button badge snippet**:
  ```markdown
  [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ppij-dev/ppij-election-system)
  ```
  Image source `https://deploy.workers.cloudflare.com/button`, link target `https://deploy.workers.cloudflare.com/?url=<repo_url>`.
- **Deploy to Cloudflare Button flow (`https://deploy.workers.cloudflare.com/?url=...`)**: Cloudflare launches the deploy-button wizard. Per official documentation, it clones the repository to the user's Git account, automatically provisions required storage resources (only D1 `DB`) with newly generated IDs, prompts the user for secrets parsed from `.dev.vars.example` (`ONELOGIN_CLIENT_SECRET`, `SERVICE_API_CLIENT_SECRET`, `APP_MASTER_KEY`) as masked inputs, displays `vars` from `wrangler.jsonc`, and initiates Workers Builds. When `deploy` is specified in `package.json`, Cloudflare pre-populates it so migrations run before deploy (`wrangler d1 migrations apply DB --remote && wrangler deploy`).
- **Worker secrets vs environment variables mechanism**:
  - **Worker secrets (`secrets`)**: Defined in `.dev.vars.example` (or `.env.example`) in dotenv format. The Cloudflare Deploy button dashboard treats keys listed here as Worker secrets, prompting the user and masking values (dots/password input). When all settings were previously listed in `.dev.vars.example`, all settings were masked.
  - **Worker environment variables (`vars`)**: Defined in `wrangler.jsonc` under top-level `"vars": { ... }`. As documented in the 2025-07-29 changelog, environment variables and secrets are both presented in the dashboard during deployment so users can configure each value. Because `vars` are plain environment variables, they are not masked as secrets.
- **Source of truth for configuration**: As documented by Cloudflare (<https://developers.cloudflare.com/workers/wrangler/configuration/> "Source of truth"), the Wrangler configuration file is the authoritative source of truth for Worker settings. Any environment variables (`vars`) edited in the Cloudflare dashboard are overwritten by subsequent `wrangler deploy` executions or automated Workers Builds. Therefore, non-secret variables must be edited directly in `wrangler.jsonc` in the deployer's forked repository and committed/pushed. Only the 3 secrets (`ONELOGIN_CLIENT_SECRET`, `SERVICE_API_CLIENT_SECRET`, `APP_MASTER_KEY`) are managed in the Cloudflare dashboard or via `wrangler secret put`.
- **Per-binding descriptions**: Supported for both secrets and environment variables via `package.json` under `cloudflare.bindings.<NAME>.description`. Markdown backticks and links are supported.
- **Configuration split**:
  - Masked secrets (in `.dev.vars.example`): `ONELOGIN_CLIENT_SECRET`, `SERVICE_API_CLIENT_SECRET`, `APP_MASTER_KEY`.
  - Visible environment variables (in `wrangler.jsonc` `vars`): `ONELOGIN_ISSUER`, `ONELOGIN_CLIENT_ID`, `SERVICE_API_URL`, `SERVICE_API_CLIENT_ID`, `SITE_SCOPE`, `SITE_BASE_URL`, `SITE_NAME`, `SITE_LOGO_PATH`.
  - Local development: `.dev.vars.local.example` contains all 11 keys (with local development defaults such as `http://localhost:4321` and `/ppij/okayama`) to copy to `.dev.vars` for local Miniflare and local bootstrap.
- **D1 Migrations**: Executed via the `deploy` script using the binding name (`wrangler d1 migrations apply DB --remote`), which Cloudflare detects and runs.
- **Limitations**: Public GitHub/GitLab repositories only; no Pages projects; monorepos not fully supported (not applicable to this repo).

## Consequence for the design (design.md decision 2)

The fallback "generate `APP_MASTER_KEY` on first boot and store it in `system_config`" remains as a safety net if a deploy somehow leaves the secret unset, but the button prompt and `.dev.vars.example` make the secret a first-class input.

## Unverified / needs a real Cloudflare account

- We could not execute the actual deploy flow on a live Cloudflare account in this task (docs-verified, not exercised).
- Unverified: The exact visual rendering of `vars` in the dashboard deploy form (whether each variable in `"vars"` appears as an editable prefilled text input field during setup, or whether some dashboard versions expect post-deploy configuration). Cloudflare's 2025-07-29 changelog states: *"These secrets and environment variables will be presented to users in the dashboard as they deploy this template, allowing them to configure each value."*
- Unverified: When a user changes a `vars` value in the deploy form, whether Cloudflare commits that change directly into `wrangler.jsonc` in the newly created Git repository or sets an environment variable override in the Cloudflare dashboard. Safe fallback: operators must verify and edit `wrangler.jsonc` in their repository fork post-deploy, committing and pushing real values to avoid dashboard overwrites on future builds.
- Unverified: Whether an empty value in `.dev.vars.example` (`KEY=`) properly renders an empty input field in the dashboard form or whether a non-empty placeholder value is required (docs show `COOKIE_SIGNING_KEY=my-secret`).
- Unverified: Whether inline markdown links in `package.json` `cloudflare.bindings.<NAME>.description` render as clickable links in the dashboard modal.
- Unverified on a live account: Automatic provisioning of D1 with ID rewriting during the automated build.
- Unverified: Whether the repository cloned by the Deploy to Cloudflare button retains an active GitHub fork relationship (showing "forked from ppij-dev/ppij-election-system" with the GitHub "Sync fork" UI button enabled) or creates a standalone/detached repository copy in the user's account. Because this is unverified, documentation recommends chapters add a manual `upstream` remote (`git remote add upstream https://github.com/ppij-dev/ppij-election-system.git`) when syncing updates.
- Unverified / Inferred: Dashboard "Import a repository" (Workers Builds) behavior. Cloudflare documentation does not cover the deploy-button onboarding for standard repository imports. In standard Workers Builds import, Cloudflare defaults the deploy command to `npx wrangler deploy` (<https://developers.cloudflare.com/workers/ci-cd/builds/configuration/>), does not invoke deploy-button secret prompts from `.dev.vars.example`, and does not automatically provision D1 storage (inferred from placeholder `database_id` requirements). Operators importing via dashboard must create D1 manually, set the 3 secrets in Settings > Variables and Secrets, and either set the Deploy command to `npm run deploy` or apply D1 migrations manually.
