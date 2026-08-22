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
| `@auth0/auth0-react-router` (root, resolves to `/client`) | Provider, hooks, UI components, route guards                         |
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
| `AUTH0_AUDIENCE`       | API audience, if requesting access tokens for an API (optional) |
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

**Role-based access** — use `defineRouteAuth` to enforce a role at the route level:

```ts
import {
  defineRouteAuth,
  auth0UserContext
} from '@auth0/auth0-react-router/server';

const adminAuth = defineRouteAuth({ role: 'admin' });

export const handle = adminAuth.handle;
export const middleware = adminAuth.middleware;

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
