# Family Library — a private Goodreads for the GNL family, with Alexa

## Context

The family wants a shared place to track what each person has read, how they rated it, and what's next — a small private Goodreads. The kids shouldn't have real Goodreads accounts yet, but the reading history they build should **follow them to a real account when they're older**. On top of that, the app should reach the household's Echo devices: a widget on the Echo Show 15 the kids can touch, and voice updates from any Echo Dot.

This is also a deliberate learning project. Infrastructure stays on AWS (the domain is in Route 53), but the stack is chosen for what's worth learning, not for what `gnl-lambdas` already does.

### The Goodreads API is gone — and the CSV is a better bridge anyway

Goodreads stopped issuing developer keys on 2020-12-08 and wound down existing ones; calls that used to work return `403`, and Amazon has announced no replacement. Wrapping real Goodreads accounts is off the table.

Their **CSV import still works**, so that's the migration path, and it's a stronger guarantee than an API would have been — it depends on no running service. The load-bearing design constraint:

> The per-person data model is a **superset of the Goodreads export CSV**. Graduating a kid to real Goodreads is one download → one upload, carrying their whole history, ratings, shelves, and reviews.

### What the Alexa research changed

- **Custom skills are alive.** Alexa+ added AI-native SDKs (Action, Web Action, Multi-Agent) but classic ASK custom skills remain supported, and nothing skill-, widget-, personalization-, or account-linking-related is on the deprecated list. Recent removals are unrelated (Routines Kit, Smart Home API v2).
- **No certification needed.** A skill left in **development stage** runs on devices registered to the same Amazon account as the developer account. No store listing, no privacy policy, and none of the Kids-category restrictions that would otherwise forbid account linking in a child-directed skill.
- **Alexa already knows which kid is talking.** `context.System.person.personId` is GA: once each family member has a voice profile, every request carries a stable per-person ID. *"Alexa, tell Family Library I read thirty pages"* resolves to the right child from any Echo in the house. This is the single best feature available here and the design is built around it.
- **Widgets are real but the riskiest piece.** Third-party widgets are supported and survived the Alexa+ home-screen redesign, but they use a *subset* of APL, must be associated with a skill, and are updated through the **Data Store REST API** rather than normal skill responses — a genuinely different programming model. Treated below as a spike, not a v1 promise.

**The architectural consequence:** three clients (web, voice, widget) share one dataset, so this needs a **real shared API**. That's the concrete reason to break from the `gnl-lambdas` shape, where Next.js Server Components read DynamoDB directly — a pattern that cannot extend to a Lambda-hosted skill and a Data Store-fed widget.

### Decisions

| Area | Choice |
|---|---|
| Infra | AWS CDK v2, **us-west-2**, account `<AWS_ACCOUNT_ID>` |
| Domain | `books.gnlfamily.com` (hosted zone `<HOSTED_ZONE_ID>` already exists) |
| Database | **Aurora DSQL** — serverless Postgres, permanent free tier, scale-to-zero |
| API | **GraphQL in one Lambda** — Pothos (code-first schema) + Apollo Server 5 |
| Frontend | **Vite + React Router v7 SPA** on S3 + CloudFront |
| Auth | **Cognito** user pool — web sign-in *and* Alexa account linking (OAuth2) |
| Book metadata | **Hardcover GraphQL**, behind a swappable `BookSource` interface |
| Voice | ASK custom skill (development stage), `personId` → profile |
| v1 scope | Shelves + ratings + reviews · progress + yearly goals · per-person Goodreads CSV export · Alexa voice logging |
| Out of v1 | Family activity feed, barcode scanning, recommendations |

**Cost:** DSQL free tier is 100k DPUs + 1 GB/month with no expiry and true scale-to-zero; Lambda and CloudFront are free at this volume; a couple of adult Cognito users sits in the free tier. Effectively $0/month.

---

## Repo layout

New repo `~/development/personal-projects/gnl-books`, a Yarn-workspaces monorepo. **Step one is `git init` plus this document committed as `PLAN.md` at the repo root**, so the design travels with the code.

