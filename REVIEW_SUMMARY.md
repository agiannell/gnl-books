# App review — summary

Reviewed 2026-11-12, at the point where the web app, API, open sign-up and join requests are deployed and
working. Scope: hardcoded configuration, UX (seamless for a family on a shared tablet, nothing confusing,
features a user would expect), and code structure, bloat, design and best practice across
`packages/web`, `packages/graphql`, `packages/core`, `infra`, CI and the docs.

Findings come from three read-only passes (web UX, API and core, infra/CI/config). The high-severity claims
were checked against the code. Items marked **(verify)** are inferences that need confirming before acting
on them. The task list is in [`REVIEW_TODO.md`](REVIEW_TODO.md).

## 1. Overall

The foundations are good:
- **Data scoping:** every query is scoped by family at the data layer, and auth scopes (`inFamily`, `noFamily`, `isParent`) guard each field.
- **Database:** DSQL optimistic-concurrency handling is centralised in `withTransaction`, and the API runs as a limited database role.
- **Browser security:** the CSP is strict.
- **Tests:** there are many, mutation-checked, including live tests against real SQL.

The debts are of four kinds:
- **Configuration baked into code.** Domains, region, Cognito ids and limits are copied between infra, web, CI and tests.
- **UX rough edges** that matter more on a shared family tablet than on a personal device.
- **No operational safety net:** no alarms, no backups and no log retention.
- **Docs drift** since Alexa and the Echo widget were shelved.

## 2. Top 10 to do first

1. **Adding from search can silently move a book you already have.** `SearchPage.tsx:34-53` calls
   `addToShelf`, which moves an existing entry (`core/src/shelf.ts`, "or moves it if it is already on one").
   "Want to read" on a finished book takes it off Read with no warning. Search hits should show "On your
   shelf", and a move should ask first.
2. **Expired sessions and network failures become raw text.**
   - `getAccessToken` quietly returns `undefined` when silent renew fails (`auth.ts:24-28`).
   - There is no Apollo error link (`apollo.ts:31-34`), and about 15 places show `Something went wrong: {message}` with no retry.
   - The routes have no `errorElement` (`routes.tsx`).

   Users need a "Session expired, sign in again" prompt and a Retry button.
3. **Kids can lock parents out.** Every book page shows the remove-from-shelf PIN box
   (`RemoveFromShelf.tsx`, rendered at `BookPage.tsx:262`). Wrong guesses there count toward the 5-try,
   15-minute lockout (`core/src/unlock.ts`), which also locks Settings.
4. **The web package's TypeScript isn't strict.** `packages/web/tsconfig.app.json` has no `"strict": true`
   and doesn't extend `tsconfig.base.json`, unlike every other workspace.
5. **The Cognito config is hardcoded in the web app.** `packages/web/src/config.ts:3-8` has region, pool
   id, client id and hosted-UI URL as literals copied from stack outputs. `vite.config.ts` proxies local
   development to the production API. If the pool is recreated, sign-in breaks and nothing catches it.
6. **Nothing alerts you.** There are no CloudWatch alarms or SNS topic (Lambda errors, API 5xx/429,
   migration-trigger failure), no log retention (Lambda logs likely never expire), and no budget alert.
7. **There is no DSQL backup or restore plan.** Deletion protection stops the cluster being deleted, but
   nothing recovers from a bad migration or a bug that corrupts rows.
8. **Expensive queries are unbounded.**
   - The GraphQL server has no depth, alias or complexity limit (`graphql/src/app.ts`). One request with dozens of `searchBooks` aliases can make hundreds of Hardcover calls (two pages and up to two retries each, `books/hardcover.ts`).
   - `family { profiles { shelf goal } }` is an N+1 of up to about 100 queries.
9. **Readers and finish dates can't be edited.** There is no `updateProfile` (name, emoji, colour, parent
   flag), and no way to change a finish date or record a re-read (the Finish panel hides on Read).
10. **Old Safari can crash the whole app.** `Intl.supportedValuesOf` runs at module load
    (`TimezoneSection.tsx:10`, statically imported through `routes.tsx`). Safari before 15.4 lacks it, so a
    family's old iPad would get a blank app, not just a broken Settings page.

## 3. Configuration and hardcoded values

