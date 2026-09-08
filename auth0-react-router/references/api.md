# Auth0 React Router — API Reference & Testing

## Configuration Reference

All configuration is via environment variables (`.env` for development, platform env vars for production).

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `AUTH0_DOMAIN` | Auth0 tenant domain (no `https://`) | `example.us.auth0.com` |
| `AUTH0_CLIENT_ID` | Regular Web Application client ID | `abc123def456` |
| `AUTH0_CLIENT_SECRET` | Application client secret | `secret_xyz...` |
| `AUTH0_SESSION_SECRET` | Min 32-char secret for JWE cookie encryption | `openssl rand -base64 32` output |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH0_AUDIENCE` | — | API identifier; enables RS256 access tokens |
| `AUTH0_SCOPE` | `openid profile email` | Space-separated OIDC scopes |
| `AUTH0_APP_BASE_URL` | Inferred from request | Full app URL (needed behind proxies) |

### SPA Mode Variables (alternative — do not mix with `AUTH0_*`)

| Variable | Description |
|----------|-------------|
| `VITE_AUTH0_DOMAIN` | Tenant domain |
| `VITE_AUTH0_CLIENT_ID` | SPA client ID |
| `VITE_AUTH0_REDIRECT_URI` | Post-login redirect (full URL) |
| `VITE_AUTH0_AUDIENCE` | Optional API identifier |
| `VITE_AUTH0_SCOPE` | Scopes (default: `openid profile email`) |
| `VITE_AUTH0_CACHE_LOCATION` | `memory` (default) or `localstorage` |
| `VITE_AUTH0_USE_REFRESH_TOKENS` | `true` to enable silent refresh |

### `Auth0Server` Constructor Options

```ts
const auth0 = new Auth0Server({
  // Optional: transform session before it is saved to the cookie
  async beforeSessionSaved(session) {
    return { ...session, user: { ...session.user, app_role: 'member' } }
  },
  // Optional: called after successful callback (provision user, etc.)
  onCallback(session) { /* side effects only */ },
  // Optional: stateful session store for back-channel logout
  sessionStore: new MySessionStore(),
  // Optional: override authorizationParams (e.g., lock to an org)
  authorizationParams: { organization: 'org_abc123' },
})
```

## Claims Reference

### Standard OIDC Claims (available on `Auth0User`)

| Claim | Type | Description |
|-------|------|-------------|
| `sub` | string | Subject identifier (user ID) |
| `name` | string | Full display name |
| `given_name` | string | First name |
| `family_name` | string | Last name |
| `email` | string | Email address |
| `email_verified` | boolean | Whether email is verified |
| `picture` | string | Avatar URL |
| `updated_at` | string | ISO 8601 last update time |

### Auth0-Specific Claims

| Claim | Type | Description |
|-------|------|-------------|
| `https://example.com/roles` | string[] | Custom roles (set via Actions) |
| `permissions` | string[] | RBAC permissions from token (requires audience) |

Access claims from the session:
```ts
const session = await getSession(request)
const user = session?.user
const roles = (user?.['https://myapp.com/roles'] as string[]) ?? []
```

## Code Examples

### Minimal Working Setup

```ts
// app/auth0.server.ts
import { Auth0Server, registerAuth0Instance } from '@auth0/auth0-react-router/server'
export const auth0 = new Auth0Server()
registerAuth0Instance(auth0)
```

```ts
// app/routes.ts
import { route, type RouteConfig } from '@react-router/dev/routes'
export default [
  route('auth/*', 'routes/auth.$.tsx'),
  // ...other routes
] satisfies RouteConfig
```

```ts
// app/routes/auth.$.tsx
import { handleAuth } from '@auth0/auth0-react-router/server'
import { auth0 } from '../auth0.server'
export const loader = ({ request }: LoaderFunctionArgs) => handleAuth(auth0, request)
export const action = ({ request }: ActionFunctionArgs) => handleAuth(auth0, request)
```

```tsx
// app/root.tsx (key parts)
import { Auth0Provider } from '@auth0/auth0-react-router'
import { rootAuthLoader } from '@auth0/auth0-react-router/server'
import { auth0 } from './auth0.server'

export const loader = ({ request }: LoaderFunctionArgs) => rootAuthLoader(auth0, request)

export default function Root() {
  return (
    <html lang="en">
      <head><Meta /><Links /></head>
      <body>
        <Auth0Provider>
          <Outlet />
          <ScrollRestoration />
          <Scripts />
        </Auth0Provider>
      </body>
    </html>
  )
}
```

### Protected Route (Server-Side)

```ts
// app/routes/dashboard.tsx
import { requireSession } from '@auth0/auth0-react-router/server'

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const session = await requireSession(request)  // redirects to /auth/login if unauth'd
  return { user: session.user }
}
```

### Accessing Token

```ts
import { getAccessToken, deleteSession } from '@auth0/auth0-react-router/server'
import { TokenError } from '@auth0/auth0-react-router/errors'

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const token = await getAccessToken(request)  // auto-refreshes if expired
    const data = await fetch('https://api.example.com/data', {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json())
    return { data }
  } catch (err) {
    if (err instanceof TokenError) {
      // No refresh token available — force re-login
      return deleteSession(request, { redirectTo: '/auth/login' })
    }
    throw err
  }
}
```