```
gnl-books/
├── PLAN.md                 # this document
├── infra/                  # CDK app (single stack, sectioned)
│   ├── bin/gnl-books.ts
│   └── lib/gnl-books-stack.ts
├── packages/
│   ├── core/               # domain logic, Kysely queries, DSQL connection, Hardcover client, CSV
│   ├── graphql/            # Pothos schema + Apollo Server Lambda handler
│   ├── alexa/              # ask-sdk-core handlers + interaction model JSON
│   ├── web/                # Vite + React Router v7 SPA
│   └── widget/             # APL widget document + Data Store updater
└── db/migrations/          # numbered .sql files
```

`packages/core` is the keystone: **both the GraphQL Lambda and the Alexa Lambda import it directly** rather than the skill calling the API over HTTP. That keeps one implementation of the business rules and avoids a Lambda→API→Lambda hop inside Alexa's ~8-second response budget.

Conventions worth carrying over from `gnl-lambdas`: `.nvmrc` → `24`, `.npmrc` pinning `registry=https://registry.npmjs.org/` (the JFrog gotcha), `NodejsFunction` with no bundling config, grant-based IAM, `RemovalPolicy.RETAIN` on stateful resources, and CI copied from `.github/workflows/` using the existing OIDC role `arn:aws:iam::<AWS_ACCOUNT_ID>:role/github-deploy`.

> Account-specific identifiers (`<AWS_ACCOUNT_ID>`, `<HOSTED_ZONE_ID>`) are placeholders. Real values come from the deploy environment and `cdk.context.json`, not from this document.

**Testing moves to Vitest** (not Mocha) — it's native to the Vite toolchain, handles ESM/TS without ceremony, and works for React component tests too.

---

## Database — Aurora DSQL

A real relational schema. DSQL gained **foreign keys, sequences, and identity columns in September 2026**, with full `NO ACTION`/`RESTRICT`/`CASCADE`/`SET NULL`/`SET DEFAULT` actions and deferrable constraints — so no compromise on referential integrity.

```sql
create table families (
  id uuid primary key,
  name text not null,
  parent_pin_hash text not null,
  created_at timestamptz not null default now()
);

-- Cognito users (the adults). Kids never get accounts.
create table accounts (
  cognito_sub text primary key,
  family_id uuid not null references families(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Everyone who reads, kids included.
create table profiles (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  emoji text,
  color text,
  is_parent boolean not null default false,
  alexa_person_id text unique,          -- voice profile → profile
  created_at timestamptz not null default now()
);

-- Shared metadata cache, one row per book across the whole family.
create table books (
  id uuid primary key,
  source text not null,                 -- 'hardcover' | 'manual'
  source_id text,
  title text not null,
  subtitle text,
  authors text[] not null default '{}',
  isbn13 text, isbn10 text,
  pages int, publisher text, binding text,
  release_year int, original_pub_year int,
  cover_url text,
  series_name text, series_position numeric,
  description text,
  cached_at timestamptz not null default now()
);
create unique index books_source_idx on books (source, source_id);

create table shelf_entries (
  id uuid primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  book_id   uuid not null references books(id),
  shelf text not null,                  -- 'to-read' | 'currently-reading' | 'read'
  rating smallint,                      -- 1..5, null = unrated
  review text,
  private_notes text,
  date_added date not null default current_date,
  date_started date,
  date_read date,
  read_count int not null default 1,
  current_page int,
  owned boolean not null default false,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create unique index shelf_entries_profile_book_idx on shelf_entries (profile_id, book_id);

-- Bedroom Echo Dots: device → whose room it's in.
-- deviceId is unique per (skill, user), so it's safe as a PK within this one skill.
create table alexa_devices (
  device_id text primary key,
  family_id uuid not null references families(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  label text,                           -- "Maya's room"
  last_seen_at timestamptz not null default now()
);

create table reading_goals (
  profile_id uuid not null references profiles(id) on delete cascade,
  year int not null,
  target int not null,
  primary key (profile_id, year)
);

-- Every "I read 30 pages" — from web, voice, or widget.
create table progress_events (
  id uuid primary key,
  shelf_entry_id uuid not null references shelf_entries(id) on delete cascade,
  at timestamptz not null default now(),
  page int,
  pages_read int,
  source text not null                  -- 'web' | 'alexa' | 'widget'
);
```

