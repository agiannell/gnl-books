# HANDOFF

Written 2026-11-12 for whoever (or whichever Claude account) picks this project up next. The earlier Claude account's memory does not carry over, so what it knew is written down here. Read this, then the root `CLAUDE.md`, then the `CLAUDE.md` in the workspace you are touching. `TODO.md` is the checklist, `PLAN.md` is the original design, `REVIEW_SUMMARY.md` / `REVIEW_TODO.md` are the latest review and the work it produced.

## What this is, and where it stands

A private family reading tracker at **https://books.gnlfamily.com** (AWS `us-west-2`): a React SPA, a GraphQL Lambda, Aurora DSQL, Cognito. Adults sign in; kids are profiles. It is **deployed and working**. Everything through PR #43 is merged and deployed:

- shelves, search (Hardcover), manual add, book page (rating, review, progress, finish), reading goals, CSV export in Goodreads' format, time zone, parent PIN gate, a Settings page (readers, join requests, goals, time zone, export);
- Radix Themes UI, favicon and apple-touch icon, search relevance ranking, remove-from-shelf;
- the API connecting as a **limited database role**, not `admin`;
- **open sign-up**: a new user makes a family or asks to join one by naming a parent's email; the parent approves or denies in Settings behind the PIN; a denied requester is told.

Unfinished, in rough priority order (details and sizes in `REVIEW_TODO.md`): the P0 list (search "add" moves already-shelved books; expired sessions show raw errors; kids can lock the parent PIN from a book page; web TypeScript not strict; old-Safari crash risk), hardcoded config, alarms/backups, UX gaps, docs cleanup.

**Not yet verified live:** approving a join request (tested only in automated tests), and the "Request declined" screen after a deny (the API and migration are deployed; the user planned to click through it).

