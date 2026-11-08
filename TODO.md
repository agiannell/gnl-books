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
- [x] CI `test.yml` (push and PR to `main`): install, typecheck, test, and a real `cdk synth` including the esbuild bundle. Verified locally with no AWS credentials, using a fake `cdk.context.json` the workflow writes, then green on GitHub (PR #1): 40 tests passed, the live ones skipped, and the synth really bundled the runner. The first run failed on a `401` from a private mirror in `yarn.lock`; fixed with a project `.yarnrc`, rewritten lockfile URLs, and a CI guard for non-public hosts
- [x] CI `deploy.yml` (manual, `environment: production`, OIDC, repo secret `AWS_DEPLOY_ROLE_ARN`). Verified with a manual run: typecheck, tests, `cdk diff` ("no differences") and `cdk deploy` all passed, so the shared `github-deploy` role can deploy `GnlBooksStack` through the `cdk-*-us-west-2` bootstrap roles. The first attempt failed because the secret had not been set yet. Still untested: a deploy that applies a *new* migration
- [ ] Consider tightening `github-deploy`'s trust from `repo:agiannell/*` to the specific repos or environments. It is shared with other projects, so that is your call

## 1 — Infra skeleton

- [x] `infra` workspace via `cdk init`, Jest swapped for Vitest (one shared runner, per-project config inline in the root `vitest.config.mts`; `jest-autoclean` replaced by `infra/test/setup.ts`). Typecheck, test and `cdk synth` all pass
- [ ] Each new workspace needs a `typecheck` script (the root runs `yarn workspaces run typecheck`, which errors if one is missing) and, for `packages/web`, its own entry in the root `projects` plus an exclusion from the `packages` glob
- [x] **Decided:** `aws-cdk-lib` 2.275.0 has only the L1 `CfnCluster`, but `@aws-cdk/aws-dsql-alpha` has an L2 `Cluster` (experimental). Using the alpha: `yarn add @aws-cdk/aws-dsql-alpha`, kept matched to `aws-cdk-lib`
- [x] DSQL cluster via the alpha `Cluster`, with `Template` tests for the retain policy, deletion protection and name. **Passed `removalPolicy: RETAIN` and `deletionProtection: true` explicitly.** The alpha only defaults deletion protection to true when the `removalPolicy` prop itself is passed; with no prop you get `DeletionPolicy: Retain` but no `DeletionProtectionEnabled` in the template (found in a spike; the docs imply otherwise). Assert both in a `Template` test
- [ ] Run `cdk diff` before every deploy and look for a replacement of `AWS::DSQL::Cluster`, the one failure an alpha API change could cause
- [x] S3 + CloudFront (OAC). SPA routing is a per-behavior CloudFront Function (extensionless paths → `/index.html`), not distribution-wide 403/404 error responses, so the `/graphql` origin added in step 4 never has its errors rewritten into HTML
- [x] A and AAAA records for `books.gnlfamily.com` (zone via `HostedZone.fromLookup`) + ACM cert in us-east-1 via `DnsValidatedCertificate`. It is deprecated and CDK says it will be removed in the next major release; it is isolated in one place in `lib/gnl-books-stack.ts`. Revisit when CDK v3 lands, or bootstrap us-east-1 and use a cross-region `Certificate` stack (documented by CDK, but marked experimental)
- [x] Placeholder SPA deploys and loads over HTTPS. Deployed to the account; verified: `/` and a deep path return the page with a valid cert, `http` redirects, AAAA resolves. A missing asset (`/missing.js`) returns S3's 403 XML, not HTML
- [x] `cdk synth` green in CI (a step in `test.yml`, no AWS access)

## 2 — Schema + `packages/core`

- [x] `packages/core` workspace
- [x] DSQL connection via `@aws/aurora-dsql-node-postgres-connector` (`createDb` in `src/db.ts`). Verified live against the deployed cluster: IAM auth as `admin`, a query and a transaction both ran
- [x] **`withRetry()` / `withTransaction()`** — the only way `core` opens a transaction. The connector reports conflicts as `error.code` `OC000` / `OC001` / `40001` (an earlier assumption that OC001 had another SQLSTATE was wrong), so `isRetryable` reuses its `isOCCError`
- [x] Runner Lambda (`infra/lambda/migrate.ts`) on `triggers.Trigger`, `executeOnHandlerChange: true`, admin connect grant, SQL bundled next to the handler. Verified: stack and handler tests, a real `cdk synth` bundle (loads, exports the handler, contains all 10 migrations), and a `cdk diff` that only adds resources. **Not deployed yet.** The first deploy should log "schema is up to date", since the database is already migrated
- [x] Deployed the runner. Its CloudWatch log shows the Lambda connected to DSQL with its own execution role (IAM auth from inside AWS) and logged "schema is up to date" in about 0.8 s. Still untested: a deploy that applies a *new* migration. The first real migration after this will be that test, so read the log then
- [x] Migration runner (`migrate()` in `packages/core/src/migrate.ts`): one statement per file, each in its own transaction, version recorded in a second one, all idempotent. Tested against a recording fake driver. **Not yet run against the cluster**
- [x] Migrations for the `PLAN.md` schema in `db/migrations/` (written, not yet applied). `CREATE INDEX ASYNC`, random UUIDv4 keys generated in app code. Deviations from the plan, found by checking the DSQL docs: `jsonb` instead of `text[]` (no array columns), and `NO ACTION` instead of `CASCADE` on `shelf_entries` and `progress_events` (3,000-row limit)
- [x] Applied the migrations to the live cluster (all 10, rerun is a no-op). Confirmed on the real cluster: `default now()` / `current_date`, `jsonb` columns, inline `CHECK` (a bad shelf value is rejected with 23514), foreign keys with the intended actions, and both async indexes. Checked inside a rolled-back transaction, so no rows were left behind
- [x] `date` columns parse as plain `YYYY-MM-DD` strings (`typeParsers` in `createDb`): `pg` returns them as JS `Date`s in local time (`date_added` came back as `...T06:00:00.000Z`), which would shift days in the CSV export
- [x] Kysely types generated from the live schema (`packages/core/src/schema.ts` via `kysely-codegen`, command in `CLAUDE.md`). `sys.*` tables excluded; `shelf` and the `source` columns are exact unions matching their `CHECK`s; `jsonb` columns write as JSON text and read as `string[]`. Compile-time checks in `test/schema.test.ts`. Regenerate after every migration
- [x] **Test:** force a concurrent write conflict and prove `withTransaction()` recovers (`packages/core/test/withTransaction.live.test.ts`, skipped unless `DSQL_ENDPOINT` is set). Verified live: five writers race on one row; with plain Kysely some fail with a retryable code, with `withTransaction` all five land and the counter is exactly 5

## 3 — Cognito

- [x] User pool + Hosted UI + web client in CDK (`gnl-books-stack.ts`, 7 `Template` tests, `cdk diff` only adds resources). Admin-created users only (no self sign-up), email sign-in, pool retained with deletion protection, `gnl-books` Cognito prefix domain, public PKCE client with 365-day revocable refresh tokens, callbacks limited to the site and `localhost:5173`. **Written, not deployed.** The Alexa client (step 9) is separate and needs the 3650-day refresh token, since a short expiry silently breaks the link later
- [x] Deployed (PR #2). The `gnl-books` prefix domain was free, the Hosted UI serves the login page, and the OIDC discovery document resolves. First user `agiannell@gmail.com` created with `admin-create-user` (status `FORCE_CHANGE_PASSWORD`, so the temporary-password email has gone out). Admin-only stays, decided against self sign-up
- [ ] Create the second adult user when there is something to sign in to
- [ ] `react-oidc-context` sign-in in the SPA
- [x] First-run bootstrap: `createFamily(familyName, parentName, pin)` creates the family, the first parent profile, and the `accounts` row in one `withTransaction` (`core/src/bootstrap.ts`). Only a signed-in user with no family can call it (`noFamily` scope), and the account linked is the caller's own, from the verified token. Verified live on the real cluster: all three rows land together, a second call is refused with nothing left behind, and three simultaneous calls give exactly one winner. **Not deployed yet**
- [x] Parent PIN: `scrypt` (N=2^15) + `timingSafeEqual`, stored as `families.parent_pin_hash` as `scrypt$N$r$p$salt$hash` so the parameters can change later (`core/src/pin.ts`). 4 to 8 digits. A PIN has at most 10^8 values, so the hash only keeps it out of plain sight in a dump; the real protection is that the API needs a Cognito token
- [ ] `unlockParent(pin)` and how it reaches the API (see step 4); `verifyPin` is ready

## 4 — GraphQL API

- [x] `packages/graphql`: Pothos schema, all logic in `src/schema.ts`. First slice: `me` and `family`. **`graphql` is pinned to 16** (`^16.11.0`): Apollo Server 5 peers on it, and the registry's latest is 17. Fields are non-null by default (`defaultFieldNullability: false`; Pothos defaults to nullable, which a test caught)
- [x] `src/lambda.ts` (`@as-integrations/aws-lambda`, API Gateway v2 handler) and `src/dev.ts` (standalone) as thin wrappers over `src/app.ts`, where the server is assembled. Bundles with esbuild to one `graphql` copy; the handler loads and fails fast on missing env. **Not yet wired into CDK**
- [x] `aws-jwt-verify` in Apollo's `context` → `{ cognitoSub, familyId, isParent }` (`src/context.ts`). Verifies **access** tokens against the web client ID; bad tokens get a generic 401, never the verifier's reason. Tests mock `@gnl-books/core`
- [x] `@pothos/plugin-scope-auth` with `inFamily` and `isParent` scopes. `isParent` is always false for now (see the open question below)
- [x] Every query scoped by `familyId` at the data layer: ids come from the verified context, never an argument (tested: `family(id: ...)` is rejected, and the PIN hash is not exposed)
- [x] **Decided: a short-lived signed unlock token** (not the PIN re-sent on every call). `PLAN.md` says the context carries `isParent`, but the API is stateless and a signed-in kid has the session. `unlockParent(pin)` returns a token, sent in a second header, that sets `isParent`. Parameters: **2-minute sliding lifetime, renewed on each parent action, 15-minute absolute cap**, so the exposure after a parent walks away is at most 2 minutes; the SPA also discards it after about 60 s idle, when the tab is hidden, and on a Lock button. Signed with HS256 via `jose`, bound to the user and family, key in Secrets Manager (about $0.40/month, the one non-free item). A stateless token cannot be revoked server-side; discarding it on the client covers the shared-tablet case, and a `lockParent` revocation record can be added later without changing the API
- [x] **PIN brute-force lockout**: a 4-digit PIN has 10,000 values and the API allows 10 requests/s, so without it a kid with the session could guess it in about 17 minutes. 5 wrong PINs lock `unlockParent` for 15 minutes (the fifth reports `locked`; while locked the PIN is not even checked and the lock is not extended). Two nullable columns on `families` (migrations 0011 and 0012: DSQL rejects `NOT NULL` and `DEFAULT` on `ADD COLUMN`, so null means 0 / not locked). **The columns were deployed on their own first (PR #6), and that was the first real test of the migration trigger on a new migration: the runner log said `applied 2 migration(s)`.** `schema.ts` regenerated from the live schema. The rules are a pure function (`decideUnlock`, unit-tested); `attemptParentUnlock` wraps it in a transaction and returns a result for every outcome instead of throwing, since a throw would roll back the failure count. Verified live, repeated 6 times: five simultaneous wrong guesses are each counted exactly once (remaining 4, 3, 2, 1 and exactly one lock), the right PIN is refused while locked and accepted after, and success resets the count
- [x] `unlockParent(pin)` (`PIN_INCORRECT` with `attemptsRemaining`, `PIN_LOCKED` with `retryAt`, a malformed PIN is `BAD_USER_INPUT` and not counted) and `renewParentUnlock` (parent-only, keeps the original start so the cap still counts from the PIN). Token in `src/parentToken.ts` (`jose`, HS256, issuer and audience pinned, bound to the user and family, 2-minute sliding, 15-minute cap), read from the `X-Parent-Token` header into the context; an expired, forged, or someone else's token just means not a parent. Mutation-checked: removing the user binding, the family binding, or the cap each fails the intended tests. End-to-end through the real Apollo server: a token does not work for a different user in the same family or for a different family
- [x] The signing key is a generated Secrets Manager secret, read only by the API function, fetched on first use so requests without a token never wait for it. **Written, not deployed.** The deploy also re-runs the migration runner (it bundles `core`, which changed), which should log "schema is up to date"
- [ ] After deploying: a live signed-in test of `unlockParent` (wrong PIN, right PIN, `renewParentUnlock` with and without the header) with a throwaway user, cleaning up its rows
- [ ] A signed-in family member can lock the parents out for 15 minutes by guessing wrong five times. An unlocked parent can still renew, so only a new unlock is blocked. Accepted for now; worth revisiting if it ever happens
- [x] CDK: the GraphQL Lambda (Node 24, 512 MB, env `DSQL_ENDPOINT` / `USER_POOL_ID` / `USER_POOL_WEB_CLIENT_ID`), an HTTP API with `GET` and `POST /graphql` only, throttled to 10 rps / burst 20, and `grantConnectAdmin` until custom roles exist. 4 new `Template` tests; `cdk diff` only adds resources and updates the distribution in place. **Not deployed.** The API is public by design: the function verifies the Cognito token. CloudFront origin access control was rejected because it makes POST callers send a SHA-256 of the body in a header, which a browser GraphQL client cannot
- [x] Access contract for the public endpoint, tested through the real Apollo server (`packages/graphql/test/access.test.ts`): no token, a forged token, or a malformed header gets a 401 with no `data`, introspection included. Apollo's landing page is disabled, since it was served to browsers before the token check
- [x] Deployed (PR #3). Live checks through CloudFront: no token, a forged token and introspection all get a 401 with no data, and the SPA still loads. The live errors included **stack traces** (Apollo only omits them when `NODE_ENV` is `production`, which a Lambda does not set); fixed with `includeStacktraceInErrorResponses: false` and a test that builds the server with `NODE_ENV` unset (it fails without the fix). Fix deployed (PR #4), and the unauthenticated response is now just the 401 JSON. **Verified live, signed in** with a throwaway test user (created without an invitation email, deleted afterwards): Hosted UI login with authorization code + PKCE on the real web client, code exchange, then `me` returned `familyId: null` from the real cluster through the API Lambda, CloudFront and DSQL. `family` is refused until a family exists. The web client allows no direct password or SRP flow (`ExplicitAuthFlows` is empty), so the Hosted UI code flow is the only way in
- [x] A refused field is now `FORBIDDEN`, not `INTERNAL_SERVER_ERROR` (seen live on `family` before bootstrap), so the SPA can tell "not allowed" from "the server broke". Also found by a test: for an unexpected error Apollo returned the raw message (for example a database host in `ECONNREFUSED ...`); `formatError` now masks it as "Internal server error" and logs the original. Intentional errors (`BAD_USER_INPUT`, `CONFLICT`, `FORBIDDEN`) pass through as written
- [x] CloudFront second origin at `/graphql`: its own behavior with no SPA rewrite function, caching disabled, HTTPS only, all viewer headers except Host forwarded (so `Authorization` arrives). Same domain, no CORS
- [x] Bootstrap deployed (PR #5) and verified live, signed in through the Hosted UI as a throwaway Cognito user: `me` and `family` before (null / `FORBIDDEN`), a bad PIN is `BAD_USER_INPUT`, no token is 401, `createFamily` succeeds (names trimmed), a second call is `FORBIDDEN` (the `noFamily` scope refuses it; `CONFLICT` is only the race path), `me` and `family` after return the new family, and `parentPinHash` is not queryable. Its rows and the user were removed afterwards; all three tables are back to 0 rows
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
