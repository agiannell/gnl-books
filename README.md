# gnl-books

A reading tracker for a family. Adults sign in; kids are reader profiles under the family, so each person has their own shelves, ratings, reviews, progress and yearly goal. Live at <https://books.gnlfamily.com>.

Sign-up is open so the app can be shown to others. A new user either creates a family or asks to join an existing one by naming a parent's email; a parent approves the request in Settings, behind the parent PIN.

## What it does

- Shelves per reader: Want to read, Currently reading, Read (Goodreads' own shelf names).
- Book search through [Hardcover](https://hardcover.app), plus manual add for books it does not have.
- Rating, review, page progress and finish dates; yearly reading goals.
- A parent PIN that gates sensitive actions (managing readers, join requests, removing books).
- Export to a CSV in Goodreads' format.

## How it fits together

```
 browser ──► CloudFront ──┬─► S3                       the React SPA (packages/web)
 (Cognito sign-in)        └─► /graphql ─► Lambda       Pothos + Apollo Server (packages/graphql)
                                              │
                                              ▼
                                   packages/core ──► Aurora DSQL
                                   (domain logic)    (+ Hardcover API for search)
```

The site and the API share one CloudFront distribution, so there is no CORS. Every query is scoped to the caller's family in the data layer; nothing the client sends is trusted as an identity.

| Path | What it is |
|---|---|
| [`packages/web`](packages/web) | The single-page app: React, Vite, Radix Themes, Apollo Client. |
| [`packages/graphql`](packages/graphql) | The GraphQL API, served from one Lambda. |
| [`packages/core`](packages/core) | Domain logic, Kysely queries, the database connection, the Hardcover client, CSV export. |
| [`infra`](infra) | The AWS CDK app: database, migration runner, site, auth, API. |
| [`db/migrations`](db/migrations) | SQL migrations, applied by the deploy. |

Stack: TypeScript, Yarn workspaces, Vitest, AWS CDK, Aurora DSQL, Cognito, Lambda, CloudFront.

## Getting started

You need Node 24 (see `.nvmrc`) and Yarn 1 (classic).

```bash
yarn install
yarn typecheck     # type-check every workspace
yarn test          # all unit tests (no AWS needed)
yarn build:web     # build the SPA; required before any CDK synth, diff or deploy
```

Run Vitest from the repo root only; the workspaces have no `test` script of their own. Tests named `*.live.test.ts` need a real database and skip themselves unless one is configured; see [`packages/core`](packages/core#testing).

### Running the app locally

```bash
yarn workspace @gnl-books/web dev      # http://localhost:5173
```

Note that the dev server proxies `/graphql` to the **deployed** API, so a local session reads and writes the real data under your real sign-in. To run the API locally as well, see [`packages/graphql`](packages/graphql#running-locally).

## Deploying

Deploys are manual: **Actions → Deploy → Run workflow** in GitHub (typecheck, tests, web build, `cdk diff`, `cdk deploy`). The migration runner applies new migrations as part of the deploy. See [`infra`](infra) for what the stack contains and the secrets it expects.

## Documentation

| File | Contents |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | Current state, decisions already made, access, deploy and verify runbook. Start here when picking the project up. |
| [`PLAN.md`](PLAN.md) | The original design: schema, API, auth, build order. The Alexa and Echo Show parts are shelved. |
| [`TODO.md`](TODO.md) | The build checklist. |
| [`REVIEW_SUMMARY.md`](REVIEW_SUMMARY.md), [`REVIEW_TODO.md`](REVIEW_TODO.md) | The latest whole-app review and the tasks it produced. |
| [`CLAUDE.md`](CLAUDE.md) | Conventions and traps for AI coding assistants; also a dense reference for people. Each workspace has one too. |

## Status

Deployed and in use. An Alexa skill and an Echo Show widget were planned and are shelved; the web app is the only client.

## License

MIT.
