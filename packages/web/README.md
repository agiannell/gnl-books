# @gnl-books/web

The single-page app: React 19, Vite, react-router, Apollo Client, and [Radix Themes](https://www.radix-ui.com/themes). Sign-in is Cognito's hosted UI through `react-oidc-context` (authorization code with PKCE). In production it is served from S3 through the same CloudFront distribution as the API.

## Commands

```bash
yarn workspace @gnl-books/web dev        # http://localhost:5173
yarn workspace @gnl-books/web build      # type-check, then build to dist/
yarn workspace @gnl-books/web lint       # oxlint
yarn workspace @gnl-books/web preview    # serve the built dist/
yarn test --project web                  # from the repo root
```

From the repo root, `yarn build:web` runs the build. The CDK stack publishes `dist/`, so it must exist before any `cdk synth`, `diff` or `deploy`.

The dev server proxies `/graphql` to the **deployed** API at books.gnlfamily.com, so local development reads and writes real data under your real sign-in. The port is fixed at 5173 because the Cognito app client lists exactly that callback URL.

## Configuration

`src/config.ts` holds the Cognito region, user pool id, app client id and hosted-UI domain as literals copied from the stack's outputs. If the user pool or client is ever recreated, update that file. There is no `.env` for the web app.

## Structure

| Area | Files |
|---|---|
| Entry and routing | `main.tsx`, `routes.tsx`, `App.tsx` (header, sign-out, `AuthGate`) |
| Auth and API client | `auth.ts`, `AuthGate.tsx`, `apollo.ts`, `queries.ts` (every GraphQL document and its result types) |
| Reading | `Home.tsx`, `ProfilePage.tsx`, `BookPage.tsx`, `SearchPage.tsx`, `ManualAddPage.tsx`, `Shelves.tsx` |
| Parent area | `ParentGate.tsx`, `PinForm.tsx`, `ParentSessionProvider.tsx`, `SettingsPage.tsx` and its sections (readers, join requests, goals, time zone, export) |
| New users | `NoFamily.tsx`, `CreateFamily.tsx`, `JoinFamily.tsx` |

The parent unlock lives in memory only and re-locks on inactivity, a hidden tab, or the Lock button. The server enforces every parent-only action; the client only hides the controls.

## Styling constraint

The site's content security policy allows no inline `<style>` elements or scripts, and a static site cannot use nonces. So the UI uses Radix Themes plus plain CSS (`src/index.css`), and:

- do not add a CSS-in-JS library (Emotion, styled-components, MUI, Chakra, Mantine);
- avoid Radix components that inject a style tag or lock scroll (Dialog, Select, Popover, DropdownMenu); the app uses a native `<select>` instead;
- images come from the site's own origin, and book covers only from `https://assets.hardcover.app`.

Loosening the policy is a deliberate change to the CDK stack, not a workaround.

## Testing

Tests run in happy-dom with Testing Library, from the repo root. `test/fakeApi.ts` answers `fetch` by GraphQL operation name, so a test lists the replies its screen needs. Fake replies must include every field a query asks for, or Apollo returns no data. More on the fixtures and the cache rules (every query that reads `family` must ask for `id`) is in [`CLAUDE.md`](CLAUDE.md).