`shelf` uses the exact Goodreads `Exclusive Shelf` vocabulary, so CSV export is a pass-through rather than a translation.

`progress_events` is deliberately an append-only log rather than just a counter — it's what makes "pages read this week" on the widget and a reading-streak chart possible later, and voice logging has somewhere natural to land.

### DSQL constraints to design around

These are real and will bite if ignored:

- **Primary keys are random UUIDv4**, generated in app code. Explicitly **not** UUIDv7 — DSQL auto-partitions by key range, so time-ordered IDs create a write hotspot. Random is what you want here.
- **Optimistic concurrency control, not locks.** Conflicts surface as `SQLSTATE 40001` / `OC000` / `OC001` at commit. `packages/core` needs a single `withRetry()` wrapper with exponential backoff around every transaction, and all transaction logic must be idempotent. This is non-negotiable, not an optimization.
- **DDL and DML must be in separate transactions, and a transaction may contain only one DDL statement.** This shapes the migration runner.
- **Max 3,000 rows modified per transaction.** Fine at family scale, but chunk any bulk seeding.
- **Connections time out after 1 hour**, and IAM auth tokens default to 15 minutes. Use the official `@aws/aurora-dsql-node-postgres-connector`, which wraps `pg` and handles token generation and rotation; treat connections as disposable.
- **No triggers, no PL/pgSQL** (SQL functions only), **no temp tables**, **no `TRUNCATE`**. Use `CREATE INDEX ASYNC` instead of `CREATE INDEX`.
- One database (`postgres`) per cluster; isolation fixed at `Repeatable Read`; `C` collation; UTC.

### Migrations

Numbered `.sql` files in `db/migrations/`, applied by a Lambda invoked via `triggers.Trigger` on deploy — the same one-shot pattern as `MortgageRatesBackfillTrigger` in `gnl-lambdas`, but with `executeOnHandlerChange: true`. A `schema_migrations` table tracks applied versions. The runner must execute **one DDL statement per transaction** and retry `OC001` ("schema has been updated by another transaction"), which is routine during migrations.

---

## API — Pothos + Apollo Server 5 in one Lambda

`packages/graphql`:

- **Pothos** (`@pothos/core`) builds the schema code-first in TypeScript, so types flow from the database layer to the schema without a separate SDL file. Add `@pothos/plugin-scope-auth` for `isParent` gating, which maps cleanly onto the parent-PIN requirement.
- **Apollo Server 5** serves it, via `@as-integrations/aws-lambda` (v4.x supports AS5) using `startServerAndCreateLambdaHandler` with `handlers.createAPIGatewayProxyEventV2RequestHandler()`.
- **Two entry points, one schema.** `src/schema.ts` holds the Pothos schema; `src/lambda.ts` wraps it for Lambda; `src/dev.ts` runs `startStandaloneServer` from `@apollo/server/standalone` for local work. The duplication is a handful of lines — keep *all* logic in `schema.ts` so the two stay honest.
- **Auth:** `aws-jwt-verify` (official AWS library) validates the Cognito token from `Authorization: Bearer`, in Apollo's `context` function. Resolver context is `{ cognitoSub, familyId, isParent }`. Every query is scoped by `familyId` at the data layer — **never trust an ID from the client**.
- **Kysely** for type-safe SQL. Not an ORM: it generates exactly the SQL you write, which matters when the dialect has DSQL's quirks. Types are generated from the live schema.
- Optional later: point the schema at **GraphOS** for a schema registry and CI schema checks — a genuine benefit of this choice, and an easy add once the schema settles.

Schema sketch:

