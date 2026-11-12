# @gnl-books/graphql

The GraphQL API: a [Pothos](https://pothos-graphql.dev) schema served by Apollo Server 5, running in one AWS Lambda behind CloudFront at `/graphql`. The logic lives in [`@gnl-books/core`](../core); this package is the transport, authentication and validation around it.

## Layout

| File | Role |
|---|---|
| `src/schema.ts` | Types, input validation and resolvers. All the API's logic is here. |
| `src/app.ts` | Builds the server and the per-request context factory. Shared by the Lambda and the dev server. |
| `src/lambda.ts`, `src/dev.ts` | Thin wrappers that put `app.ts` behind the Lambda handler or a local HTTP server. They stay thin so local and deployed behavior cannot drift. |
| `src/context.ts` | Builds each request's context: who the caller is, which family, whether a parent PIN is unlocked. |
| `src/auth.ts`, `src/identity.ts` | Verifies the Cognito access token; looks up a verified email from Cognito. |
| `src/parentToken.ts` | Signs and verifies the short-lived token that proves a PIN unlock. |

## Authentication and access

1. Every request carries a Cognito **access token** (`Authorization: Bearer …`). A missing or invalid token is rejected with HTTP 401 before any field runs.
2. The token's `sub` is looked up in the database to find the caller's family. A user with no family can only create one or ask to join one.
3. An optional `X-Parent-Token` header, minted after a correct PIN, marks the request as coming from an unlocked parent.

Fields are guarded by scopes (`inFamily`, `noFamily`, `isParent`). The access token carries no email, so the API asks Cognito for the verified email when it needs one; it never accepts an email or an id from the client as proof of anything.

Expected failures come back with a GraphQL error code the web app relies on: `UNAUTHENTICATED`, `FORBIDDEN`, `BAD_USER_INPUT`, `NOT_FOUND`, `CONFLICT`, `LIMIT_REACHED`. Anything else is masked as `INTERNAL_SERVER_ERROR`.

## Running locally

```bash
yarn workspace @gnl-books/graphql dev     # http://localhost:4000
```

The dev server needs AWS credentials (it mints a database token and calls Cognito) and these environment variables:

| Variable | Purpose |
|---|---|
| `DSQL_ENDPOINT` | The Aurora DSQL cluster host. |
| `USER_POOL_ID`, `USER_POOL_WEB_CLIENT_ID` | The Cognito user pool and app client whose tokens are accepted. |
| `PARENT_TOKEN_SECRET` | 32+ characters; signs parent-unlock tokens. In the Lambda this comes from Secrets Manager instead. |
| `HARDCOVER_API_KEY` | The Hardcover token for book search. In the Lambda it comes from Secrets Manager. |
| `DSQL_USER` | Optional. Set to `gnl_books_app` to connect as the limited role; otherwise it connects as `admin`. |

The web dev server proxies `/graphql` to the **deployed** API, not to this one. To point it here, change the proxy target in `packages/web/vite.config.ts` to `http://localhost:4000` while you work.

## Testing

```bash
yarn test --project packages     # from the repo root
```

`schema.test.ts` exercises resolvers against a hand-built context and mocked core. `access.test.ts` goes through a real Apollo server to prove that unauthenticated and forbidden requests never reach a resolver. Adding a field means updating three test files that mock `@gnl-books/core` by name; the checklist is in [`CLAUDE.md`](CLAUDE.md).
