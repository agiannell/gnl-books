# infra

The AWS CDK app (TypeScript) that defines everything gnl-books runs on, in one stack in `us-west-2`: `lib/gnl-books-stack.ts`. The account comes from the environment (`CDK_DEFAULT_ACCOUNT`), never from source.

## What the stack creates

| Section | Resources |
|---|---|
| Database | An Aurora DSQL cluster (retained, deletion-protected). |
| Migrations | A Lambda that applies `db/migrations/*.sql` and then provisions the API's limited database role, run by a CDK trigger on every deploy that changes it. |
| Web | A private S3 bucket and a CloudFront distribution on the site domain, with a certificate and Route 53 records. A response headers policy sets the content security policy. Hashed `assets/*` are cached for a year; everything else is `no-cache`. |
| Auth | A Cognito user pool (retained, deletion-protected, email sign-up) with a public PKCE app client and a hosted-UI domain. |
| API | The GraphQL Lambda behind an API Gateway HTTP API, reached through CloudFront at `/graphql` on the site's own origin. |

The database has two roles. The migration runner connects as `admin`; the API connects as `gnl_books_app`, which cannot change the schema. The stack tests pin that only the runner holds admin access.

## Prerequisites

- Node 24 and Yarn 1; run `yarn install` at the repo root.
- AWS credentials for the target account, and the region bootstrapped for CDK.
- The web build: `yarn build:web` from the repo root. The stack publishes `packages/web/dist`, so synth, diff and deploy fail without it.
- A Secrets Manager secret named `gnl-books/app` holding JSON with a `hardcoverApiKey` key. It is created by hand, not by the stack, and the API cannot search for books until it exists. (`gnl-books/cdk` is created and owned by the stack.)

## Commands

```bash
yarn test --project infra          # from the repo root: template assertions, no AWS needed
cd infra
yarn cdk synth                     # emit the CloudFormation template (does a Route 53 lookup)
yarn cdk diff                      # always read this before deploying
yarn cdk deploy                    # normally run by the GitHub Actions workflow, not by hand
yarn typecheck
```

`cdk.json` runs `tsc` before every synth, so a type error fails the synth. `cdk.context.json` is gitignored because its keys contain the account id; synth recreates it.

## Deploying

Deploys go through the manual GitHub Actions workflow (**Actions → Deploy → Run workflow**), which assumes an AWS role over OIDC in the `production` environment, runs typecheck and tests, builds the web app, shows the `cdk diff`, and deploys (about three minutes). The runbook, including how to check the result from the logs, is in [`HANDOFF.md`](../HANDOFF.md).

New migrations are applied by the runner during the deploy, so the API briefly runs the old code against the new schema; write migrations additively.

## After changing the user pool

The Cognito pool id, app client id and hosted-UI URL are copied by hand into [`packages/web/src/config.ts`](../packages/web/src/config.ts). If the pool or client is ever recreated, update that file from the stack outputs.

## Tests

`test/gnl-books.test.ts` builds the stack once under a fake account with bundling and the web build stubbed out, so it needs neither AWS nor a built SPA. Add an assertion whenever you change IAM, the CSP, caching, or what the migration trigger depends on. More in [`CLAUDE.md`](CLAUDE.md).
