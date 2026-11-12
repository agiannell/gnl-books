# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Workspace guide for `packages/core` (`@gnl-books/core`): domain logic, Kysely queries, the DSQL connection, the Hardcover client, CSV export. The GraphQL Lambda and the migration runner import it directly. Repo-wide rules are in the root `CLAUDE.md`.

## Commands

Run from the repo root (Vitest finds its config only there).

```bash
yarn workspace @gnl-books/core typecheck
yarn test --project packages                              # core + graphql unit tests (live tests skip themselves)
yarn vitest run packages/core/test/shelf.live.test.ts     # one file
yarn vitest run packages/core/test/pin.test.ts -t "name"  # one test
# live tests need a real database: either the cluster ...
zsh -ic 'assume agiannell >/dev/null 2>&1; export AWS_REGION=us-west-2 DSQL_ENDPOINT=<cluster>.dsql.us-west-2.on.aws; yarn vitest run packages/core/test/goals.live.test.ts'
# ... or, for joinRequests.live.test.ts only, a throwaway local Postgres:
LOCAL_PG_URL=postgres://postgres@127.0.0.1:54329/gnlcheck yarn vitest run packages/core/test/joinRequests.live.test.ts
yarn workspace @gnl-books/core codegen                    # regenerate src/schema.ts; see the root CLAUDE.md for the DATABASE_URL recipe
```

Postgres 14 is installed through Homebrew. To get a local test database: `initdb`, start it with `-c unix_socket_directories=` (a long socket path fails), apply `db/migrations/*.sql` with `sed 's/index async/index/'` (vanilla Postgres has no async indexes), and create the `schema_migrations` table the runner makes. Running `codegen` against it reproduces the cluster's `schema.ts` exactly, which is how types are regenerated when migrating the real cluster first is not allowed.

## Architecture

`src/index.ts` is the public surface; the web package never imports core, only the API does. Modules are by domain: `families`, `profiles`, `shelf`, `goals`, `joinRequests`, `bootstrap`, `unlock` + `pin`, `csv`, `books/*` (Hardcover search, relevance ranking, the local book cache), `appRole`, `migrate`.

Rules every function follows, all because of Aurora DSQL:

- **Transactions go through `withTransaction`** (`db.ts`), which retries optimistic-concurrency conflicts (`OC000`/`OC001`/`40001`). The callback is **re-run from the top**, so it must be idempotent: make ids and slow work (the scrypt PIN hash) once, outside it. A write outside `withTransaction` has no retry (`setFamilyTimezone` and `denyJoinRequest` currently do this; it is on the review list).
- **DSQL only detects conflicting writes**, so "count, then insert" caps (profiles, families, pending join requests) can overshoot slightly. That is accepted for guards, and documented where it applies.
- **Everything is scoped by `familyId` in the query**, never trusted from the client. A row outside the caller's family returns `undefined`/`false`, the same as a missing one, so callers cannot probe. Ids from a client go through `isUuid` first (`ids.ts`), because Postgres raises on a malformed uuid.
- **Primary keys are random UUIDv4 made in app code.** `jsonb` columns are written as `JSON.stringify(...)` text; reads come back parsed.
- **Dates are plain `YYYY-MM-DD` strings** (`typeParsers` in `db.ts`), and every "today" goes through `localToday(timezone)` so a late-evening finish lands on the family's day, not UTC's.
- **`src/schema.ts` is generated** from the database (overrides in `.kysely-codegenrc.json`). Never edit it; regenerate after every migration.

### Migrations and the database role

Migrations live at the repo root in `db/migrations/NNNN_snake_case.sql`, applied by `migrate()`: **exactly one statement per file**, run in its own transaction and recorded in a second one, so write each idempotently (`if not exists`). Use `create index async`. No triggers, PL/pgSQL, temp tables or `truncate`; `add column` cannot be `NOT NULL` or have a default, so new columns are nullable. The API connects as the limited role `gnl_books_app`, which `provisionAppRole` creates and maps after the migrations run. New tables are covered by default privileges; `schema_migrations` is deliberately withheld. See `infra/CLAUDE.md` for the wiring.

### Join requests (non-obvious behavior)

`requestToJoin` must stay indistinguishable whether or not the named email belongs to a family (it silently records nothing for an unknown email or a full family). One open request per user; 5 open per family; 7 days. Denying **keeps** the row (`denied_at` set, `created_at` restarted) so `wasJoinRequestDenied` can tell the requester; only a parent's action makes it true. `bootstrapFamily` withdraws the user's request and enforces `MAX_FAMILIES`. `backfillAccountEmail` fills in an older account's email on first use.

## Tests

`*.test.ts` are unit tests; `*.live.test.ts` hit a real database and skip unless `DSQL_ENDPOINT` (or `LOCAL_PG_URL` where supported) is set. Several unit tests (`migrate`, `appRole`, `bootstrap`) use a Kysely instance over a fake driver that records statements and transaction boundaries, which is the pattern for testing SQL sequencing without a database. Live tests create their own families and delete them afterwards. When you add logic, mutation-check it: break the code, confirm a test fails, restore it. A test that survives the mutation is not testing what you think.