| Value | Where | Recommendation |
|---|---|---|
| Region, pool id, client id, hosted-UI URL | `web/src/config.ts:3-8` | `VITE_*` env at build, filled from stack outputs, or a `config.json` the stack writes into the site |
| Dev proxy target (production API) | `web/vite.config.ts:14` | `VITE_API_PROXY` env, so local dev can target a dev stack |
| Domains `gnlfamily.com`, `books.gnlfamily.com` | `infra/lib/gnl-books-stack.ts:21-22`, `test.yml:46`, infra tests | CDK context (`cdk.json` / `-c`) in one `infra/config.ts` |
| Region `us-west-2` | `infra/bin/gnl-books.ts:9`, `deploy.yml:36`, `test.yml:46`, `web/config.ts:4`, tests | CDK env/context; workflow variable |
| Hosted-UI prefix `gnl-books` | `gnl-books-stack.ts:23`, `web/config.ts:7`, infra test | Context + web env |
| Dev port 5173 | `LOCAL_DEV_URL` (`gnl-books-stack.ts:33`) and `vite.config.ts:10-11` | One value; a mismatch silently breaks the OAuth callback |
| Secret names and keys (`gnl-books/cdk`, `gnl-books/app`, `parentTokenKey`, `hardcoverApiKey`) | `gnl-books-stack.ts:25-28`, `graphql/src/app.ts:108` | Pass names to the Lambda by env (already partly done); single constant per key |
| Throttle 10 rps / burst 20, Lambda memory and timeouts, refresh token 365 d, HSTS 365 d | `gnl-books-stack.ts` | Named settings in the infra config |
| Fixed resource names (cluster, pool, API, client) | `gnl-books-stack.ts:45,222,323,247` | Prefix from context, so a staging copy can coexist |
| Cover host `https://assets.hardcover.app` | CSP (`gnl-books-stack.ts:139`), but `web/src/Cover.tsx:14` accepts any `https://` | Check the host in `Cover.tsx` too (or share the constant) |
| Limits copied from server to web | PIN pattern (`PinForm.tsx:8`, `CreateFamily.tsx:14`), name 60, emoji 8 (`ProfilesSection.tsx`), review 5000 (`BookPage.tsx:30`), query 200 (`SearchPage.tsx:18`), title 300 (`ManualAddPage.tsx:91`), email 254 (`JoinFamily.tsx`), goal limits (`GoalsSection.tsx:9-11`) | A small shared limits module (e.g. export constants from `core` through a browser-safe entry, or a `@gnl-books/limits` package) used by both API validation and web |
| Lifetimes in UI copy | "The request lasts 7 days" (`JoinFamily.tsx`), `RENEW_AFTER_MS` vs server's 2 / 15 minutes (`ParentSessionProvider.tsx:22-24`) | Derive copy from the shared constants |
| Inline server limits | `graphql/src/schema.ts`: 60 (:333), 200 (:641,:651), 1000 (:648,:362), `MAX_RELEASE_YEAR` 2100 repeats `MAX_GOAL_YEAR` | Named constants in one validation module |
| Locale | `'en-US'` in `format.ts:8`, `JoinRequestsSection.tsx:13`; browser locale in `PinForm.tsx:13` | Pick one (one `formatDate` helper) |
| Default zone `America/Chicago` | `core/src/families.ts:10` | Fine as a constant; could be a per-deployment setting |
| Family, profile and request caps, PIN lockout, token TTLs | `core` constants | Fine as code; make overridable per environment only if a staging stack appears |

## 4. UX

**Navigation**
- **Header:** `App.tsx:22-36` has only the "Family Library" link and "Sign out". It shows no current reader, no Settings link and no "signed in as".
- **Switching reader:** the only way is a button at the bottom of a profile page (`ProfilePage.tsx:52-56`). Book, search and add pages only offer "Back to the shelves".
- **Sign out:** it is unconfirmed and always visible. On a shared tablet a child can end the family's year-long session.
- **Route changes:** there is no scroll restoration and no focus management, so a page can open mid-scroll and screen readers aren't told it changed. `document.title` never changes.

**Feedback**
- **Book page edits:** rating, review, progress and finish give no success message. Server errors appear at the top of the page (`BookPage.tsx:242`), far from the button on mobile.
- **Busy state:** one shared busy flag disables every panel at once (`useEdit`).
- **Review box:** the textarea remounts after saving because its `key` is the review text (`BookPage.tsx:248`), so focus is lost. There is no character counter.
- **Cached pages:** they still flash a spinner (`ProfilePage.tsx:15-23`, `BookPage.tsx:183`), though their comments say cached data shows at once.
- **Join requests:** "Check again" changes nothing while a request is still pending. A sent request is forgotten on reload (in-memory state in `JoinFamily.tsx`).

