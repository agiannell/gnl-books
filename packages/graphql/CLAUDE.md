# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Workspace guide for `packages/graphql` (`@gnl-books/graphql`): a Pothos schema served by Apollo Server 5 in one Lambda. Repo-wide rules are in the root `CLAUDE.md`; domain logic lives in `packages/core`.

## Commands

```bash
yarn workspace @gnl-books/graphql typecheck
yarn test --project packages            # from the repo root; add a path or -t "name" for one file or test
yarn workspace @gnl-books/graphql dev   # local server on :4000 (tsx src/dev.ts)
```

`dev` needs AWS credentials (it mints a DSQL token and reads Cognito/Secrets Manager) and these env vars: `DSQL_ENDPOINT`, `USER_POOL_ID`, `USER_POOL_WEB_CLIENT_ID`, plus `PARENT_TOKEN_SECRET` (32+ characters, instead of the secret in Secrets Manager) and `HARDCOVER_API_KEY` (instead of the `gnl-books/app` secret). It connects as `admin` unless `DSQL_USER` is set. The comment in `dev.ts` names `PARENT_TOKEN_SECRET_ARN`; the code reads `CDK_SECRET_ARN` in the Lambda and `PARENT_TOKEN_SECRET` locally. The web dev server proxies `/graphql` to the **deployed** API, not to `:4000`; point `packages/web/vite.config.ts` at `http://localhost:4000` temporarily to use this server.

In the Lambda the environment comes from the stack: `DSQL_ENDPOINT`, `DSQL_USER` (`gnl_books_app`), `USER_POOL_ID`, `USER_POOL_WEB_CLIENT_ID`, `CDK_SECRET_ARN`, `APP_SECRET_ID`.

## Architecture

- **All logic is in `src/schema.ts`** (types, validators, resolvers). `lambda.ts` and `dev.ts` only wire `createApp()` (`app.ts`) to a transport, and must stay that way so local and deployed behavior cannot drift. `app.ts` is the one place the server is assembled; it also turns off the landing page and strips stack traces (a Lambda has no `NODE_ENV`).
- **Every request builds a `Context` (`context.ts`)** in this order: verify the Cognito **access** token (`auth.ts`) → `sub`; look up the family for that `sub`; verify the optional `X-Parent-Token` header (a short-lived HS256 token proving a PIN unlock, `parentToken.ts`) → `isParent`. Identity comes only from the verified token and the database, never from anything else the client sent.
- **The access token has no email.** `ctx.verifiedEmail()` asks Cognito (`AdminGetUser` by `sub`, `identity.ts`), only counts an email Cognito marks verified, and is lazy and cached per request. A user who has a family but no stored email gets it filled in by `backfillAccountEmail` the first time a container sees them (`checkedEmails`, kept by `createApp`). Never take an email from the client.
- **Authorization is Pothos scopes**: `inFamily`, `noFamily`, `isParent` (the last means a valid PIN unlock). A refused field returns `FORBIDDEN` (not an internal error). Resolvers behind `inFamily` use `ctx.familyId!`; the scope is what makes that safe.
- **Error codes are part of the contract the web relies on:** `UNAUTHENTICATED` (HTTP 401, before any field runs), `FORBIDDEN`, `BAD_USER_INPUT`, `NOT_FOUND`, `CONFLICT`, `LIMIT_REACHED`. A plain `Error` becomes a masked `INTERNAL_SERVER_ERROR`, so give expected failures a code.
- **Validation lives here, not in core.** Lengths, ranges, patterns (name 60, review 5000, search 200, email 254, goal limits) are checked in `schema.ts` helpers (`badInput`, `requireName`, `requireEmail`, …). The web copies several of these constants by hand.
- **Join requests:** `requestToJoin` answers `true` whether or not anything was recorded, by design. `joinRequestDenied` is its own root field (not on `me`, which has no id for the web cache to merge into) and is `false` for anyone with a family without querying.

## Adding or changing a field

1. Put the logic in `packages/core` and export it from its `index.ts`.
2. Add the field in `schema.ts` with the right scope, validation, and error codes.
3. **Update the three test files that mock `@gnl-books/core` by name:** `test/schema.test.ts` (the `vi.hoisted` list, the `vi.mock` return, and the `beforeEach` resets), `test/access.test.ts` (its mock list), and `test/context.test.ts` (its factory returns only what `context.ts` imports). A new core import that is not in the mock is `undefined` at runtime and fails confusingly.
4. Add the unauthenticated case to the table in `test/access.test.ts` (a new field must answer 401 with no data), and a `schema.test.ts` block covering the scope (`FORBIDDEN` when it should be), validation, and the happy path.
5. Add the query or mutation to `packages/web/src/queries.ts` and its fixtures (see `packages/web/CLAUDE.md`).

## Tests

`schema.test.ts` runs the schema with `graphql()` against a hand-built context and mocked core (the real error classes and PIN rule are kept so tests cannot drift from core). `access.test.ts` goes through a real Apollo server to prove unauthenticated and forbidden requests never reach resolvers or the Hardcover catalog. `context.test.ts` covers token handling, the family lookup, and the email behavior. `identity.test.ts` fakes the Cognito client.