### Role-Based Route Protection (Middleware)

```ts
// app/routes/admin.tsx  (requires React Router >= 7.9.0)
import { defineRouteHandle } from '@auth0/auth0-react-router'
import { defineRouteAuth, auth0UserContext } from '@auth0/auth0-react-router/server'

export const handle = defineRouteHandle({ role: 'admin' })
export const middleware = defineRouteAuth({ role: 'admin' }).middleware

export const loader = ({ context }: LoaderFunctionArgs) => {
  const user = context.get(auth0UserContext)
  return { user }
}
```

### Bearer Token API Route

```ts
// app/routes/api.orders.ts
import { requireClaims } from '@auth0/auth0-react-router/server'

export async function loader({ request }: LoaderFunctionArgs) {
  const claims = await requireClaims(request, { scope: 'read:orders' })
  // 401 if no Bearer token, 403 if scope missing
  return Response.json(await getOrders(claims.sub))
}
```

### Back-Channel Logout (Session Store)

```ts
import type { SessionStore, StateData } from '@auth0/auth0-react-router/server'

class RedisSessionStore implements SessionStore<unknown> {
  async get(id: string) { return redis.get(id) }
  async set(id: string, data: StateData) { await redis.set(id, data) }
  async delete(id: string) { await redis.del(id) }
  async deleteByLogoutToken(claims: { sub?: string; sid?: string }) {
    // Implement per your Redis key strategy
  }
}

export const auth0 = new Auth0Server({ sessionStore: new RedisSessionStore() })
```

## Testing Checklist

- [ ] `AUTH0_DOMAIN` set correctly (no `https://` prefix)
- [ ] `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET` match Dashboard values
- [ ] `AUTH0_SESSION_SECRET` is ≥ 32 characters
- [ ] Auth0 Dashboard: App type = **Regular Web Application**
- [ ] Allowed Callback URLs includes `http://localhost:5173/auth/callback`
- [ ] Allowed Logout URLs includes `http://localhost:5173`
- [ ] Allowed Web Origins includes `http://localhost:5173`
- [ ] Login redirects to Auth0 and returns to app
- [ ] Session persists across page reloads (cookie present in DevTools)
- [ ] Logout clears session and cookie
- [ ] Protected route redirects unauthenticated users to `/auth/login`
- [ ] `getAccessToken` returns a valid JWT (if `AUTH0_AUDIENCE` is set)
- [ ] Token auto-refreshes without re-login (requires `offline_access` scope + Refresh Token grant)
- [ ] SPA mode activates only when `VITE_AUTH0_DOMAIN` + `VITE_AUTH0_CLIENT_ID` are present
- [ ] Build succeeds: `npm run build`

## Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `ConfigurationError: AUTH0_SESSION_SECRET must be at least 32 characters` | Secret too short | `openssl rand -base64 32` |
| Redirect loop after login | Callback URL not registered in Auth0 Dashboard | Add `http://localhost:5173/auth/callback` to Allowed Callback URLs |
| `TypeError: Cannot read properties of undefined (reading 'env')` | `import.meta.env` accessed in CJS context | Update to `@auth0/auth0-react-router@1.0.0-beta.1+` |
| `TokenError: The access token has expired and a refresh token was not provided` | Missing offline_access scope or Refresh Token grant | Add `offline_access` to `AUTH0_SCOPE`, enable grant in Dashboard |
| `Auth0Provider` crashes on first render | Using server entry point in browser | Import from `@auth0/auth0-react-router` (not `/server`) |
| Root route session missing | `rootAuthLoader` not called or `id: 'root'` missing | Add `export const loader = ({ request }) => rootAuthLoader(auth0, request)` to root route |
| 403 on role-protected route | User lacks required role | Check Auth0 Actions sets custom claim; verify role string matches exactly |
| `AUD claim mismatch` | `AUTH0_AUDIENCE` doesn't match Auth0 API identifier | Must match exactly, including trailing slashes |
| `Cannot use AUTH0_* with VITE_AUTH0_*` | Mixed mode | Remove one set of env vars; use only RWA or SPA mode |

## Security Considerations

- **Never expose `AUTH0_CLIENT_SECRET` or `AUTH0_SESSION_SECRET`** in client-side code, version control, or logs. Load exclusively from environment variables.
- **JWE encryption** — session cookies are encrypted at rest using `AUTH0_SESSION_SECRET`; rotating this secret immediately invalidates all active sessions.
- **HTTPS in production** — session cookies are `Secure` in production; always serve behind HTTPS.
- **Callback URL validation** — `handleCallback` validates the `state` parameter and only accepts registered callback URLs; do not use wildcards in production.
- **`returnTo` parameter** — validated against control characters to prevent open redirect; relative paths only.
- **Bearer token security** — `requireClaims` validates signature, issuer, audience, and expiry; never skip these checks.
- **SPA mode** — no `AUTH0_CLIENT_SECRET` is used; tokens live in browser memory (default) or `localStorage` (opt-in, less secure). Prefer in-memory.
- **Do not log sessions** — `Auth0Session` contains user PII; never log or serialize to unencrypted storage.
