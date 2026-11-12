# Review — task list

The tasks from [`REVIEW_SUMMARY.md`](REVIEW_SUMMARY.md) (section numbers in brackets), so they can be ticked off and turned into PRs.
Size: **S** is under an hour, **M** is a session, **L** is several sessions. **(verify)** means confirm the problem before fixing it.

## P0 — fix soon (bugs and risk)

- [ ] **Search add moves shelved books** (S/M) [2.1]
  - Mark hits already on the reader's shelf in search ("On your shelf: Read").
  - Ask before a move.
  - Files: `web/src/SearchPage.tsx`, `core/src/shelf.ts`.
- [ ] **Session expiry and network errors** (M) [2.2]
  - Add an Apollo error link that turns 401s into "Session expired, sign in again".
  - Surface silent-renew failures (`web/src/auth.ts`, `web/src/apollo.ts`).
  - Add a Retry action to error alerts.
- [ ] **Route error element** (S) [2.2]
  - Add an `errorElement` (friendly page with "Go home") to the routes in `web/src/routes.tsx`.
- [ ] **Stop kids locking parents out** (M) [2.3]
  - Move "Remove from shelf" behind Settings or a parent-mode toggle, not a PIN box on every book page (`RemoveFromShelf.tsx`, `BookPage.tsx:262`).
  - Consider a separate attempt counter for book-page tries.
- [ ] **Strict TypeScript in web** (S/M) [2.4]
  - Add `"strict": true` to `packages/web/tsconfig.app.json` and `tsconfig.node.json`, or extend `tsconfig.base.json`.
  - Fix what it finds.
- [ ] **Guard `Intl.supportedValuesOf`** (S) [2.10]
  - Do it lazily, with a fallback list (`web/src/TimezoneSection.tsx:10`, `core/src/families.ts:17`), so old Safari can't crash the app.
- [ ] **Limit GraphQL query cost** (M) [2.8]
  - Depth, alias and complexity limits (e.g. a validation rule) in `graphql/src/app.ts`.
  - Cap aliased `searchBooks` per request.
- [ ] **Search abuse** (M) [2.8]
  - Per-family rate limit, or a short-lived cache, for `searchBooks` (`graphql/src/schema.ts:266-278`).
- [ ] **Disable introspection** (S) [6]
  - Explicitly, in production (`graphql/src/app.ts`).
- [ ] **CSV formula injection** (S) [6]
  - Neutralise cells starting with `=`, `+`, `-` or `@` in the CSV export (`core/src/csv.ts:34-37`).
- [ ] **Retry the single-statement writes** (S) [6]
  - Wrap `setFamilyTimezone` (`core/src/families.ts`) and `denyJoinRequest` (`core/src/joinRequests.ts`) in `withTransaction`.
- [ ] **Renew-at-cap error** (S) [6]
  - Return a coded error (`UNLOCK_EXPIRED`), not a plain `Error` (`graphql/src/parentToken.ts:37`), and give "Family not found" a code.
- [ ] **Duplicate `addToShelf` race** (S) [6]
  - Map `23505` on `shelf_entries` to "already on the shelf" instead of a server error.

## P1 — configuration

- [ ] **Web config from env** (M) [3]
  - Cognito region, pool id, client id and hosted-UI URL from `VITE_*` env (`web/src/config.ts`).
  - Fill it from stack outputs in `deploy.yml`, or have the stack write `config.json` into the site.
- [ ] **Dev proxy target from env** (S) [3]
  - `web/vite.config.ts`, so local dev can point at something other than production.
- [ ] **Infra config module** (M) [3, 8]
  - Add `infra/config.ts` reading CDK context: domains, region, hosted-UI prefix, dev port, secret names, throttle, memory/timeouts, token lifetimes, resource-name prefix.
  - Update the infra tests and `test.yml` to use it.
- [ ] **One dev port** (S) [3]
  - Shared between `LOCAL_DEV_URL` and `vite.config.ts`.
- [ ] **Shared limits module** (M) [3]
  - One source for the PIN pattern, name/emoji/review/query/title/email lengths, goal limits and request lifetime.
  - Used by `graphql/src/schema.ts` validation and the web forms; remove the web copies.
- [ ] **Named validation constants** (S) [3]
  - Replace the inline numbers in `graphql/src/schema.ts` (60, 200, 1000, 2100).
