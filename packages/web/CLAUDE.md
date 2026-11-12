# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Workspace guide for `packages/web` (`@gnl-books/web`): the single-page app. React 19, Vite 8, react-router 8, Apollo Client 4, Radix Themes, `react-oidc-context` for Cognito sign-in. Repo-wide rules are in the root `CLAUDE.md`.

## Commands

```bash
yarn workspace @gnl-books/web dev        # Vite on :5173 (strictPort: Cognito lists this exact callback URL)
yarn workspace @gnl-books/web build      # tsc -b && vite build; from the root, `yarn build:web`
yarn workspace @gnl-books/web lint       # oxlint (CI does not run it yet)
yarn workspace @gnl-books/web typecheck  # tsc -b
yarn test --project web                  # from the repo root (happy-dom + Testing Library); -t "name" or a path for one
```

`dev` proxies `/graphql` to the **deployed** site, so local development reads and writes production data through your real sign-in. Sign-in needs the real Cognito hosted UI. In production the same path is served by CloudFront on the site's own origin, so there is no CORS and the client uses a relative `/graphql`.

## UI constraints from the content security policy

The CSP (set in `infra/lib/gnl-books-stack.ts`) allows no inline `<style>` elements and no inline scripts, and a static site cannot use nonces. So:

- The UI is **Radix Themes** plus plain CSS files (`src/index.css` for what the theme lacks). Do not add a CSS-in-JS library (Emotion, styled-components, MUI, Chakra, Mantine), and avoid Radix components that inject a style tag or lock scroll (Dialog, Select, Popover, DropdownMenu). Native `<select className="native">` is used instead.
- Inline `style="…"` **attributes** are allowed (`style-src-attr`). Fonts and images must come from `'self'`; book covers only from `https://assets.hardcover.app` (`Cover.tsx` renders https only, no-referrer).
- If a change needs one of these, loosen the policy in the stack on purpose rather than working around it.

## Architecture

- `main.tsx` → `routes.tsx` (route definitions only; tests rebuild the tree with `createMemoryRouter(routes[0].children)`) → `App.tsx` (header, sign-out, and `AuthGate`, so every page including 404 is behind sign-in).
- **Auth and config:** `auth.ts` configures `react-oidc-context` (code + PKCE, long refresh token). `config.ts` holds the Cognito region, pool id, client id and hosted-UI URL as **literals copied from the stack outputs**; recreating the user pool means editing it.
- **`apollo.ts`** builds the client from injected pieces (`getAccessToken`, `getParentToken`, `fetch`), which is what lets tests pass a fake fetch. The bearer token goes on every request; `X-Parent-Token` only when a parent session is unlocked.
- **`queries.ts`** holds every GraphQL document and the hand-written result types (there is no codegen, so types can drift from the schema). **Every query that reads `family` must ask for `id`**, so Apollo stores the family as one object and merges what each query reads; without it a query that skips a field replaces the whole object. `test/queries.test.ts` guards this: add new family queries to its list.
- **Parent unlock** is held in memory only (`parentSession.ts`). `ParentSessionProvider` renews it on activity (at most every 30 s), and locks on expiry, a hidden tab, or the Lock button. `ParentGate` shows `PinForm` until unlocked; `PinForm` is also used by the PIN box on a book page (`RemoveFromShelf`). The server enforces all of this; the client only hides things.
- **A user with no family** sees `NoFamily` (`Home.tsx`): create a family, or ask to join one by a parent's email (`JoinFamily`), or, if a parent declined, the "Request declined" notice. A parent approves in Settings → Join requests.
- **Mutations** mostly go through the `useEdit` hook (busy flag plus error string); a few places use `useMutation` or raw `client.mutate`. Settings sections are `Panel`s that read with `cache-and-network` and update with `refetchQueries`.
- **`Home` shows its spinner only while it has no data yet.** Refetching `me` (the "Check again" button) must not swap the page for a spinner, or the screen the user is on resets.

## Tests

- `test/fakeApi.ts` answers fetch by **operation name**: `{ Me: {data…}, Family: [first, second], Slow: () => promise }` (a list serves one reply per request and repeats the last). An operation with no handler throws `unexpected operation X`, which usually shows up as an unrelated alert.
- **Adding a query to a page the settings tests render means adding a default handler** to each `renderSettings` helper (`ProfilesSection`, `GoalsSection`, `ExportSection`, `TimezoneSection`, `parentSession` tests, and `JoinRequestsSection`), or dozens of unrelated tests fail.
- Fake replies must include every field the query asks for (and `__typename`/`id` for normalized types), or Apollo logs a missing-field error and returns no data. Do not add a field to the shared `Me` query without updating every fixture; prefer a separate root field, as `joinRequestDenied` does.
- Test behavior, not markup, and mutation-check new components: break the code, confirm a test fails, restore it. Two real bugs in this app were found by tests of the screen flow (the reset above, and native `type="email"` validation hiding the app's own message; `JoinFamily` uses `noValidate`).

## Known rough edges

The review in `REVIEW_SUMMARY.md` lists them. The ones that bite while working here: this package's `tsconfig.app.json` does not set `strict`; `TimezoneSection.tsx` calls `Intl.supportedValuesOf` at import time; limits such as the PIN pattern and name lengths are duplicated from the server; shelf labels are repeated in four files.