**Repo state at writing:** `main` matches production for code. It also includes the review docs, this file, the READMEs and the workspace `CLAUDE.md` files (PR #44, docs only, nothing to deploy).

## Decisions already made (do not reopen without a reason)

- **Alexa skill, voice-linking in Settings, and the Echo Show widget are shelved** (2026-11-10): voice does not work for kids' voices or kids' devices. Designs stay in `PLAN.md`. Remnants in the code and database (`alexa_devices`, `alexa_person_id`, `ProgressSource` ALEXA/WIDGET) are on the cleanup list. Do not list Alexa work as next steps.
- **No Goodreads import acceptance test.** The CSV export is a pass-through of Goodreads' columns; if a future import fails, adjust then.
- **The shared `github-deploy` IAM role's trust policy stays as is** (it is shared with other projects; the owner chose not to tighten it).
- **Sign-up is open on purpose**, so the app can be shown to others. Joining a family needs a parent's approval behind the PIN. Safeguards: `MAX_FAMILIES` = 100, 5 open requests per family, requests last 7 days, and asking never reveals whether an email belongs to a family.
- **The web UI is Radix Themes with plain CSS**, because the CSP forbids inline `<style>` and nonces are impossible on static CloudFront. No CSS-in-JS; avoid Radix portals/scroll-lock components.
- **The API reads the caller's email from Cognito (`AdminGetUser`)**, because the access token it verifies has none. Never trust an email from the client.
- **Latest major versions by default**, with a stated reason for any pin (TypeScript `~6.0.3`, `@types/node` 24, React Router 8.5.1).
- **No id or email from the client is trusted.** Identity comes from the verified token and the database, and every query is scoped by `familyId` in the data layer.

## How the owner likes to work with Claude

- **Ask before anything outward-facing:** deploying, pushing, opening PRs, creating AWS resources, sending email, deleting data. The usual loop is: branch, implement with tests (and mutation checks), update docs, the owner says "commit and open PR", the owner merges and **deploys themselves**, then Claude verifies live from logs.
- **Brief what/why above every file edit.** Use the Write/Edit tools for file contents, never shell heredocs or redirects (shell is for commands, git and scaffolders). One file per call.
- **Install with `yarn add`** (never hand-typed versions), and use official scaffolders. For a workspace add use `--registry https://registry.npmjs.org` (see the registry trap below).
- **Skip Snyk scans in this repo.** The owner's global instructions say to scan, but they apply only to work repos under `~/pluralsight`; here, skip silently.
- **Keep the repo free of AWS account ids, hosted-zone ids and personal details** (it is public). Use placeholders; tests use the fake account `111111111111`.
- **Critical examination:** say what is wrong or risky rather than agreeing. Report failures with output; state what was skipped. Mutation-check tests (break the code, see it fail, restore).
- Commit messages and PR descriptions end with the attribution lines the session specifies.

## Access and environment

- **AWS:** `zsh -ic 'assume agiannell >/dev/null 2>&1; <aws or cdk command>'`. Each Bash call is a fresh shell, so the `assume` goes inside every call. Prefer `--query` so account ids are never printed. Read-only calls are fine; ask before anything that changes the account.
- **An auto-mode permission classifier may refuse** applying migrations to the production cluster, creating a scratch DSQL cluster, and granting IAM changes. Do not work around it. The tested alternative for database work is a **throwaway local Postgres** (recipe in `packages/core/CLAUDE.md`): it reproduces the cluster's generated `schema.ts` exactly and runs `joinRequests.live.test.ts`. Migrations reach production through the deploy's runner.
- **GitHub CLI** (`gh`) is authenticated as the repo owner. `gh auth refresh -h github.com -s user` is needed only for billing endpoints.
- **Yarn registry trap:** Yarn 1 in a workspaces repo ignores the project `.npmrc` and reads `~/.yarnrc`, which on the owner's machine points at a private Artifactory mirror. The project `.yarnrc` fixes root commands; a `yarn workspace <ws> add` still needs `--registry https://registry.npmjs.org`. CI fails the build if `yarn.lock` contains a non-public host. A workspace `add` can also leave `node_modules` without vitest; `yarn install --frozen-lockfile` restores it.
- **Node 24.12 locally**; `jsdom` 31 needs 24.15+, so the web tests use happy-dom.

## State that lives outside the repo

- **Secrets Manager `gnl-books/app`** (hand-made, never touched by CDK): JSON with key `hardcoverApiKey`, the Hardcover token. Never put the token through chat or the repo. The API cannot work without this secret. **`gnl-books/cdk`** is stack-owned (`parentTokenKey`, the PIN-unlock signing key).
- **GitHub:** repo secret `AWS_DEPLOY_ROLE_ARN` (contains the account id), environment `production`, workflows `test.yml` (on push/PR) and `deploy.yml` (manual only).
- **Cognito user pool** `gnl-books` (RETAIN, deletion protection): two real adult users, plus a throwaway test sign-up made while testing join requests. **Delete that test user** (it has no family or data) once the owner has finished testing. A user created by hand (`admin-create-user`) with no `accounts` row would bootstrap its **own** family on first sign-in; link such a user with one `accounts` row (their `sub`, the family id) instead.
- **Cognito ids are duplicated by hand** into `packages/web/src/config.ts`. If the pool or client is ever recreated, update that file.
- **`infra/cdk.context.json`** is gitignored (its keys contain the account id). Synth recreates it with a Route 53 lookup.
- The DSQL cluster is the only copy of the data; there is **no backup plan yet** (it is on the P1 list). The cluster and the pool are RETAIN with deletion protection.

## Deploy and verify

1. Merge to `main`. `test.yml` runs on push.
2. The owner starts **Actions → Deploy → Run workflow** (typecheck, tests, web build, `cdk diff`, `cdk deploy`, about 3 minutes). Local fallback: `yarn typecheck && yarn test && yarn build:web && cd infra && yarn cdk diff && yarn cdk deploy` under `assume`.
3. Verify from logs (no sign-in needed): the migration runner's log (`/aws/lambda/<MigrationRunner function>`) shows `applying NNNN_…` and `applied N migration(s)`; the API function's log has no `ERROR`/`denied`/`42501`/`AccessDenied`; the API role's policy has `dsql:DbConnect` (not admin). Anything needing a signed-in user (the browser flows) the owner checks and reports.
4. A new migration is applied by the runner on deploy, so the API briefly runs old code against the new schema; write migrations additively (nullable columns, new tables).

Incident to know about: on 2026-11-11 a GitHub Actions outage left runs queued with no jobs for hours and ended one Deploy in `startup_failure`; the workflow files were fine. If a deploy "doesn't start", check githubstatus.com and `gh run list` before suspecting the workflow, then re-run once healthy.

## Gotchas learned the hard way

- DSQL: one DDL statement per transaction and per migration file; `create index async`; `GRANT USAGE ON SCHEMA public` is unsupported (and not needed); transactions re-run on conflicts, so they must be idempotent; count-then-insert caps can overshoot slightly.
- Temporary STS credentials come back **tab-separated**; splitting them on spaces silently produces a bad token (this once looked like a DSQL limitation).
- Apollo: a `family { … }` query without `id` replaces the cached object, and a fake reply missing a queried field returns no data. Refetching must not swap a page for a spinner (it resets the screen).
- `type="email"` inputs block submit with the browser's own message; the join form uses `noValidate` so the app's message shows.
- Tests that mock `@gnl-books/core` by name exist in three files in `packages/graphql/test`; a new core import must be added to all three mocks.
- Mutation checks need care: macOS `sed` lacks the `0,/re/` address form (the mutation silently does nothing, so check the file changed), and a mutation that a test cannot observe means the test is weak, not that the code is fine.
- `Intl.supportedValuesOf` is used at import time in the web app and in core (`TIMEZONES`).
- The two zsh traps in this setup: `$VAR` holding a command with arguments is not word-split (use a function), and `$ACCT:cluster` is read as a modifier (use `${ACCT}`).

## Suggested first steps

1. Read `REVIEW_SUMMARY.md` section 2 (the top 10) and pick from the P0 list in `REVIEW_TODO.md`. Do them as small PRs, one per item.
2. Ask the owner whether they verified approving a join request and the "Request declined" screen.
3. Clean up the throwaway Cognito test user once the owner says testing is done.
4. When touching web code, first read `packages/web/CLAUDE.md` (CSP limits, cache rules, test fixtures); for API changes, `packages/graphql/CLAUDE.md` (the three mock files).