- [ ] **One date formatter** (S) [3]
  - A single locale choice, shared by `format.ts`, `JoinRequestsSection.tsx` and `PinForm.tsx`.
- [ ] **Cover host check** (S) [3]
  - Check it in `web/src/Cover.tsx` to match the CSP.

## P1 — operations and CI

- [ ] **Alarms** (M) [2.6, 8]
  - CloudWatch alarms and an SNS topic with an email subscription for GraphQL Lambda errors/duration/throttles, API 5xx/429, and the migration runner.
- [ ] **Log retention** (S) [2.6]
  - On both Lambdas, plus API Gateway access logs.
- [ ] **Budget alert** (S) [2.6]
  - An AWS Budget with a small threshold.
- [ ] **DSQL backup plan** (M) [2.7] **(verify)**
  - What DSQL supports: AWS Backup or a snapshot.
  - Write a restore runbook.
- [ ] **Deploy workflow guards** (S) [8]
  - A `concurrency` group in `deploy.yml`.
  - `timeout-minutes` on the jobs.
  - Run the lockfile host check there too.
- [ ] **Diff review before deploy** (M) [8]
  - Run `cdk diff` on PRs (needs read-only creds).
  - Gate deploys on a green `test.yml` for the same commit.
- [ ] **Lint and format** (M) [8]
  - oxlint across all workspaces, plus a formatter (Prettier or Biome) and `.editorconfig`.
  - Root `lint`/`format` scripts, run in CI.
- [ ] **Dependency updates** (S) [8]
  - Dependabot for npm and GitHub Actions; pin actions by commit SHA.
- [ ] **API bypass** (S) [8]
  - Disable the default `execute-api` endpoint so the API is reachable only through CloudFront.
- [ ] **Open sign-up protections** (M) [8]
  - Move Cognito email to SES.
  - Consider Cognito threat protection or WAF rate rules on sign-up.

## P1 — UX

- [ ] **Header** (M) [4]
  - Show the current reader, with a switch, plus a Settings link and "Signed in as …".
  - Confirm sign out (`web/src/App.tsx`).
- [ ] **Route changes** (S) [4]
  - Scroll restoration, focus on the page heading, and per-route `document.title`.
- [ ] **Book page feedback** (M) [4]
  - Success feedback after each edit.
  - Show server errors inside the panel that caused them.
  - Give each panel its own busy state (`web/src/BookPage.tsx`, `useEdit`).
- [ ] **Review box** (S) [4]
  - Stop it remounting after save (`BookPage.tsx:248`); add a character counter.
- [ ] **Cached pages** (S) [4]
  - Show cached data without a spinner (`ProfilePage.tsx`, `BookPage.tsx`, settings sections).
- [ ] **Confirmations** (S) [4]
  - Confirm approving a join request (and say what it grants), denying, and removing a goal.
- [ ] **Join request status** (M) [4]
  - Remember a sent request across reloads (from the API).
  - Poll automatically, and say "still waiting" on Check again.
- [ ] **Consistent copy** (S) [4]
  - Shelf labels ("Read" everywhere).
  - Explain "This reader is a parent" and "Move to Read" vs "I finished it".
  - "Welcome" for new users.
  - Hide Progress/Finish on To-read.
- [ ] **Persistent search** (S) [5]
  - Keep it in the URL (`?q=`); after adding, link to the book.

## P2 — features

- [ ] **Edit a reader** (M) [2.9, 5]
  - Name, emoji, colour, parent flag: `updateProfile` in core and the API, plus a Settings UI.
- [ ] **Edit dates and re-reads** (M) [2.9, 5]
  - Edit start and finish dates, and record a re-read (`readCount`).
- [ ] **Shelf sorting and paging** (M) [5]
  - Sort and filter shelves (title, author, date, rating).
  - Paginate, or group by year, the Read shelf (`core/src/shelf.ts` `listShelf`).
- [ ] **Undo** (S) [5]
  - For "Move to" and remove.
- [ ] **Manual books** (M) [5]
  - Edit a manually added book; add subtitle, publisher and description to manual add; show tags.
- [ ] **Progress display** (S/M) [5]
  - A percentage on shelf cards, plus a short progress history on the book page.
- [ ] **Goal prompt** (S) [5]
  - From a reader's page when they have no goal.
- [ ] **Remove an adult** (M) [5]
  - Parent-only, behind the PIN.
