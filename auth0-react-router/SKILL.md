---
name: auth0-react-router
description: Use when adding Auth0 login and logout to React Router v7 web applications - integrates @auth0/auth0-react-router SDK for React Router v7 regular web apps with server-side session management, JWE-encrypted cookies, middleware-based route protection, and optional SPA mode
---

# Auth0 React Router Integration

Adds Auth0 authentication to [React Router v7](https://reactrouter.com/) framework-mode applications using `@auth0/auth0-react-router`. The SDK operates in **RWA mode** by default (server-side OIDC with JWE-encrypted session cookies) and optionally in **SPA mode** (client-side PKCE via `@auth0/auth0-spa-js`) when `VITE_AUTH0_*` env vars are present.

> **Agent instruction:** Before providing SDK setup instructions, fetch the latest release version:
> ```bash
> gh api repos/auth0/auth0-react-router/releases/latest --jq '.tag_name' 2>/dev/null \
>   || gh api repos/auth0/auth0-react-router/releases --jq '.[0].tag_name'
> ```
> The first command returns the latest stable release. If it returns an error (pre-release only), fall back to the second command which returns the most recent release including pre-releases. Use the returned version in all dependency lines.

## Prerequisites

- Node.js 18+
- React Router v7 (framework mode — `react-router.config.ts` present)
- React ≥ 18.0.0
- npm 9+ or equivalent
- Node.js 20+ for the bootstrap setup script

## When NOT to Use

| Use Case | Recommended Skill |
|----------|------------------|
| React Router used as a SPA (no SSR/server) | Use Auth0 React SDK (`@auth0/auth0-react`) |
| Next.js application | Use `auth0-nextjs` skill |
| Express/Fastify backend API (JWT bearer only) | Use `auth0-node-api` skill |
| Plain React SPA (Vite/CRA, not React Router) | Use `auth0-react` skill |
| Adding Auth0 to a React Router SPA without `react-router.config.ts` | Use SPA SDK instead |

## Quick Start Workflow

> **Agent instruction:**
>
> 1. **Check for credentials in the prompt first.** If the user's prompt contains an Auth0 domain, client ID, and client secret, use them directly — skip the bootstrap script and write `.env` manually. Do NOT ask for credentials that are already provided.
>
> 2. **Otherwise offer setup choice:**
>    Use `AskUserQuestion`: "How would you like to configure Auth0?"
>    - Option A: "Automatic setup (recommended)" — runs `scripts/bootstrap.mjs`
>    - Option B: "Manual setup" — provide credentials manually
>
> 3. **Install the SDK:**
>    ```bash
>    npm install @auth0/auth0-react-router
>    ```
>
> 4. **Create Auth0Server instance** (`app/auth0.server.ts`):
>    ```ts
>    import { Auth0Server, registerAuth0Instance } from '@auth0/auth0-react-router/server'
>    export const auth0 = new Auth0Server()
>    registerAuth0Instance(auth0)
>    ```
>
> 5. **Register auth routes** — add to `app/routes.ts`:
>    ```ts
>    route('auth/*', 'routes/auth.$.tsx'),
>    ```
>    Create `app/routes/auth.$.tsx`:
>    ```ts
>    import { handleAuth } from '@auth0/auth0-react-router/server'
>    import { auth0 } from '../auth0.server'
>    export const loader = ({ request }) => handleAuth(auth0, request)
>    export const action = ({ request }) => handleAuth(auth0, request)
>    ```
>
> 6. **Wrap app in Auth0Provider** in `app/root.tsx`:
>    ```tsx
>    import { Auth0Provider } from '@auth0/auth0-react-router'
>    import { rootAuthLoader } from '@auth0/auth0-react-router/server'
>    import { auth0 } from './auth0.server'
>    export const loader = ({ request }) => rootAuthLoader(auth0, request)
>    export default function Root() {
>      return (
>        <html><head /><body>
>          <Auth0Provider><Outlet /></Auth0Provider>
>        </body></html>
>      )
>    }
>    ```
>    If using a custom route config, ensure the root route has `id: 'root'`.
>
> 7. **Verify build:**
>    ```bash
>    npm run build
>    ```
>    If it fails, check that `app/root.tsx` has `id: 'root'`, that `Auth0Provider` is not imported from `/server`, and that `.env` is present with all required vars.
>
> 8. **Failcheck:** If verification fails after 5–6 iterations, use `AskUserQuestion` to ask the user whether to continue troubleshooting or document the blocker.

## Detailed Documentation

- **[Setup Guide](./references/setup.md)** — Auth0 Dashboard configuration, bootstrap script, `.env` setup, secret management, and verification steps
- **[Integration Patterns](./references/integration.md)** — Protected routes, session/token utilities, middleware, role-based auth, API bearer tokens, SPA mode, error handling, and testing
- **[API Reference & Testing](./references/api.md)** — All env vars, session helpers, middleware API, error types, testing checklist, and security considerations

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| App type in Auth0 Dashboard set to **SPA** instead of **Regular Web Application** | Create a new application of type "Regular Web Application" |
| Missing `AUTH0_SESSION_SECRET` (must be ≥ 32 chars) | Generate with `openssl rand -base64 32` and add to `.env` |
| `AUTH0_CLIENT_SECRET` committed to source control | Move to `.env`, add `.env` to `.gitignore` |
| `Auth0Provider` imported from `/server` instead of `/client` | Use `import { Auth0Provider } from '@auth0/auth0-react-router'` |
| `rootAuthLoader` called without passing `auth0` instance | Signature is `rootAuthLoader(auth0, request)` |
| Root route missing `id: 'root'` in custom route configs | Add `id: 'root'` to the root route definition |
| Callback URL mismatch (e.g., port 3000 vs 5173) | Check `AUTH0_APP_BASE_URL` and Auth0 Dashboard Allowed Callback URLs |
| Setting both `AUTH0_*` and `VITE_AUTH0_*` env vars | Use exactly one mode — RWA uses `AUTH0_*`, SPA uses `VITE_AUTH0_*` |
| `getAccessToken` throwing `TokenError` on expiry | Add `offline_access` to scope + enable Refresh Token grant in Auth0 Dashboard |
| Domain includes `https://` prefix | Use hostname only: `example.us.auth0.com` (no scheme) |

## Dual-Mode Architecture

The SDK auto-detects the authentication mode at render time from environment variables:

| Mode | Activation | Token Location | Suitable For |
|------|-----------|---------------|-------------|
| **RWA** (default) | `AUTH0_*` env vars | Server-side JWE cookie | SSR apps, sensitive data |
| **SPA** | `VITE_AUTH0_*` env vars | Browser (memory or localStorage) | Client-heavy apps |

**Do not set both sets of env vars** — the modes are mutually exclusive.

In RWA mode, `rootAuthLoader` returns a `BrowserSession` (user profile only; no tokens ever reach the browser). In SPA mode, `@auth0/auth0-spa-js` handles token storage client-side.

## Entry Points

The package has 6 tree-shakeable entry points to enforce bundle boundaries:

| Entry | Safe For | Contents |
|-------|----------|----------|
| `@auth0/auth0-react-router` | Browser | Alias for `/client` |
| `/client` | Browser | `Auth0Provider`, hooks, components |
| `/server` | Server only | Handlers, session utils, middleware |
| `/errors` | Both | Typed error classes |
| `/types` | Both | TypeScript interfaces |
| `/testing` | Tests | Mock factories, `WithAuth` |

**Critical:** Never import from `/server` inside client-side code. React Router's bundler tree-shakes it away, but incorrect imports can leak server code into the browser bundle.

## Related Skills

- **[auth0-quickstart](/auth0-quickstart)** — Initial Auth0 account and tenant setup
- **[auth0-nextjs](/auth0-nextjs)** — Next.js App Router integration (similar SSR pattern)
- **[auth0-aspnetcore-authentication](/auth0-aspnetcore-authentication)** — WEB_REGULAR reference for .NET

## Quick Reference

### Server Utilities (`@auth0/auth0-react-router/server`)

| Function | Signature | Returns |
|----------|-----------|---------|
| `handleAuth` | `(auth0, request)` | Response (login/callback/logout dispatch) |
| `handleLogin` | `(auth0, request, opts?)` | Response |
| `handleCallback` | `(auth0, request, opts?)` | Response |
| `handleLogout` | `(auth0, request, opts?)` | Response |
| `rootAuthLoader` | `(auth0, request)` | `{ session: BrowserSession \| null }` |
| `getSession` | `(request)` | `Auth0Session \| null` |
| `requireSession` | `(request)` | `Auth0Session` (throws 302 if not auth'd) |
| `getUser` | `(request)` | `Auth0User \| null` |
| `requireUser` | `(request)` | `Auth0User` (throws 302 if not auth'd) |
| `getAccessToken` | `(request)` | `string` (auto-refreshes; throws `TokenError` on failure) |
| `updateSession` | `(request, session)` | `Response` with updated cookie |
| `deleteSession` | `(request, opts?)` | `Response` clearing session |
| `createApiClient` | `(request, opts)` | `fetch`-based client with `Authorization` header |
| `requireClaims` | `(request, opts?)` | `JWTPayload` (bearer token; 401/403 on failure) |
| `getClaims` | `(request)` | `JWTPayload \| null` |

### Middleware (`@auth0/auth0-react-router/server`)

| Export | Purpose |
|--------|---------|
| `auth0Middleware` | Global middleware — populates `auth0SessionContext`, `auth0UserContext` |
| `defineRouteAuth(opts)` | Per-route middleware factory — `{ middleware }`, throws 403 on role mismatch |
| `bearerTokenMiddleware` | API routes — validates Bearer token, populates `auth0ClaimsContext` |
| `auth0SessionContext` | Context key for `Auth0Session` |
| `auth0UserContext` | Context key for `Auth0User` |
| `auth0ClaimsContext` | Context key for `JWTPayload` |

### Client Components/Hooks (`@auth0/auth0-react-router` or `/client`)

| Export | Purpose |
|--------|---------|
| `Auth0Provider` | Root provider — wraps entire app |
| `useAuth0()` | Full auth context (includes `getAccessToken` in SPA mode) |
| `useUser()` | Current `Auth0User \| null` |
| `useSession()` | Full `Auth0Session \| null` |
| `SignedIn` / `SignedOut` | Conditional rendering |
| `AuthLoading` | Renders during SPA init |
| `RequireAuth` | Client-side redirect guard |
| `RequireRole` | Role-based conditional render |
| `LoginButton` | Renders `<a href="/auth/login">` |
| `LogoutButton` | Renders `<a href="/auth/logout">` |
| `Auth0ErrorBoundary` | Catches `Auth0Error` subclasses |
| `withAuthenticationRequired(Component, opts)` | HOC redirect guard |

### Error Classes (`@auth0/auth0-react-router/errors`)

All extend `Auth0Error` with `.code` (string) and `.statusCode` (number).

`AuthenticationError` · `SessionExpiredError` · `MissingSessionError` · `TokenError` · `BearerTokenError` · `CallbackError` · `InsufficientScopeError` · `ConfigurationError`

## References

- [GitHub Repository](https://github.com/auth0/auth0-react-router)
- [npm Package](https://www.npmjs.com/package/@auth0/auth0-react-router)
- [Auth0 Dashboard](https://manage.auth0.com/)
- [Auth0 Documentation](https://auth0.com/docs)
- [React Router v7 Docs](https://reactrouter.com/start/framework/installation)
- [Report Issues](https://github.com/auth0/auth0-react-router/issues)
