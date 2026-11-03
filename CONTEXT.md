# CONTEXT.md

Session handoff for picking this project up in a fresh Claude Code session. `PLAN.md` is the design; this file is the state of play: what's done, what was learned, what's open, and how the owner likes to work.

## What this is

A private reading tracker for the family (a small Goodreads) with web, Alexa voice, and Echo Show widget clients. Kids don't get real Goodreads accounts; their reading history exports to a Goodreads-importable CSV so it can follow them later. Lives at `books.gnlfamily.com`, all infrastructure on AWS (us-west-2).

## Status (as of 2026-11-03)

**Committed and pushed** to https://github.com/agiannell/gnl-books (public):
- `PLAN.md` — full design, including the Alexa spike results.

**On disk, not yet committed** (root scaffold, build step 1 in progress):
- `.nvmrc` (24), `.npmrc` (pins the public npm registry), `.gitignore`
- `package.json` — private root, workspaces `infra` and `packages/*`, scripts `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:watch`
- `tsconfig.base.json`, `tsconfig.json` (extends base, includes `vitest.config.ts`)
- `vitest.config.ts` — includes `infra/test/**` and `packages/*/test/**`
- `yarn.lock`, `node_modules/`

**Not started:** the `infra` workspace, every `packages/*` workspace, CI, a project `CLAUDE.md`.

### Immediate next steps
1. Run `/init` to generate a `CLAUDE.md`; commit the root scaffold.
2. Create the `infra` workspace with `cdk init` (then adapt: swap Jest for Vitest).
3. Before writing the stack, check whether `aws-cdk-lib` (currently 2.275.x) has an L1/L2 construct for Aurora DSQL.
4. Note: the plan puts the migration runner in step 1, but it depends on `packages/core` (DSQL connection), so it effectively moves to step 2.

## Decisions made

| Area | Decision |
|---|---|
| Goodreads | No API exists (keys stopped 2020-12-08). Migration path is CSV export; the data model is a superset of the Goodreads export columns |
| Repo | New repo, not a stack inside `gnl-lambdas`. Same AWS conventions where they still make sense |
| Database | Aurora DSQL (serverless Postgres; foreign keys supported since Sept 2026) |
| API | One GraphQL Lambda: Pothos schema + Apollo Server 5 (chosen over Yoga for industry transferability) |
| Frontend | Vite SPA on S3 + CloudFront; Apollo Client |
| Auth | Cognito for the adults, shared by web and Alexa account linking. Kids are profiles, not accounts. Parent PIN gates sensitive actions |
| Book data | Hardcover GraphQL behind a swappable `BookSource` interface (Google Books stays an option) |
| Voice | Alexa custom skill in development stage, on **shared adult-profile devices only** |
| Testing | Vitest |

## What the Alexa spike established

A throwaway "Reading Check" skill was built in the developer console and tested on real devices.

- Development-stage skills reach the owner's Echos (developer and Echo accounts match).
- **Kids' bedroom Dots (Amazon Kids mode) will not run the skill.** Alexa gives its generic "I don't know how to help with that." The Parent Dashboard's *Manage Apps and Content* lists only Amazon's published kid-eligible skills and isn't searchable; Reading Check did not appear in the screenshots reviewed (not exhaustively confirmed).
- **`personId` works for an adult**, but only after the skill declares the **Skills Personalization** permission (manifest scope `alexa::person_id:read`). Without it, no `person` object is sent regardless of the user's Voice ID settings. This must live in the checked-in skill manifest or an `ask deploy` could silently strip it.
- Reader resolution design: `personId` if present, otherwise ask "Who's reading?" once per session. Never guess the reader.

## Open questions

1. ~~Can a child use voice on a shared adult device?~~ **Resolved (2026-11-03): no.** A child asking an adult-profile Dot to open the skill got the generic refusal; an adult saying the identical phrase on the same Dot worked (`personId` and `deviceId` present). Voice is adult-only; kids use the web app and the Show 15 touch widget. Remaining nit: confirm in CloudWatch that no request reaches the Lambda in the refused case. Consequence: Alexa (step 8) is lower value, so keep it optional and last.
2. **React Router version.** `PLAN.md` says v7, but the registry's current major is 8.5.1 (needs Node >= 22.22). What changed in 8 hasn't been checked.
3. **Echo Show 15 widget feasibility** is unverified; plan is a hello-world spike before real widget work.
4. **Whether a development-stage skill needs a privacy policy URL** to receive `personId` was not needed in the spike; publishing would require one.
5. Whether `persistentEndpointId` is exposed to custom skills and more stable than `deviceId` (now low priority since `alexa_devices` was demoted).

## Version notes (verified against the npm registry, 2026-11-03)

- TypeScript is held to `~6.0.3`. TypeScript 7.0.2 is the `latest` tag, but most of the stack declares no TypeScript peer range, so compatibility with 7 is unconfirmed. Only `@react-router/dev` declares a range, and it allows 7. The owner prefers 5 or 6. If `tsc` or `cdk synth` complains, `~5.9.x` is the fallback.
- `vitest` 5.1.0, `vite` 8.3.5, `aws-cdk-lib` 2.275.0, `@apollo/server` 5.5.1, `@pothos/core` 4.16.0.
- `@types/node` is deliberately pinned to 24 to match the Node 24 Lambda runtime (latest is 26).
- Runtime: Node 24, Yarn 1.22.22 (classic).
- `PLAN.md` was written partly from memory and may name outdated versions or packages. Verify each against the registry when it is added, and correct the plan.

## How the owner likes to work

- **Install with `yarn add`; initialize with the ecosystem's own tooling** (`cdk init`, `create-react-router`, `ask new`). Don't hand-type version ranges into `package.json`. Use `npm init` for a bare manifest (the owner has had trouble with `yarn init`), then `yarn add` for dependencies.
- **Check the registry before choosing a version** (`npm view <pkg>`), and say why when pinning on purpose.
- **Don't write files with Bash heredocs or redirects.** Use the Write and Edit tools, one file per call, so each change is a readable diff.
- **Put a brief explanation above every edit or file addition**: what it does and why.
- Prefer `tsc --noEmit` for type-checking. The owner hadn't seen `tsc -b` (project references) and chose to avoid it for now.
- Raise concerns rather than silently working around them; ask before outward-facing actions (pushing, creating remote resources, deploying).
- The repo is **public**: keep AWS account IDs, hosted-zone IDs, and personal details out of committed files. `PLAN.md` uses `<AWS_ACCOUNT_ID>` and `<HOSTED_ZONE_ID>` placeholders; real values come from the deploy environment.
- Git commits end with the `Co-Authored-By` attribution line the harness specifies.

## Environment

- macOS, zsh. Git identity and GitHub account for this repo: `agiannell` (SSH).
- The domain `gnlfamily.com` already has a Route 53 hosted zone in the AWS account, so `books.gnlfamily.com` needs no new zone.
- The sibling repo `gnl-lambdas` (mortgage rates) is the source of the CDK conventions reused here, but this project deliberately departs from its Next.js + DynamoDB shape.