```graphql
type Query {
  me: Account!
  family: Family!
  profile(id: ID!): Profile
  searchBooks(query: String!, limit: Int): [BookSearchResult!]!
  book(id: ID!): Book
}

type Mutation {
  addToShelf(profileId: ID!, book: BookInput!, shelf: Shelf!): ShelfEntry!
  rateBook(shelfEntryId: ID!, rating: Int!): ShelfEntry!
  reviewBook(shelfEntryId: ID!, review: String!): ShelfEntry!
  logProgress(shelfEntryId: ID!, page: Int, pagesRead: Int, source: ProgressSource!): ShelfEntry!
  finishBook(shelfEntryId: ID!, dateRead: Date, rating: Int): ShelfEntry!
  setGoal(profileId: ID!, year: Int!, target: Int!): ReadingGoal!
  exportGoodreadsCsv(profileId: ID!): String!        # parent-only
  createProfile(input: CreateProfileInput!): Profile! # parent-only
  linkAlexaPerson(profileId: ID!, personId: String!): Profile!        # parent-only
  linkAlexaDevice(profileId: ID!, deviceId: String!, label: String): AlexaDevice! # parent-only
}
```

**Routing:** the HTTP API is attached to the *same* CloudFront distribution as the SPA, as a second origin at `/graphql`. One domain, so **no CORS** and no separate API subdomain.

---

## Auth — Cognito, shared by web and voice

One user pool. **Adults get Cognito accounts; kids don't** — they're profiles inside a family.

