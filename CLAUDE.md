# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

- `PLAN.md` is the design (schema, API, auth, Alexa, build order). `CONTEXT.md` is the handoff: current status, open questions, and verified dependency versions. Read both before starting work; the plan was partly written from memory, so verify any package or version it names against the registry (`npm view <pkg>`) and correct the plan.
- Early stage: only the root scaffold exists. The `infra` workspace and every `packages/*` workspace are not created yet, so most paths in `PLAN.md` are targets, not code.

## Commands

Node 24 (`.nvmrc`), Yarn 1.22 classic. Run from the repo root.

```bash
yarn typecheck                                # root tsc --noEmit, then `yarn workspaces run typecheck` (deliberately not `tsc -b`)
yarn test                                     # vitest run, all projects
yarn test --project infra                     # one project
yarn test:watch
yarn vitest run infra/test/foo.test.ts                    # single file
yarn vitest run infra/test/foo.test.ts -t "name"          # single test
```

Run tests from the repo root only. Projects are defined inline in the root `vitest.config.mts` (`infra` has the CDK cleanup setup file; `packages` is node-only). Running Vitest from inside a workspace finds no config and silently drops the setup file and timeout, so workspaces have no `test` script. Every workspace needs a `typecheck` script, or the root `yarn workspaces run typecheck` errors. `vitest run` exits 1 when a project has no tests yet. There is no lint script yet.

## Architecture (big picture)

A family reading tracker with three clients (web SPA, Alexa skill, Echo Show widget) over one dataset, so there is a real shared API rather than direct DB reads from the UI.

- `packages/core` is the keystone: domain logic, Kysely queries, DSQL connection, Hardcover client, CSV export. **Both the GraphQL Lambda and the Alexa Lambda import it directly**; the skill never calls the API over HTTP.
- `packages/graphql`: Pothos schema plus Apollo Server 5 in one Lambda. All logic lives in `src/schema.ts`; `src/lambda.ts` and `src/dev.ts` are thin wrappers and must stay that way so local and deployed behavior don't drift.
- The SPA and the API share one CloudFront distribution (API at `/graphql`), so there is no CORS.
- Data scoping: every query is scoped by `familyId` at the data layer. Never trust an ID from the client.
- Kids are profiles, not Cognito accounts. A parent PIN gates sensitive actions.
- Voice is adult-only: Amazon Kids mode refuses the skill. Reader resolution is `personId` first, otherwise ask "Who's reading?"; never guess the reader. The skill manifest must keep the `alexa::person_id:read` scope or `personId` silently disappears.
- The per-person data model is a superset of the Goodreads export CSV; `shelf` uses Goodreads' exact `Exclusive Shelf` values so export is a pass-through. The CSV writes both `Bookshelves` and `Exclusive Shelf`.

### Aurora DSQL rules that shape the code

- Primary keys are random UUIDv4 generated in app code, not UUIDv7 (avoids a write hotspot).
- Concurrency is optimistic: `core` has a single `withRetry()` that handles `40001` / `OC000` / `OC001`, and it must be the only way a transaction is opened. Transaction logic must be idempotent.
- Migrations: one DDL statement per transaction, DDL separate from DML, retry `OC001`. Use `CREATE INDEX ASYNC`. No triggers, PL/pgSQL, temp tables, or `TRUNCATE`. Max 3,000 rows modified per transaction.
- Connect with the official `@aws/aurora-dsql-node-postgres-connector`; treat connections as disposable.

## Working conventions

- Install with `yarn add`; initialize with the ecosystem's own tool (`cdk init`, `create-react-router`, `ask new`). Don't hand-type version ranges into `package.json`. Use `npm init` for a bare manifest, not `yarn init`.
- Pins that are deliberate: TypeScript `~6.0.3` (fallback `~5.9.x` if tools complain; 7 is unconfirmed and has proven incompatible in practice), `@types/node` 24 to match the Node 24 Lambda runtime. Say why when pinning on purpose.
- One TypeScript version across the whole repo, owned by the root `package.json`. Scaffolders (`cdk init`, `create-react-router`) pin their own, often 7: remove `typescript` and `@types/node` from the workspace after generating it, so there is no second copy. Verify with `yarn why typescript` or `grep '^"\?typescript@' yarn.lock`.
- Vitest is the test runner in every workspace, including `infra` (the CDK template's Jest is removed). Vitest 5 needs `vite` as a devDependency, which Yarn classic doesn't install for you.
- Write files with the Write/Edit tools, never Bash heredocs or redirects, one file per call, with a short what/why above each change.
- The repo is public: keep AWS account IDs, hosted-zone IDs, and personal details out of committed files. Use the `<AWS_ACCOUNT_ID>` / `<HOSTED_ZONE_ID>` placeholders; real values come from the deploy environment and `cdk.context.json`.
- Ask before outward-facing actions (pushing, creating remote resources, deploying).
- Keep `.npmrc` pinned to the public npm registry.