**Confirmations and copy**
- **Unconfirmed actions:** approving a join request isn't confirmed, though it grants access to every reader's books. Deny and "Remove goal" aren't confirmed either.
- **Parent flag:** "This reader is a parent" (`ProfilesSection.tsx:75-80`) never explains what it changes.
- **Shelf names:** they differ between screens, "Already read" (search, manual add) vs "Read" (shelves, book page).
- **Finishing a book:** "Move to → Read" and "I finished it" do overlapping things with no explanation. Progress and Finish also show on To-read books.
- **Sign-in screen:** it says "Welcome back" to first-time users (`AuthGate.tsx:21`).
- **Settings:** it is one long page that locks again whenever the tab is hidden. The time zone picker is a native select of about 400 zones.

## 5. Missing features users will expect

**Readers and books**
- **Editing:** a reader (name, emoji, colour, parent flag), a finish date or start date, and re-reads.
- **Shelves:** sort, filter and search within them, and paginate or group the Read shelf by year. Everything loads at once today, ordered by last update.
- **Moves:** an undo for "Move to" and remove.
- **Manual books:** editing after creation, plus the fields the API already supports (subtitle, publisher, description). Tags are stored but never shown.
- **Progress:** a percentage on shelf cards, a short history, and a prompt to set a goal from a reader's page.

**Search**
- **Already on shelf:** search hits should show it.
- **Persistent search:** keep the search in the URL (`?q=`), so going back restores it, and link to the book after adding it.

