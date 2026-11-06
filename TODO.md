# TODO.md

Work tracker for the family library. `PLAN.md` is the design, `CONTEXT.md` is the session handoff; this file is the checklist.

Two deliberate departures from `PLAN.md`'s build sequence are baked in below:

- **The migration runner moves from step 1 to step 2.** It needs the DSQL connection from `packages/core`, which doesn't exist in step 1.
- **Alexa drops from step 8 to optional, after the widget.** Voice turned out to be adult-only (kids are refused in Amazon Kids mode), so it mostly serves the people who already have the web app.

Verify every package version against the registry (`npm view <pkg>`) as it's added, and correct `PLAN.md` when it's wrong.

---

## 0 — Scaffold

- [x] Root scaffold: `.nvmrc`, `.npmrc`, `.gitignore`, `package.json`, tsconfigs, `vitest.config.ts`
- [x] `CLAUDE.md`
- [x] Commit the scaffold, `CLAUDE.md`, and the `PLAN.md` / `CONTEXT.md` voice-finding edits (pushed)
- [ ] CI: `.github/workflows/`, OIDC role `github-deploy`, typecheck + test on PR. `vitest run` exits 1 when no tests exist, so account for that until each workspace has some

## 1 — Infra skeleton

- [x] `infra` workspace via `cdk init`, Jest swapped for Vitest (one shared runner, per-project config inline in the root `vitest.config.mts`; `jest-autoclean` replaced by `infra/test/setup.ts`). Typecheck, test and `cdk synth` all pass
- [ ] Each new workspace needs a `typecheck` script (the root runs `yarn workspaces run typecheck`, which errors if one is missing) and, for `packages/web`, its own entry in the root `projects` plus an exclusion from the `packages` glob
- [x] **Decided:** `aws-cdk-lib` 2.275.0 has only the L1 `CfnCluster`, but `@aws-cdk/aws-dsql-alpha` has an L2 `Cluster` (experimental). Using the alpha: `yarn add @aws-cdk/aws-dsql-alpha`, kept matched to `aws-cdk-lib`
- [x] DSQL cluster via the alpha `Cluster`, with `Template` tests for the retain policy, deletion protection and name. **Passed `removalPolicy: RETAIN` and `deletionProtection: true` explicitly.** The alpha only defaults deletion protection to true when the `removalPolicy` prop itself is passed; with no prop you get `DeletionPolicy: Retain` but no `DeletionProtectionEnabled` in the template (found in a spike; the docs imply otherwise). Assert both in a `Template` test
- [ ] Run `cdk diff` before every deploy and look for a replacement of `AWS::DSQL::Cluster`, the one failure an alpha API change could cause
- [x] S3 + CloudFront (OAC). SPA routing is a per-behavior CloudFront Function (extensionless paths → `/index.html`), not distribution-wide 403/404 error responses, so the `/graphql` origin added in step 4 never has its errors rewritten into HTML
- [x] A and AAAA records for `books.gnlfamily.com` (zone via `HostedZone.fromLookup`) + ACM cert in us-east-1 via `DnsValidatedCertificate`. It is deprecated and CDK says it will be removed in the next major release; it is isolated in one place in `lib/gnl-books-stack.ts`. Revisit when CDK v3 lands, or bootstrap us-east-1 and use a cross-region `Certificate` stack (documented by CDK, but marked experimental)
- [x] Placeholder SPA deploys and loads over HTTPS. Deployed to the account; verified: `/` and a deep path return the page with a valid cert, `http` redirects, AAAA resolves. A missing asset (`/missing.js`) returns S3's 403 XML, not HTML
- [ ] `cdk synth` green in CI

## 2 — Schema + `packages/core`

- [x] `packages/core` workspace
- [x] DSQL connection via `@aws/aurora-dsql-node-postgres-connector` (`createDb` in `src/db.ts`). Verified live against the deployed cluster: IAM auth as `admin`, a query and a transaction both ran
- [x] **`withRetry()` / `withTransaction()`** — the only way `core` opens a transaction. The connector reports conflicts as `error.code` `OC000` / `OC001` / `40001` (an earlier assumption that OC001 had another SQLSTATE was wrong), so `isRetryable` reuses its `isOCCError`
- [ ] `db/migrations/` + runner Lambda on `triggers.Trigger`, `executeOnHandlerChange: true`
      One DDL per transaction, DDL separate from DML, retry `OC001`, `schema_migrations` table
- [x] Migration runner (`migrate()` in `packages/core/src/migrate.ts`): one statement per file, each in its own transaction, version recorded in a second one, all idempotent. Tested against a recording fake driver. **Not yet run against the cluster**
- [x] Migrations for the `PLAN.md` schema in `db/migrations/` (written, not yet applied). `CREATE INDEX ASYNC`, random UUIDv4 keys generated in app code. Deviations from the plan, found by checking the DSQL docs: `jsonb` instead of `text[]` (no array columns), and `NO ACTION` instead of `CASCADE` on `shelf_entries` and `progress_events` (3,000-row limit)
- [x] Applied the migrations to the live cluster (all 10, rerun is a no-op). Confirmed on the real cluster: `default now()` / `current_date`, `jsonb` columns, inline `CHECK` (a bad shelf value is rejected with 23514), foreign keys with the intended actions, and both async indexes. Checked inside a rolled-back transaction, so no rows were left behind
- [x] `date` columns parse as plain `YYYY-MM-DD` strings (`typeParsers` in `createDb`): `pg` returns them as JS `Date`s in local time (`date_added` came back as `...T06:00:00.000Z`), which would shift days in the CSV export
- [x] Kysely types generated from the live schema (`packages/core/src/schema.ts` via `kysely-codegen`, command in `CLAUDE.md`). `sys.*` tables excluded; `shelf` and the `source` columns are exact unions matching their `CHECK`s; `jsonb` columns write as JSON text and read as `string[]`. Compile-time checks in `test/schema.test.ts`. Regenerate after every migration
- [x] **Test:** force a concurrent write conflict and prove `withTransaction()` recovers (`packages/core/test/withTransaction.live.test.ts`, skipped unless `DSQL_ENDPOINT` is set). Verified live: five writers race on one row; with plain Kysely some fail with a retryable code, with `withTransaction` all five land and the counter is exactly 5

