# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Workspace guide for `infra/` (the CDK app). Repo-wide rules are in the root `CLAUDE.md`; read that first.

## Commands

Run from the repo root unless noted. AWS needs credentials: `zsh -ic 'assume agiannell >/dev/null 2>&1; <command>'` (each Bash call is a fresh shell).

```bash
yarn test --project infra          # the stack's Template assertions and the migration handler test; no AWS needed
yarn build:web                     # REQUIRED before synth/diff/deploy: the stack publishes packages/web/dist
cd infra && yarn cdk synth         # needs CDK_DEFAULT_ACCOUNT (set by the credentials); does a real Route 53 lookup
cd infra && yarn cdk diff          # read this before any deploy, especially for a DSQL cluster replacement
cd infra && yarn cdk deploy --require-approval never   # normally run by .github/workflows/deploy.yml, not by hand
```

Deploys go through the manual GitHub Actions workflow (`workflow_dispatch`, `production` environment, OIDC). Ask the user before deploying, from CI or locally. `cdk.json` runs `npx tsc` before every synth, so synth is slow and fails on any type error.

## Layout

- `lib/gnl-books-stack.ts` is the whole stack, in sections: Database, Migrations, Web, Auth, API. Constants at the top (`ZONE_NAME`, `SITE_DOMAIN`, `AUTH_DOMAIN_PREFIX`, secret names, `APP_DB_ROLE`) are the only configuration; nothing reads env or CDK context except `webDist` and the AWS account.
- `lambda/migrate.ts` is the migration runner. The stack bundles `db/migrations/*.sql` next to it (an esbuild `afterBundling` hook copies them) and invokes it with a CDK `Trigger`.
- `bin/gnl-books.ts` takes the account from `CDK_DEFAULT_ACCOUNT` and hardcodes `us-west-2`. The repo is public: never put an account id in source. `cdk.context.json` is gitignored because its keys contain the account id.

## What spans several parts of the stack

- **Two database roles, wired together.** The migration runner connects as DSQL `admin` (`grantConnectAdmin`) and runs the migrations, then calls `provisionAppRole` (in `packages/core`). That creates `gnl_books_app` and maps the API Lambda's IAM role to it. The API gets only `grantConnect` plus `DSQL_USER`. The runner learns the API role's ARN through `addEnvironment('DSQL_APP_ROLE_ARN', ...)`, and the trigger `executeAfter(graphqlFunction)` so the role exists first. Tests pin all of this: only the runner may hold `dsql:DbConnectAdmin`. The API function updates before the trigger maps its role, so API calls can fail for a few seconds during a deploy that changes the role.
- **The trigger reruns when the runner's code or config changes** (`executeOnHandlerChange`), which includes a new migration file, since the SQL is bundled into the function. If the runner throws, the deploy fails.
- **The SPA and the API share one CloudFront distribution** (API at `/graphql`), so there is no CORS. The site behavior carries a response headers policy with the CSP; its limits (no inline `<style>`, covers only from `https://assets.hardcover.app`) constrain the web UI, see `packages/web/CLAUDE.md`.
- **Two `BucketDeployment`s:** hashed `assets/*` (immutable, 1 year, `prune: false` so open tabs keep working) and everything else (`no-cache`, invalidates). The index deployment depends on the assets one.
- **Cognito:** self sign-up is on (email verified first). The pool is `RETAIN` with deletion protection. The web client is public (PKCE). The API role may call `cognito-idp:AdminGetUser` on this pool only. The pool id, client id and hosted-UI URL are copied **by hand** into `packages/web/src/config.ts` from the stack outputs; recreating the pool means updating that file.
- **Secrets:** `gnl-books/cdk` is stack-owned (generated `parentTokenKey`). `gnl-books/app` is hand-made (holds `hardcoverApiKey`); the stack imports it by name and never creates or changes it, and the API cannot work until it exists.
- **Stateful resources are protected:** the DSQL cluster and the user pool are `RETAIN` with deletion protection. The site bucket is `DESTROY` on purpose.
- The us-east-1 certificate for CloudFront uses the deprecated `DnsValidatedCertificate`, because only us-west-2 is bootstrapped.
- `aws-cdk` (the CLI) is pinned exactly while `aws-cdk-lib` and `@aws-cdk/aws-dsql-alpha` use `^`; keep them compatible by hand.

## Tests

`test/gnl-books.test.ts` builds the stack once with context `aws:cdk:bundling-stacks: []` (no esbuild) and `webDist` pointing at `infra/placeholder` (no web build), under a fake account (`111111111111`) so the hosted-zone lookup returns a dummy. Add an assertion whenever you change IAM, the CSP, caching, or what the trigger depends on. `test/setup.ts` cleans CDK's temp directories (skip with `CDK_NO_CLEAN_TESTS`). `migrate-handler.test.ts` mocks `@gnl-books/core`.
