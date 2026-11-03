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
- [ ] Commit the scaffold, `CLAUDE.md`, and the `PLAN.md` / `CONTEXT.md` voice-finding edits
- [ ] CI: `.github/workflows/`, OIDC role `github-deploy`, typecheck + test on PR

## 1 — Infra skeleton

- [ ] `infra` workspace via `cdk init`, then swap Jest for Vitest
- [ ] **Decide:** does `aws-cdk-lib` (2.275.x) have an L1/L2 construct for Aurora DSQL? If not, `CfnCluster` or a custom resource. Do this before writing the stack
- [ ] DSQL cluster, `RemovalPolicy.RETAIN`
- [ ] S3 + CloudFront (OAC), 403/404 → `/index.html`
- [ ] Route 53 record for `books.gnlfamily.com` + ACM cert (us-east-1 for CloudFront)
- [ ] Placeholder SPA deploys and loads over HTTPS
- [ ] `cdk synth` green in CI

## 2 — Schema + `packages/core`

- [ ] `packages/core` workspace
- [ ] DSQL connection via `@aws/aurora-dsql-node-postgres-connector` (disposable connections, IAM token rotation)
- [ ] **`withRetry()`** — the only way `core` opens a transaction; handles `40001` / `OC000` / `OC001`
- [ ] `db/migrations/` + runner Lambda on `triggers.Trigger`, `executeOnHandlerChange: true`
      One DDL per transaction, DDL separate from DML, retry `OC001`, `schema_migrations` table
- [ ] Migrations for the `PLAN.md` schema. `CREATE INDEX ASYNC`, random UUIDv4 keys generated in app code
- [ ] Kysely types generated from the live schema
- [ ] **Test:** force a concurrent write conflict and prove `withRetry()` recovers. Easy to get wrong, hard to notice later

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
- [ ] Aurora DSQL construct support in `aws-cdk-lib` (blocks step 1)
- [ ] Echo Show 15 widget feasibility (that's what step 8's spike is for)
- [ ] Confirm in CloudWatch that a Kids-mode refusal never reaches the Lambda — expected, low stakes
- [ ] Whether a development-stage skill needs a privacy policy URL for `personId` (not needed in the spike; publishing would require one)

## Settled

- Voice is adult-only. A child got the generic refusal on an adult-profile Dot; an adult saying the same phrase on the same Dot was recognized, with `personId` and `deviceId` present
- `personId` works for adults once the skill declares Skills Personalization
- `alexa_devices` is demoted to labelling only — not part of reader resolution
- No Goodreads API. CSV export is the migration path
- TypeScript held at `~6.0.3`; `@types/node` pinned to 24 to match the Lambda runtime