- [ ] **Join request notices** (M) [5]
  - Email the parent about a join request (needs SES); show when a request expires.
- [ ] **Home screen polish** (S) [5]
  - Web app manifest and `theme-color` (Android home screen).
- [ ] **Dark mode** (S) [5]
  - A toggle, kept per device.
- [ ] **Time zone picker** (S) [4, 5]
  - Searchable, or grouped by region.

## P2 — code health

- [ ] **Split `schema.ts`** (L) [6]
  - Split `graphql/src/schema.ts` by domain, with `validation.ts` and a central error map.
  - Add a `notFound()` helper.
- [ ] **GraphQL codegen** (M) [7]
  - For the web (types from the schema), replacing the hand-written types in `queries.ts`.
- [ ] **Split `queries.ts`** (M) [7]
  - By feature; use a real fragment for shelf entries and return the same fields from `ADD_TO_SHELF`.
- [ ] **One mutation pattern** (M) [7]
  - For the web (e.g. `useEdit` everywhere), and one cache-update approach.
- [ ] **Web dedupe** (S) [7]
  - Shelf labels, reader avatar, progress bar, year/pages line, the error-message helper.
- [ ] **Book page query** (S/M) [7]
  - Fetch the one entry, not the whole shelf (`BookPage.tsx`).
- [ ] **N+1 batching** (M) [2.8]
  - DataLoader-style batching for `Profile.shelf` and `Profile.goal`.
- [ ] **Pagination** (M) [6]
  - For `listShelf`; stream or cap the CSV export.
- [ ] **PIN lockout** (S) [6]
  - Make it escalate (longer locks after repeated lockouts).
- [ ] **Join-request limits** (S) [6]
  - A cooldown after a denial, and a per-requester limit, so a few accounts can't fill a family's 5 slots.
- [ ] **Email lookup** (S) [6] **(verify)**
  - Restrict it to parents' emails, or accept "any member" deliberately; decide whether `accounts.email` should be unique.
- [ ] **`deleteProfile` race** (S) [6] **(verify)**
  - Check whether DSQL enforces `references`; if not, fix the race with `addToShelf`/`setGoal`.
- [ ] **Core helper dedupe** (S) [6]
  - `isRecord`/`num`, `clean`/`withoutUndefined`, the ISBN regex.
- [ ] **Unused code** (S) [6]
  - Remove `pg-connection-string` from `core` and exports nobody uses.
- [ ] **Structured logging** (M) [6]
  - Request id, operation name and JSON format; metrics for search failures and retries.
- [ ] **Token refresh race** (S) [7]
  - Share one in-flight silent renew in `getAccessToken` (`web/src/auth.ts`).
- [ ] **Goal year** (S) [7]
  - Take it from the family's zone in Settings, as on the profile page.
- [ ] **Small web fixes** (S) [7]
  - Remove dead `cover-sm`; the redundant check in `ProfilesSection.tsx`; `Separator` inside `ul`; the non-null assertion in `Shelves.tsx:43`.
- [ ] **Retire Alexa/Echo leftovers** (M) [9]
  - Drop `ALEXA`/`WIDGET` from `ProgressSource`.
  - Remove the `alexa_devices` update in `deleteProfile`.
  - A migration to drop `alexa_devices` and `profiles.alexa_person_id`.
  - Clean the comments and `core/package.json`.
  - Do this as its own PR.

## P3 — docs and housekeeping

- [ ] **`CLAUDE.md`** (S) [9]
  - Rewrite the intro ("Early stage…"), the lint note and the architecture section (no Alexa/Echo clients).
- [ ] **`CONTEXT.md`** (S) [9]
  - Refresh it, or retire it in favour of TODO.md.
- [ ] **Root README** (M) [9]
  - What the app is, setup, the hand-made `gnl-books/app` secret, bootstrap, deploy, tests (including local Postgres).
  - Replace the boilerplate `infra/README.md`.
- [ ] **`TODO.md` and `PLAN.md`** (S) [9]
  - Prune stale lines ("Admin-created users only", Alexa open questions, "React Router v7").
- [ ] **Dependency versions** (S) [9]
  - Align duplicates across workspaces (`vite`, `@vitejs/plugin-react`, `tsx`).
  - Add `packageManager` and `engines`.
- [ ] **Staging environment** (L) [8]
  - Decide whether to add one, once the infra config module exists.