- **Web:** Hosted UI with PKCE via `react-oidc-context`. Long refresh tokens so the family tablet stays signed in. After sign-in, a profile picker ("Who's reading?") sets the active profile client-side.
- **Alexa:** account linking against the same pool — a documented Amazon + Cognito pattern. Authorization endpoint is the Cognito Hosted UI `/oauth2/authorize`, token endpoint `/oauth2/token`, with Amazon's redirect URLs (`pitangui.amazon.com`, `layla.amazon.com`, `alexa.amazon.co.jp`) registered as callbacks. Set refresh-token expiry long (Cognito allows up to 3650 days) so the link doesn't silently rot.
- **Parent PIN** still gates sensitive actions in-app (deleting books, editing another profile's shelf, CSV export, profile management) — because once signed in, a kid has the session. Hash with `scrypt` + `timingSafeEqual` from `node:crypto`, stored in `families.parent_pin_hash`. On the voice side, `authenticationConfidenceLevel` on the `person` object can gate parent intents instead.

**First-run bootstrap:** the first Cognito user to sign in with no `accounts` row creates a family, becomes its parent profile, and sets the PIN.

---

## Alexa skill — `packages/alexa`

`ask-sdk-core` on a Lambda. Invocation name: **"family library"**.

Request flow: no `accessToken` → return a `LinkAccountCard`. Otherwise verify the Cognito token → `familyId`, then resolve *who is speaking*.

### Identifying the reader — a three-step chain

This is the heart of the voice design, and no single signal is sufficient:

1. **`context.System.person.personId`** — the voice profile. Best signal when present: it works from any device in the house and survives someone wandering into the kitchen.
2. **`context.System.device.deviceId`** — looked up in `alexa_devices`. Each kid has their own Dot in their bedroom, so the device *is* the identity. This is likely the **primary** path for the kids (see below), not merely a fallback.
3. **Ask once per session** — *"Who's reading?"* — and cache the answer in session attributes so it's asked at most once per conversation.

**Why step 2 may matter more than step 1 for the kids:** creating an Alexa voice ID for a child automatically switches that device into **Amazon Kids mode**, and Amazon's personalization docs never confirm that `personId` is delivered for child profiles — they only state the (inapplicable) rule that *child-directed* skills can't use personalization. Our skill is never published and never categorized as a Kid Skill, so the policy doesn't bind us, but the behavior is unverified. A bedroom Dot mapped by `deviceId` sidesteps the question entirely.

**Amazon Kids is not a blocker.** Parents approve specific third-party skills through the Parent Dashboard at `parents.amazon.com`, so a kid's Dot can invoke this skill. Whether a *development-stage* skill surfaces there is the one thing to verify hands-on early.

**`deviceId` is re-pairable, not permanent** — it's regenerated if the skill is disabled and re-enabled. So treat the mapping as something that can go stale: when an unknown `deviceId` appears, upsert it into `alexa_devices` with `last_seen_at` and fall through to step 3. `/settings` then lists recently-seen unmapped devices and person IDs for a parent to assign, which is the same UI for both. (Worth investigating whether `persistentEndpointId` is exposed here and is more stable — it would simplify this.)

Intents:

| Intent | Example utterance |
|---|---|
| `StartBookIntent` | "I started reading {book}" |
| `LogProgressIntent` | "I read {pages} pages" / "I'm on page {page}" |
| `FinishBookIntent` | "I finished {book}" |
| `RateBookIntent` | "give it {rating} stars" |
| `WhatAmIReadingIntent` | "what am I reading?" |
| `HowAmIDoingIntent` | "how am I doing on my goal?" |
| `AddToWantToReadIntent` | "add {book} to my list" |

Plus the required `AMAZON.Help`/`Cancel`/`Stop`/`Fallback`.

**The key design decision:** the book slot is `AMAZON.SearchQuery`, resolved by fuzzy-matching against **that person's own current shelf** (typically 3–10 books), not against a global catalog. Matching a child's mumbled title against ten known books is a solved problem; matching it against millions is not.

CDK owns the Lambda and grants `alexa-appkit.amazon.com` invoke permission scoped to the skill ID via `eventSourceToken`. The skill itself and its interaction model are managed with the ASK CLI (`ask deploy`) against the checked-in model JSON — simpler than driving `alexa-ask.CfnSkill`, which needs LWA refresh tokens in Secrets Manager. The skill stays in **development stage** permanently.

---

## Widget — `packages/widget` (spike first)

An APL widget for the Echo Show 15: each kid's current book, a progress bar, and their goal ring; tapping sends a `SendEvent` to the skill.

Updates go through the **Data Store REST API**, not skill responses — a Lambda pushes new widget data when a shelf entry or progress event changes.

**Build a hello-world widget and get it rendering on the actual Show 15 before writing any real widget code.** This is the least-documented part of the stack and the only piece whose feasibility isn't fully established. Everything else in this plan works without it.

---

## Book metadata — swappable `BookSource`

In `packages/core/books/`. The seam that keeps Hardcover a single dependency without lock-in:

```ts
export interface BookSearchResult {
  sourceId: string
  title: string
  subtitle?: string
  authors: string[]
  isbn13?: string
  isbn10?: string
  pages?: number
  releaseYear?: number
  coverUrl?: string
  seriesName?: string
  seriesPosition?: number
  description?: string
}

export interface BookSource {
  readonly name: 'hardcover' | 'google' | 'manual'
  search(query: string, opts?: { limit?: number }): Promise<BookSearchResult[]>
  getById(sourceId: string): Promise<BookSearchResult | null>
}
```

**Why Hardcover:** 5,000 req/day free (vs Google Books' 1,000), 60/min, and — decisively — books → editions → ISBNs, authors, covers, and **series** in one graph. Google Books has no series concept, which matters more than it sounds: *Magic Tree House*, *Wings of Fire*, and *Dog Man* are how kids actually think about reading.

- `hardcover.ts` POSTs to `https://api.hardcover.app/v1/graphql` with `Authorization: Bearer <token>` from Secrets Manager.
  - Search: `search(query: $q, query_type: "Book", per_page: 20) { results }` — `results` is **untyped Typesense JSON**, so parse through a defensive guard that warns and drops malformed entries.
  - Detail: Hasura-style — `books(where: {id: {_eq: $id}}) { ... contributions(where: {contributor_role: {slug: {_eq: "author"}}}) { author { name } } default_physical_edition { isbn_13 isbn_10 pages publisher { name } } }`
- Every book we touch is **cached into our `books` table**, so the library becomes self-sufficient and the quota stops mattering after first touch.
- **Manual add** covers anything search can't find — which fully neutralizes Hardcover's thinner catalog on obscure and self-published titles.

---

## Goodreads CSV export

`exportGoodreadsCsv(profileId)` returns the CSV as a string (hundreds of rows at most); the browser turns it into a `Blob` and downloads it. Parent-PIN gated.

Emit the **full** Goodreads header, in order:

```
Book Id, Title, Author, Author l-f, Additional Authors, ISBN, ISBN13,
My Rating, Average Rating, Publisher, Binding, Number of Pages,
Year Published, Original Publication Year, Date Read, Date Added,
Bookshelves, Bookshelves with positions, Exclusive Shelf,
My Review, Spoiler, Private Notes, Read Count, Owned Copies
```

Rules in `packages/core/csv.ts`:
- `Book Id` blank — Goodreads assigns its own on import.
- Dates as `YYYY/MM/DD` (Goodreads' own export format).
- `My Rating` is `0` when unrated, not blank.
- `Author l-f` derived as `Last, First`; authors past the first go to `Additional Authors`.
- ISBNs **plain**, not Goodreads' `="9780439023481"` Excel-armoring — import accepts plain and it's less fragile.
- **Write both `Bookshelves` and `Exclusive Shelf`.** There's a long-standing Goodreads import bug where `Exclusive Shelf` alone silently fails to apply; populating both is the known workaround.
- Standard escaping: quote any field containing `,`, `"`, or a newline; double internal quotes.

---

## Web app — `packages/web`

Vite + **React Router v7** in framework mode with `ssr: false` → static build → S3, fronted by CloudFront with OAC. 403/404 rewrite to `/index.html` so client-side routing works.

- **Apollo Client**, paired with the Apollo Server choice — normalized cache, and the client most teams actually use. Typed hooks come from **`graphql-codegen`** (`client-preset`, or `typescript-react-apollo` for generated hooks). This is where the GraphQL learning really lands — end-to-end type safety from Postgres column to React prop.
- `react-oidc-context` for Cognito Hosted UI + PKCE.

| Route | Purpose |
|---|---|
| `/` | Profile picker — "Who's reading?" |
| `/p/:profileId` | Shelves: Reading / Want to Read / Read, cover grid, goal ring |
| `/p/:profileId/book/:bookId` | Rating, review, progress, dates, who else in the family read it |
| `/search` | Hardcover search → add to shelf; manual-add fallback |
| `/settings` | Parent-PIN gated: profiles, goals, **Alexa person + device linking**, CSV export |

Built responsive and touch-first — it doubles as a usable page in the Echo Show's browser, which is a decent fallback if the widget spike disappoints.

---

## Build sequence

Ordered so the app is genuinely useful partway through, and the risky parts come after the valuable ones.

1. **Infra skeleton** — CDK stack, DSQL cluster, migration runner, `books.gnlfamily.com` serving a placeholder SPA.
2. **Schema + `core`** — migrations, Kysely types, DSQL connection with the official connector, `withRetry()` OCC wrapper.
3. **Cognito** — user pool, Hosted UI, SPA sign-in, first-run family/profile bootstrap, parent PIN.
4. **GraphQL API** — Pothos + Apollo Server behind CloudFront `/graphql`, codegen wired into the web build.
5. **Hardcover `BookSource`** — search, add to shelf, book caching, manual add.
6. **Shelves** — ratings, reviews, dates, progress, goals in the SPA.
7. **CSV export** — and immediately validate a real import (see below).
8. **Alexa skill** — account linking, the `personId` → `deviceId` → ask resolution chain, the seven intents.
9. **Widget spike** → only then the real widget.

**The app is worth using after step 7 even if 8 and 9 never happen.** Given five unfamiliar technologies in one project, that ordering is the main defense against stalling at 70%.

---

## Verification

**Local**
```bash
yarn test                     # vitest across all packages
yarn workspace @gnl-books/web dev
yarn workspace @gnl-books/graphql dev   # Apollo standalone + Sandbox
cd infra && npx cdk synth
```

**Database** — connect with `psql` using a DSQL IAM token and confirm migrations applied:
```sql
select * from schema_migrations order by version;
```
Deliberately force a concurrent write conflict to prove `withRetry()` actually handles `40001`/`OC000` — this is the easiest thing to get wrong and the hardest to notice until production.

**Web** — after deploy:
1. `books.gnlfamily.com` redirects to Cognito Hosted UI; sign in; first run creates the family and parent profile and prompts for a PIN.
2. Create a profile for each kid.
3. Search a book one of them has actually read — use a **series** title to confirm series data arrives — add to **Read**, rate 4 stars, write a one-line review.
4. Reload; it persists. Confirm in SQL: `select * from shelf_entries join books using (...) where profile_id = '...'`.
5. Set a yearly goal; confirm the ring counts only `shelf = 'read'` entries with `date_read` in the current year.
6. Open the book from another profile — it should show the first kid's rating.

**CSV — the acceptance test that matters.** Export, then create a throwaway Goodreads account and import the file at `goodreads.com/review/import`. Confirm titles, ratings, shelves, and reviews all land. *This is the entire premise of the project — validate it at step 7, not months later.*

**Alexa** — do steps 1–2 as an early spike, before building the intents:
1. Link the account in the Alexa app (the skill shows in **Skills & Games** with a development badge).
2. **Verify the development-stage skill can be approved for the kids' profiles** in the Parent Dashboard at `parents.amazon.com`, and that it's invokable from a bedroom Dot in Amazon Kids mode. *This is the one real unknown in the voice design* — if it fails, voice becomes a shared-device feature (kitchen Echo / Show 15) rather than a bedroom one, which is a scope change worth knowing about on day one rather than at step 8.
3. Log the raw request envelope from a kid's Dot and check **whether `context.System.person.personId` is present** for a child voice profile. This determines whether the kids resolve by voice or by device.
4. From a bedroom Dot: *"Alexa, tell Family Library I read thirty pages."* Confirm a `progress_events` row with `source = 'alexa'` and the **correct `profile_id`**, without anyone saying their name.
5. *"Alexa, ask Family Library what I'm reading"* and *"...how am I doing on my goal?"*
6. Repeat from a different child's room; confirm it writes to a different profile.
7. Disable and re-enable the skill, then confirm the stale `deviceId` is handled gracefully — it should ask "who's reading?" and let a parent re-map, not crash or write to the wrong child.

**Widget** — hello-world renders in the Widget Gallery on the Show 15 before any real widget work begins.

---

## Risks

- **Five unfamiliar technologies at once** (DSQL, Pothos/Apollo, React Router v7, Cognito+OAuth, Alexa/APL). The single biggest risk to the project shipping. Mitigated by the build order: useful app by step 7, voice and widget as additive.
- **Apollo's two entry points** (Lambda vs standalone) can drift. Keeping the schema and all resolver logic in `schema.ts`, with both entry points as thin wrappers, is the discipline that prevents "works locally, breaks deployed."
- **DSQL optimistic concurrency.** Forgetting retry logic produces rare, confusing failures under concurrent writes. The `withRetry()` wrapper must be the only way `core` opens a transaction.
- **DSQL migration constraints** — one DDL per transaction, DDL separate from DML, `OC001` retries expected. The runner has to be built for this from the start.
- **`personId` may never arrive for child profiles.** Unverified in Amazon's docs, and a kid's voice ID forces the device into Amazon Kids mode. Mitigated by the `deviceId` chain — bedroom Dots identify their owner regardless — with "who's reading?" as the final fallback.
- **Development-stage skill availability under Amazon Kids** is the single genuine unknown in the voice design. Verify it in week one (verification step 2), because a failure there changes voice from a bedroom feature to a shared-device one.
- **`deviceId` is regenerated when a skill is disabled and re-enabled**, so device mappings can silently go stale. Unknown devices must fall through to asking rather than guessing — writing a kid's progress to the wrong sibling is the one error that would actually upset someone.
- **Widget Data Store API** is the least-documented surface here; the spike exists to find out early.
- **Hardcover PAT expiry** — choose a long expiry and note the date. An expired token breaks search while cached books keep working, which is a confusing failure mode; surface a clear error in the UI.
- **Goodreads could change or drop CSV import.** Low likelihood, but it's the project's load-bearing assumption — hence validating a real import early.
- **Cognito refresh-token expiry** on the Alexa link. Set it long (up to 3650 days), or the skill silently stops working months later.
