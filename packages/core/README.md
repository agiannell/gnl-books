# @gnl-books/core

The domain layer: everything that touches data or the outside world, with no HTTP in it. The GraphQL Lambda and the migration runner import it directly. The web app never does.

## What's in it

| Area | Modules |
|---|---|
| Database | `db` (connection and `withTransaction`), `retry`, `migrate`, `appRole`, `schema` (generated types) |
| Families and people | `families`, `profiles`, `bootstrap`, `joinRequests` |
| Reading | `shelf` (shelves, ratings, reviews, progress, finishing), `goals` |
| Parent PIN | `pin` (hashing), `unlock` (attempt counting and lockout) |
| Books | `books/hardcover` (search client), `books/relevance` (ranking), `books/cache` (local copy of books), `books/types` |
| Export | `csv` (Goodreads format) |

`src/index.ts` is the public surface; import from `@gnl-books/core`, not from deep paths.

## Commands

Run from the repo root.

```bash
yarn workspace @gnl-books/core typecheck
yarn test --project packages          # core and graphql unit tests
yarn workspace @gnl-books/core codegen   # regenerate src/schema.ts from a live database
```

## Database

The database is Aurora DSQL, a Postgres-compatible service with some deliberate differences that shape this package:

- **Transactions go through `withTransaction`**, which retries optimistic-concurrency conflicts. The callback can run more than once, so it must be safe to repeat.
- **Every query is scoped by `familyId`**, and ids that come from a client are validated before they reach a query.
- **Primary keys are random UUIDv4** generated in application code.
- **Migrations** live at the repo root in [`db/migrations`](../../db/migrations), one SQL statement per file, applied by `migrate()` during a deploy. DSQL has no triggers, PL/pgSQL or `TRUNCATE`, and indexes are created `async`.
- **`src/schema.ts` is generated** from the database by `kysely-codegen`. Never edit it by hand; regenerate it after every migration.

The API connects as a limited database role (`gnl_books_app`) that can read and write rows but not change the schema. Only the migration runner connects as `admin`; after the migrations it runs `provisionAppRole` to create the role and map the API's IAM role to it.

### Joining a family

A signed-in user with no family can create one (`bootstrapFamily`, capped at 100 families) or ask a parent to let them in (`requestToJoin`). Asking is deliberately indistinguishable whether or not the named email belongs to a family. A user has one request; a family holds five open at a time; a request lasts seven days. A denied request is kept, so the requester can be told.

## Testing

```bash
# unit tests, no database needed
yarn test --project packages

# live tests against the real cluster (needs AWS credentials)
AWS_REGION=us-west-2 DSQL_ENDPOINT=<cluster>.dsql.us-west-2.on.aws \
  yarn vitest run packages/core/test/goals.live.test.ts
```

`*.live.test.ts` files skip themselves unless `DSQL_ENDPOINT` is set. `joinRequests.live.test.ts` can alternatively use a throwaway local Postgres through `LOCAL_PG_URL`. That path, and how to regenerate `schema.ts` from a local database, is written up in [`CLAUDE.md`](CLAUDE.md).

## More

[`CLAUDE.md`](CLAUDE.md) in this folder has the full set of conventions and test patterns.