## 3 — Cognito

- [ ] User pool + Hosted UI, PKCE, long refresh tokens (up to 3650 days — short expiry silently breaks the Alexa link later)
- [ ] `react-oidc-context` sign-in in the SPA
- [ ] First-run bootstrap: first user with no `accounts` row creates the family + parent profile, sets the PIN
- [ ] Parent PIN: `scrypt` + `timingSafeEqual`, stored as `families.parent_pin_hash`

## 4 — GraphQL API

- [ ] `packages/graphql`: Pothos schema, all logic in `src/schema.ts`
- [ ] `src/lambda.ts` (`@as-integrations/aws-lambda`, API Gateway v2 handler) and `src/dev.ts` (standalone) as thin wrappers
- [ ] `aws-jwt-verify` in Apollo's `context` → `{ cognitoSub, familyId, isParent }`
- [ ] `@pothos/plugin-scope-auth` for `isParent` gating
- [ ] Every query scoped by `familyId` at the data layer
- [ ] CloudFront second origin at `/graphql` (no CORS)
- [ ] `graphql-codegen` wired into the web build

## 5 — Hardcover `BookSource`

- [ ] `BookSource` interface + `hardcover.ts`, PAT in Secrets Manager
- [ ] Defensive guard over the untyped Typesense `results` — warn and drop malformed entries
- [ ] Cache every touched book into the `books` table
- [ ] Manual-add path for anything search can't find
- [ ] Note the PAT expiry date somewhere durable

## 6 — Shelves in the SPA

- [ ] **Decide:** React Router v7 (per `PLAN.md`) or 8.5.1 (current major, needs Node >= 22.22). What changed in 8 is unchecked
- [ ] `packages/web` via `create-react-router`, framework mode, `ssr: false`
- [ ] Routes: `/`, `/p/:profileId`, `/p/:profileId/book/:bookId`, `/search`, `/settings`
- [ ] Ratings, reviews, dates, progress, goal ring
- [ ] Touch-first and responsive — it doubles as the Echo Show browser fallback

## 7 — CSV export

- [ ] `packages/core/csv.ts`, full Goodreads header in order
- [ ] Both `Bookshelves` and `Exclusive Shelf` populated (works around the Goodreads import bug)
- [ ] `YYYY/MM/DD` dates, `My Rating` `0` when unrated, plain ISBNs, `Author l-f`
- [ ] `exportGoodreadsCsv` mutation, parent-PIN gated
- [ ] **Acceptance test: import the real file into a throwaway Goodreads account.** This is the project's premise — do it here, not months later

> **The app is worth using after step 7.** Everything below is additive.

## 8 — Widget spike (Echo Show 15)

- [ ] Hello-world APL widget renders in the Widget Gallery on the actual device
- [ ] Only if that works: current book, progress bar, goal ring; Data Store REST API updater; `SendEvent` on tap

## 9 — Alexa skill (optional)

- [ ] Account linking against the same Cognito pool (`pitangui.amazon.com`, `layla.amazon.com` callbacks)
- [ ] `alexa::person_id:read` in the **checked-in** manifest — an `ask deploy` can otherwise strip it silently
- [ ] Reader resolution: `personId`, else ask once per session, cached in session attributes. Never guess
- [ ] The seven intents; book slot is `AMAZON.SearchQuery` fuzzy-matched against that person's own shelf
- [ ] CDK grants `alexa-appkit.amazon.com` invoke, scoped by `eventSourceToken`

---

## Open questions

- [ ] React Router v7 vs 8 (blocks step 6)
- [ ] Echo Show 15 widget feasibility (that's what step 8's spike is for)
- [ ] Confirm in CloudWatch that a Kids-mode refusal never reaches the Lambda — expected, low stakes
- [ ] Whether a development-stage skill needs a privacy policy URL for `personId` (not needed in the spike; publishing would require one)

## Settled

- Voice is adult-only. A child got the generic refusal on an adult-profile Dot; an adult saying the same phrase on the same Dot was recognized, with `personId` and `deviceId` present
- `personId` works for adults once the skill declares Skills Personalization
- `alexa_devices` is demoted to labelling only — not part of reader resolution
- DSQL in CDK: use the alpha L2 `Cluster` from `@aws-cdk/aws-dsql-alpha`. It provides `grantConnect` / `grantConnectAdmin` and defaults to Retain. Still open for step 2: which grant the app Lambdas get, and how DSQL custom database roles work
- No Goodreads API. CSV export is the migration path
- TypeScript held at `~6.0.3`; `@types/node` pinned to 24 to match the Lambda runtime
