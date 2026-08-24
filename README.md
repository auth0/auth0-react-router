# @auth0/auth0-react-router

Auth0 Authentication SDK for [React Router v7](https://reactrouter.com/) applications.

> **Beta release.** APIs may change before GA.

The SDK is built on Auth0's foundational
[`@auth0/auth0-server-js`](https://github.com/auth0/auth0-auth-js) package. It consumes the
foundation rather than re-implementing OIDC, session, and token logic, so behavior stays consistent
with the rest of the Auth0 ecosystem.

## Table of contents

- [Installation](#installation)
- [Package structure](#package-structure)
- [Features](#features)
- [Quick start](#quick-start)
- [Protecting routes](#protecting-routes)
- [Calling APIs with access tokens](#calling-apis-with-access-tokens)
- [SPA mode](#spa-mode)
- [API resource server](#api-resource-server)
- [Known limitations](#known-limitations)
- [Security considerations](#security-considerations)
- [Feedback](#feedback)

## Installation

```sh
npm install @auth0/auth0-react-router
```

This SDK relies on the following peer dependencies, which you install in your own app:

| Package               | Version                   |
| --------------------- | ------------------------- |
| `react`               | `>=18.0.0`                |
| `react-dom`           | `>=18.0.0`                |
| `react-router`        | `>=7.0.0`                 |
| `@auth0/auth0-spa-js` | `>=2.0.0` (SPA mode only) |

## Package structure

The SDK is one package with six entry points. Each entry point is tree-shakeable and the bundle
boundary is enforced by the `exports` map, so server code never enters the client bundle and client
code never enters the server bundle.

| Import path                                               | Contents                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `@auth0/auth0-react-router` (root, resolves to `/client`) | Provider, hooks, UI components, route guards, `defineRouteHandle`   |
| `@auth0/auth0-react-router/server`                        | `Auth0Server` class, handlers, session and token helpers, middleware |
| `@auth0/auth0-react-router/errors`                        | Typed error classes                                                  |
| `@auth0/auth0-react-router/types`                         | TypeScript types                                                     |
| `@auth0/auth0-react-router/testing`                       | Test utilities, mock factories, test provider                        |

The root import resolves to `/client`, the browser-safe surface, so the convenient path is also the
safe one. Server-only APIs require the explicit `/server` import.

### API style: free functions, not instance methods

Auth route handlers take the `Auth0Server` instance as their first argument —
`handleLogin(auth0, request)`, `handleCallback(auth0, request)`. Session and token helpers that only
need to read the encrypted cookie — `getSession(request)`, `getAccessToken(request)` — work from
the request alone. This keeps each helper easy to use directly in a loader or action without
threading the instance through every call site.

## Features

**Authentication**

- Login, callback, and logout handled server-side with an encrypted JWE session cookie.
- Back-channel logout so Auth0 can end a user's session from the Dashboard or another app.
- `handleAuth` on a splat route registers the full OIDC flow from a single file, or use the
  individual handlers (`handleLogin`, `handleCallback`, `handleLogout`) for custom paths.

**Route protection**

- `requireSession` and `requireUser` throw a `302` redirect from any loader when the user is not
  authenticated.
- `defineRouteAuth` middleware enforces role-based access at the route level and stores the
  authenticated user in React Router context for downstream loaders.
- `requireClaims` and `bearerTokenMiddleware` protect API routes that expect a Bearer token.

**React hooks and components**

- Hooks: `useAuth0`, `useUser`, `useSession`.
- Conditional rendering: `SignedIn`, `SignedOut`, `AuthLoading`.
- Guards: `RequireAuth`, `RequireRole`.
- Pre-built buttons: `LoginButton`, `LogoutButton`.

**Server-side tokens**

- `getSession`, `getAccessToken`, `updateSession`, `deleteSession`, and `createApiClient` are
  available in loaders and actions. Tokens stay on the server and are never sent to the browser.

**SPA mode**

- Optional client-side flow backed by `@auth0/auth0-spa-js`, auto-detected from
  `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID`. No changes needed to `Auth0Provider`.

**Testing utilities**

- Mock factories (`createMockUser`, `createMockSession`, `createMockTokenSet`), a drop-in `WithAuth`
  test provider, and loader helpers (`createMockLoader`, `createMockBearerRequest`) so you can test
  authenticated flows without a real Auth0 tenant.

## Quick start

The minimal setup is three pieces.

**1. Create one `Auth0Server` instance per app** (not per request):

```ts
// app/auth0.server.ts
import { Auth0Server } from '@auth0/auth0-react-router/server';

export const auth0 = new Auth0Server();
```

The instance reads configuration from environment variables. You can also pass values directly to
the constructor.

| Variable               | Description                                                     |
| ---------------------- | --------------------------------------------------------------- |
| `AUTH0_DOMAIN`         | Your Auth0 tenant domain, e.g. `example.us.auth0.com`           |
| `AUTH0_CLIENT_ID`      | Application client ID                                           |
| `AUTH0_CLIENT_SECRET`  | Application client secret                                       |
| `AUTH0_SESSION_SECRET` | Random string (min 32 chars) used to encrypt the session cookie |
| `AUTH0_APP_BASE_URL`   | Full URL of your app, e.g. `https://example.com` (optional — inferred from `request.url` at runtime, but should be set explicitly in production when running behind a reverse proxy) |
| `AUTH0_AUDIENCE`       | API audience for access tokens (optional). Without this, `getAccessToken` returns an opaque token that API servers cannot validate. Set it to the identifier of your registered API (e.g. `https://api.example.com`) to receive a signed RS256 JWT instead. |
| `AUTH0_SCOPE`          | OAuth scopes, defaults to `openid profile email` (optional)     |

**2. Register the auth routes:**

Create a splat route file that handles all `/auth/*` paths:

```tsx
// app/routes/auth.$.tsx
import { handleAuth } from '@auth0/auth0-react-router/server';
import { auth0 } from '../auth0.server';

export const loader = ({ request }) => handleAuth(auth0, request);
export const action  = ({ request }) => handleAuth(auth0, request);
```

Register it in your route config:

```ts
// app/routes.ts
import { route } from '@react-router/dev/routes';

export default [
  route('auth/*', 'routes/auth.$.tsx'),
  // ...
];
```

`handleAuth` dispatches internally to `handleLogin`, `handleCallback`, `handleLogout`, and
`handleBackchannelLogout` based on the URL path and HTTP method.

**3. Add the provider to the root layout:**

```tsx
// app/root.tsx
import { Outlet } from 'react-router';
import { Auth0Provider } from '@auth0/auth0-react-router';
import { rootAuthLoader } from '@auth0/auth0-react-router/server';

export const loader = ({ request }) => rootAuthLoader(request);

export default function Root() {
  return (
    <html lang="en">
      <body>
        <Auth0Provider>
          <Outlet />
        </Auth0Provider>
      </body>
    </html>
  );
}
```

`Auth0Provider` reads the session via `useRouteLoaderData('root')`, which matches the route's
`id` — the `id: 'root'` set on the route object in step 2. Make sure your root route has that id,
otherwise the provider won't find the session.

That is enough for working login, callback, and logout.

## Protecting routes

**Server-side** — call `requireSession` from a loader. It returns the session or throws a `302`
redirect to `/auth/login` with a `returnTo` parameter so the user lands back where they started:

```ts
import { requireSession } from '@auth0/auth0-react-router/server';

export const loader = async ({ request }) => {
  const session = await requireSession(request);
  return { user: session.user };
};
```

**Client-side** — wrap UI in `RequireAuth` or use the conditional rendering components:

```tsx
import {
  RequireAuth,
  SignedIn,
  SignedOut,
  LoginButton,
  LogoutButton
} from '@auth0/auth0-react-router';

// redirect to login if not authenticated
function Dashboard() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}

// show/hide based on auth state
function Header() {
  return (
    <nav>
      <SignedIn>
        <LogoutButton />
      </SignedIn>
      <SignedOut>
        <LoginButton />
      </SignedOut>
    </nav>
  );
}
```

> **Note:** `RequireAuth`, `RequireRole`, `withAuthenticationRequired`, `SignedIn`, and `SignedOut`
> are client-only components. The server always renders HTTP 200 for the page — these components
> only control what is shown after hydration. For real server-side protection (blocking the response
> entirely) use `requireSession` or `requireUser` in the route loader, or `defineRouteAuth`
> middleware.

**Role-based access** — use `defineRouteAuth` to enforce a role at the route level.

Route files export both `handle` (read client-side by `useMatches`) and `middleware`
(server-only). Import them from separate paths to keep the client bundle free of server code:

```ts
import { defineRouteHandle } from '@auth0/auth0-react-router';
import { defineRouteAuth, auth0UserContext } from '@auth0/auth0-react-router/server';

// handle comes from the client bundle — safe in browser
export const handle = defineRouteHandle({ role: 'admin' });

// middleware comes from /server — stripped from the client bundle by React Router
export const middleware = defineRouteAuth({ role: 'admin' }).middleware;

export const loader = ({ context }) => {
  const user = context.get(auth0UserContext);
  return { user };
};
```

Both `auth0SessionContext` and `auth0UserContext` follow the same pattern — call
`context.get(key)`, not `key.get(context)`:

```ts
import {
  auth0SessionContext,
  auth0UserContext
} from '@auth0/auth0-react-router/server';

export const loader = ({ context }) => {
  const session = context.get(auth0SessionContext); // Auth0Session | null
  const user    = context.get(auth0UserContext);    // Auth0User | null
  return { user };
};
```

Requests without the required role receive a `403`. Roles are read from the
`https://auth0.com/claims/roles` claim by default; pass `rolesClaim` to override.

## Calling APIs with access tokens

Use `getAccessToken` in a loader or action to retrieve a valid access token for the current user.
If the token is expired it is silently refreshed using the refresh token before being returned.

```ts
import { getAccessToken } from '@auth0/auth0-react-router/server';
import { deleteSession } from '@auth0/auth0-react-router/server';
import { TokenError } from '@auth0/auth0-react-router/errors';
import { redirect } from 'react-router';

export const loader = async ({ request }) => {
  let token: string;
  try {
    token = await getAccessToken(request);
  } catch (err) {
    if (err instanceof TokenError) {
      // Refresh token missing or expired — clear the stale session and re-authenticate
      return deleteSession(request, { redirectTo: '/auth/login' });
    }
    throw err;
  }

  const data = await fetch('https://api.example.com/items', {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());

  return { data };
};
```

### Token refresh prerequisites

Silent refresh only works when **all three** of the following are configured. If any are missing,
`getAccessToken` throws a `TokenError` with the message
`"The access token has expired and a refresh token was not provided"`.

1. **`AUTH0_SCOPE` includes `offline_access`** — add it to your `.env`:
   ```
   AUTH0_SCOPE=openid profile email offline_access
   ```
2. **Allow Offline Access is enabled on the API** — Auth0 Dashboard → Applications → APIs →
   select your API → Settings → enable **Allow Offline Access**.
3. **Refresh Token grant is enabled on the application** — Auth0 Dashboard → Applications →
   select your app → Settings → Advanced Settings → Grant Types → check **Refresh Token**.
## API resource server

React Router loaders and actions can also serve as API endpoints called by mobile apps, SPAs, or
other services using a Bearer JWT token. `requireClaims` verifies the token and returns the claims
— no session cookie or `Auth0Server` instance required.

```ts
import { requireClaims } from '@auth0/auth0-react-router/server';

export async function loader({ request }) {
  const claims = await requireClaims(request, { scope: 'read:orders' });
  // React Router forwards the thrown Response automatically:
  //   no token      → 401 { "error": "bearer_token_error", ... }
  //   missing scope → 403 { "error": "insufficient_scope", ... }
  return Response.json(await getOrders(claims.sub));
}
```

Use `getClaims` instead if you want to handle the unauthenticated case yourself rather than
throwing:

```ts
const claims = await getClaims(request);
if (!claims) return Response.json({ public: true });
return Response.json({ user: claims.sub });
```

For routes that share a parent, use `bearerTokenMiddleware` to verify the token once and read it
from context in each loader — avoids repeated JWKS calls:

```ts
// app/routes.ts
import { route } from '@react-router/dev/routes';
export default [
  route('api/*', 'routes/api.$.tsx', {
    middleware: [bearerTokenMiddleware],
  }),
];

// app/routes/api.users.ts
import { requireClaimsFromContext } from '@auth0/auth0-react-router/server';
export async function loader({ context }) {
  const claims = requireClaimsFromContext(context, { scope: 'read:users' });
  return Response.json(await getUsers());
}
```

### Auth0 Dashboard setup

Two environment variables are required — no `AUTH0_CLIENT_SECRET` or session config needed:

```
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://your-api-identifier
```

**Registering the API** — create an API in the Auth0 Dashboard (Applications → APIs → Create API)
and use its identifier as `AUTH0_AUDIENCE`. The identifier cannot use an `.auth0.com` domain.

**Authorizing user flows (SPA / RWA PKCE)** — when users log in via a browser PKCE flow and your
app requests an access token with an audience, Auth0 checks a policy on the API. The default policy
(`require_client_grant`) blocks user flows, returning `"Client is not authorized to access resource
server"`. Fix it via the Management API:

```bash
PATCH /api/v2/resource-servers/{id}
{
  "subject_type_authorization": {
    "user": { "policy": "allow_all" }
  }
}
```

**Authorizing M2M flows (client credentials)** — if a backend service calls your API using
client credentials (no user), authorize the application on the API's **Machine to Machine
Applications** tab in the Dashboard instead.

> The two fixes are independent — M2M tab authorization does not fix user PKCE flows, and
> `user.policy: allow_all` does not affect M2M flows.

### Working with `claims.aud`

The `aud` claim can be a `string` or a `string[]` depending on how many audiences are in the
token. Strict equality checks silently fail when it is an array:

```ts
// ❌ false when aud is ["https://api.example.com"]
claims.aud === 'https://api.example.com'

// ✅ works for both string and array
[].concat(claims.aud).includes('https://api.example.com')
```

## SPA mode

SPA mode is activated automatically when `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID` are both
set in your Vite environment. No `Auth0Server`, no loaders, no server session — the full OIDC flow
runs in the browser via `@auth0/auth0-spa-js`.

The same `Auth0Provider`, hooks, and components work in both modes. The provider detects the
`VITE_*` variables at render time and switches to the SPA-backed implementation internally.

**Environment variables:**

| Variable                                | Description                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `VITE_AUTH0_DOMAIN`                     | Your Auth0 tenant domain — activates SPA mode when set alongside client ID   |
| `VITE_AUTH0_CLIENT_ID`                  | Application client ID                                                         |
| `VITE_AUTH0_REDIRECT_URI`               | Callback URL (optional — defaults to `window.location.origin`)               |
| `VITE_AUTH0_AUDIENCE`                   | API audience for RS256 access tokens (optional — see note below)             |
| `VITE_AUTH0_SCOPE`                      | OAuth scopes (optional — defaults to `openid profile email`)                 |
| `VITE_AUTH0_CACHE_LOCATION`             | Token cache: `memory` (default) or `localstorage`                            |
| `VITE_AUTH0_USE_REFRESH_TOKENS`         | Enable refresh tokens (optional — defaults to `true`)                        |
| `VITE_AUTH0_USE_REFRESH_TOKENS_FALLBACK`| Fall back to silent iframe SSO if refresh token is absent (optional)         |

> **API tokens** — without `VITE_AUTH0_AUDIENCE`, `getAccessToken()` returns an opaque token that
> cannot be validated by an API server. Set `VITE_AUTH0_AUDIENCE` to the identifier of your
> registered API and it returns a signed RS256 JWT instead.

### Handling the loading state

In SPA mode the SDK initialises asynchronously — `isLoading` is `true` until `auth0-spa-js`
finishes restoring the session. During this window `SignedIn`, `SignedOut`, and `RequireRole` all
render nothing to avoid a flash of incorrect UI.

Use `AuthLoading` to show a spinner or placeholder while auth state is being resolved:

```tsx
import { AuthLoading, SignedIn, SignedOut, LoginButton, LogoutButton } from '@auth0/auth0-react-router';

function Header() {
  return (
    <nav>
      <AuthLoading>
        <span>Loading...</span>
      </AuthLoading>
      <SignedIn>
        <LogoutButton />
      </SignedIn>
      <SignedOut>
        <LoginButton />
      </SignedOut>
    </nav>
  );
}
```

Without `AuthLoading`, the nav will be empty during init and then snap to the correct state once
loading completes. On fast connections the gap is imperceptible; on slow connections or cold loads
it is visible.

### Persistent sessions

By default tokens are stored in **memory** and lost on page refresh — the user has to log in again.
This is the secure default: in-memory tokens are not accessible to XSS attacks.

To persist sessions across page refreshes, three steps are required:

**1. Enable Offline Access on your Auth0 API**

Auth0 Dashboard → Applications → APIs → [your API] → Settings → **Allow Offline Access** → ON

**2. Enable the Refresh Token grant on your application**

Auth0 Dashboard → Applications → [your app] → Settings → Advanced Settings → Grant Types →
**Refresh Token** → checked

**3. Set these variables in your `.env`**

```sh
VITE_AUTH0_CACHE_LOCATION=localstorage
VITE_AUTH0_SCOPE=openid profile email offline_access
```

With this in place, `auth0-spa-js` stores the refresh token in `localStorage` and silently
exchanges it for a new access token on every page load — no login prompt needed.

> **Security note:** `localstorage` tokens are readable by any JavaScript on the page. Only use
> this if your application has strong XSS mitigations in place. When in doubt, keep the default
> `memory` cache and accept that sessions do not survive a hard refresh.

### `useUser()` returns profile fields only in SPA mode

`useUser()` works in both modes but the shape of the user object differs because the two providers
populate it from different sources.

In **RWA mode** the user comes from the server-side session, which stores the full decoded ID token.
In **SPA mode** it comes from `auth0-spa-js`'s `getUser()`, which returns UserInfo profile claims
only and strips JWT metadata automatically.

| Claim | RWA | SPA |
| ----- | --- | --- |
| `sub`, `email`, `name`, `picture` | ✅ | ✅ |
| Custom claims (e.g. roles) | ✅ | ✅ |
| `iss`, `aud`, `iat`, `exp`, `sid` | ✅ | ❌ |

If your code reads JWT metadata claims directly from `useUser()`, those fields will be `undefined`
in SPA mode. Use `useAuth0().getIdTokenClaims()` if you need the full ID token payload.

### Server helpers are not available in SPA mode

`getSession`, `requireSession`, `getUser`, `requireUser`, and `getAccessToken` are server-side
utilities that read the encrypted JWE session cookie. In a pure SPA there is no session cookie —
those helpers will always return `null` or redirect to login. Use the client-side hooks instead:

| Instead of (server) | Use (client) |
| ------------------- | ------------ |
| `getSession(request)` | `useSession()` |
| `getUser(request)` | `useUser()` |
| `getAccessToken(request)` | `useAuth0().getAccessToken()` |
| `requireSession(request)` | `RequireAuth` component |

### Auth0 Dashboard configuration notes

**Logout `returnTo`** — the URL passed to `logout({ returnTo: '...' })` must be registered in the
Auth0 Dashboard under Applications → [your app] → Settings → **Allowed Logout URLs**. Auth0
validates the URL before redirecting — an unregistered URL results in an error page after logout.

**Sign-up screen** — passing `screen_hint: "signup"` to `loginWithRedirect` shows the sign-up
form instead of the login form, but requires two things:

1. Your tenant must use **New Universal Login** (Auth0 Dashboard → Branding → Universal Login).
2. Sign-ups must be enabled on the application (Auth0 Dashboard → Applications → [your app] →
   Settings → scroll to "Application Login URI" section).

## Known limitations

- **React Router middleware** — `auth0Middleware`, `bearerTokenMiddleware`, and `defineRouteAuth`
  require React Router ≥ 7.9.0, which introduced the middleware API. On earlier 7.x releases use
  the per-loader helpers (`getSession`, `requireSession`, etc.) instead.
- **DPoP** (sender-constrained tokens) is not supported. It is planned once the underlying
  `@auth0/auth0-server-js` foundation gains native support.
- **`AUTH0_AUDIENCE` restrictions** — the audience value cannot use an `.auth0.com` domain; Auth0
  reserves those. Use the identifier of an API you have registered in your tenant
  (Dashboard → Applications → APIs → Create API). After creating the API, also authorize your
  application on the API's **Machine to Machine Applications** tab, otherwise login fails with
  "Client is not authorized to access resource server".
- **Hybrid mode (both `AUTH0_*` and `VITE_*` set) is not supported** — when both sets of
  environment variables are present, `Auth0Provider` activates SPA mode but the server-side JWE
  session cookie is also present. SPA logout clears the in-browser token cache but does not clear
  the cookie, so routes guarded by `requireSession` continue to serve content after logout. Run the
  app in one mode only: set either `AUTH0_*` (SSR) or `VITE_*` (SPA) variables, not both.

## Security considerations

### Do not log session data

The SDK never writes PII or token values to any log output. Be careful not to introduce
logging in your own loaders or actions:

```ts
// ❌ avoid
export const loader = async ({ request }) => {
  const session = await getSession(request);
  console.log(session.user.email, session.tokenSets); // logs PII and credentials
};

// ✅ safe
export const loader = async ({ request }) => {
  const session = await getSession(request);
  return { user: session.user };
};
```

`AUTH0_CLIENT_SECRET` and `AUTH0_SESSION_SECRET` should never appear in logs. Treat
them like passwords — load them from environment variables and keep them out of any
debug or error output.

## Feedback

### Contributing

We appreciate feedback and contribution to this repo! Before you get started, please read the following:

- [Auth0's general contribution guidelines](https://github.com/auth0/open-source-template/blob/master/GENERAL-CONTRIBUTING.md)
- [Auth0's code of conduct guidelines](https://github.com/auth0/open-source-template/blob/master/CODE-OF-CONDUCT.md)
- [This repo's contribution guide](./CONTRIBUTING.md)

### Raise an issue

To provide feedback or report a bug, please [raise an issue on our issue tracker](https://github.com/auth0/auth0-react-router/issues).

## Vulnerability Reporting

Please do not report security vulnerabilities on the public GitHub issue tracker. The [Responsible Disclosure Program](https://auth0.com/responsible-disclosure-policy) details the procedure for disclosing security issues.

## What is Auth0?

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.auth0.com/website/sdks/logos/auth0_dark_mode.png" width="150">
    <source media="(prefers-color-scheme: light)" srcset="https://cdn.auth0.com/website/sdks/logos/auth0_light_mode.png" width="150">
    <img alt="Auth0 Logo" src="https://cdn.auth0.com/website/sdks/logos/auth0_light_mode.png" width="150">
  </picture>
</p>
<p align="center">
  Auth0 is an easy to implement, adaptable authentication and authorization platform. To learn more checkout <a href="https://auth0.com/why-auth0">Why Auth0?</a>
</p>

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for more info.