**Accounts and joining**
- **Remove an adult** from a family (approved join requests can't be undone).
- **Notify the parent** of a join request (email), and show when a request expires.
- **"Signed in as"**, and a clear re-sign-in when the session expires.

**Polish**
- A web app manifest and `theme-color` for "Add to Home Screen" on Android.
- A dark-mode toggle (it only follows the system today).
- A searchable time zone picker.

## 6. API and core design

**Structure**
- **`schema.ts` size:** `graphql/src/schema.ts` is 824 lines holding types, about 15 validators, error mapping and every resolver. Split it by domain (books, shelf, goals, family/profiles, join/unlock), with a `validation.ts` and a central error map.
- **Repeated errors:** the same NOT_FOUND error is written out 10 or more times. "Family not found" has no code, and renewing at the 15-minute cap throws a plain `Error` (`parentToken.ts:37`). Both reach the client as masked internal errors.
- **Duplicated helpers:** `isRecord`/`num` (`hardcover.ts` and `relevance.ts`), `clean`/`withoutUndefined`, and the ISBN regex (`hardcover.ts` and `schema.ts`).
- **Unused code:** `pg-connection-string` is an unused dependency. Several exports are used only by tests, or not at all.

**Correctness**
- **Writes that skip the retry:** `setFamilyTimezone` (`families.ts`) and `denyJoinRequest` (`joinRequests.ts`) write outside `withTransaction`, so a DSQL conflict surfaces as an error.
- **Unbounded reads:** `listShelf` and the CSV export read the whole shelf at once.
- **CSV formula injection:** cells starting with `=`, `+`, `-` or `@` aren't neutralised (`csv.ts:34-37`).
- **Possible orphan rows:** `deleteProfile` can race with `addToShelf` or `setGoal`. Whether that leaves orphan rows depends on whether DSQL enforces the `references` clauses **(verify)**.
- **Duplicate-entry race:** two simultaneous adds of the same book hit the unique index with `23505`, which isn't retryable, so the caller sees a server error.

**Security and abuse**
- **Introspection:** it isn't explicitly disabled in production.
- **PIN lockout:** it never escalates (the counter resets after each lock), allowing about 480 guesses a day.
- **Join-request spam:** after a denial, the same person can ask again at once. A few Cognito accounts can also fill a family's 5-request cap for 7 days.
- **Email lookup:** a request matches any member's email, not only a parent's, and the email index isn't unique, so a duplicate email picks a family nondeterministically.
- **Timing:** an unknown email does less work than a known one, so response time could hint at which emails have families. This is low risk.

**Observability**
- Logs are plain `console.*` with no request id, operation name or structure, and there are no metrics for search failures or retry counts.

## 7. Web code structure

- **No GraphQL codegen.** Result types are hand-written in `queries.ts:340-447` and can drift from the schema, and some `useMutation`/`client.query` calls are untyped.
- **`queries.ts`** is 447 lines covering every feature. `ENTRY_FIELDS` is a string interpolated into `gql` instead of a fragment, and `ADD_TO_SHELF` returns a different subset, so the cache gets partial entries.
- **Three mutation styles:** `useEdit` (book page, settings), `useMutation` (create/join family), and raw `client.mutate` with hand-made busy and error state (search, manual add, export, parent session). Cache freshness is handled three different ways too.
- **Duplication:**
  - Shelf-label tables appear in four files.
  - The reader avatar block appears in three.
  - The "Page X of Y" plus progress bar, the year/pages line, the whole-number regex and the `e instanceof Error ? …` idiom are each repeated.
- **Book page:** `BookPage.tsx` is 278 lines and downloads the reader's entire shelf, descriptions included, to show one entry.
- **Smaller issues:**
  - `cover-sm` is dead CSS.
  - `ProfilesSection.tsx:173-174` has a redundant check.
  - `Shelves.tsx:43` uses a non-null assertion.
  - `Separator` sits directly inside a `ul` (`GoalsSection.tsx:101-103`).
  - The goal year comes from the browser in Settings but from the family's time zone on the profile page, so they disagree around New Year.
- **Token refresh:** `getAccessToken` can start several silent renews at once when requests overlap.

## 8. Infra, CI and operations

**Environments**
- **Production only:** there is one stack and one environment, so sign-up, migrations and CSP changes are first tried on the live site. Fixed resource names prevent a second copy.

**Deploy workflow**
- **Concurrency:** `deploy.yml` has no `concurrency` group, so two runs can overlap.
- **Test gate:** it reruns tests instead of requiring a green `test.yml` on the same commit.
- **Diff review:** `cdk diff` never runs on PRs, and the deploy uses `--require-approval never`, so a destructive change is only seen during the deploy.
- **Dependencies:** actions are pinned by tag, not commit SHA, and there is no Dependabot or Renovate.

**Linting and formatting**
- **Lint:** only `packages/web` has a lint script (oxlint), and CI never runs it.
- **Formatting:** there is no formatter (Prettier/Biome) or `.editorconfig`, and the style already varies.

**Network edge**
- **API bypass:** the API Gateway `execute-api` URL is public and skips CloudFront.
- **Throttle:** it applies to the whole stage, so one noisy caller can use it all up.
- **Open sign-up protections:** there is no WAF, CAPTCHA or SES. Cognito's built-in email (about 50 a day) is easy to exhaust.

**Migrations**
- **Forward only:** applied DDL stays if the deploy rolls back.
- **Async indexes:** `CREATE INDEX ASYNC` finishes after the trigger returns.
- **API gap:** there is a few-second API gap when role mappings change.
- **Timeout:** the trigger's 5-minute timeout caps long migrations.

**Already good:** least-privilege workflow permissions, the lockfile-host guard, a credential-free synth in CI, deletion protection and RETAIN on the cluster and user pool, and the least-privilege database role.

## 9. Docs and cleanup

**Stale docs**
- **`CLAUDE.md`:** it still opens with "Early stage: only the root scaffold exists", says there is no lint script, and describes the Alexa skill and Echo widget as live clients.
- **`CONTEXT.md`:** its status is from 2026-11-03 and still plans Alexa and the Echo widget.
- **`TODO.md` and `PLAN.md`:** a few lines are stale, such as "Admin-created users only", the Alexa open questions, and "React Router v7".

**Missing docs**
- **No root README:** `infra/README.md` is untouched `cdk init` boilerplate, and its deploy instructions are wrong. A newcomer has no guide to the hand-made `gnl-books/app` secret, bootstrap, the hosted zone, the `.yarnrc` registry trap, or running tests against local Postgres.

**Alexa/Echo leftovers**
- **Database:** the `alexa_devices` table (still updated by `deleteProfile`) and the `profiles.alexa_person_id` column.
- **API:** `ProgressSource` exposes `ALEXA` and `WIDGET` to any client.
- **Other:** comments in `auth.ts`, the `core/package.json` description, and the ASK CLI entries in `.gitignore`.

**Dependency drift**
- `vite`, `@vitejs/plugin-react` and `tsx` are pinned at different versions across workspaces.
- `aws-cdk` is exact while `aws-cdk-lib` uses `^`.
- There is no `packageManager` or `engines` field.
