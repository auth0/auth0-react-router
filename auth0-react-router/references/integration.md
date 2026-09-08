# Auth0 React Router — Integration Patterns

## Core Setup

### Auth0Server Initialization

Create a single `Auth0Server` instance per application. Call `registerAuth0Instance` to make session helpers (like `getSession`) work without passing the instance explicitly.

```ts
// app/auth0.server.ts
import { Auth0Server, registerAuth0Instance } from '@auth0/auth0-react-router/server'

export const auth0 = new Auth0Server()
registerAuth0Instance(auth0)
```

For advanced configuration:

```ts
export const auth0 = new Auth0Server({
  // Transform the session before persisting to cookie (e.g., add custom claims)
  async beforeSessionSaved(session) {
    return {
      ...session,
      user: { ...session.user, app_role: await fetchRole(session.user.sub) },
    }
  },
  // Side-effect hook after successful callback (provision user, audit log)
  onCallback(session) {
    console.log('User logged in:', session.user.sub)
  },
  // Lock all logins to a specific organization
  authorizationParams: { organization: 'org_abc123' },
})
```

### Auth Route Handler

Register a single catch-all route that dispatches to the correct handler based on URL path:

```ts
// app/routes/auth.$.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router'
import { handleAuth } from '@auth0/auth0-react-router/server'
import { auth0 } from '../auth0.server'

export const loader = ({ request }: LoaderFunctionArgs) => handleAuth(auth0, request)
export const action = ({ request }: ActionFunctionArgs) => handleAuth(auth0, request)
```

`handleAuth` dispatches as follows:

| Path | Method | Handler |
|------|--------|---------|
| `/auth/login` | GET | `handleLogin` |
| `/auth/callback` | GET | `handleCallback` |
| `/auth/logout` | GET | `handleLogout` |
| `/auth/backchannel-logout` | POST | `handleBackchannelLogout` |

### Root Loader and Provider

```tsx
// app/root.tsx
import type { LoaderFunctionArgs } from 'react-router'
import { Auth0Provider } from '@auth0/auth0-react-router'
import { rootAuthLoader } from '@auth0/auth0-react-router/server'
import { auth0 } from './auth0.server'

export const loader = ({ request }: LoaderFunctionArgs) => rootAuthLoader(auth0, request)

export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <Meta />
        <Links />
      </head>
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

`rootAuthLoader` decrypts the JWE session cookie and returns a browser-safe `BrowserSession` (user profile only — no tokens). `Auth0Provider` reads this via React Router's root loader data.

## Protected Routes

### Server-Side Protection (Recommended)

```ts
// app/routes/dashboard.tsx
import type { LoaderFunctionArgs } from 'react-router'
import { requireSession, getAccessToken } from '@auth0/auth0-react-router/server'

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const session = await requireSession(request)
  // Throws Response(302) → /auth/login if not authenticated
  return { user: session.user }
}
```

Use `requireUser` for just the user object:

```ts
const user = await requireUser(request)
```

Use `getSession` / `getUser` for optional access (no redirect):

```ts
const session = await getSession(request)  // Auth0Session | null
const user = await getUser(request)        // Auth0User | null
```

### Client-Side Guards

Client-side guards control post-hydration rendering only — they do not block server responses. Always pair with server-side protection for sensitive data.

```tsx
import { RequireAuth, RequireRole, SignedIn, SignedOut, LoginButton, LogoutButton }
  from '@auth0/auth0-react-router'

function Layout() {
  return (
    <nav>
      <SignedIn><LogoutButton /></SignedIn>
      <SignedOut><LoginButton /></SignedOut>
    </nav>
  )
}

function Dashboard() {
  return (
    <RequireAuth>        {/* redirects to /auth/login if not auth'd */}
      <DashboardContent />
    </RequireAuth>
  )
}

function AdminPanel() {
  return (
    <RequireRole role="admin">  {/* renders nothing if role missing */}
      <AdminContent />
    </RequireRole>
  )
}
```

Higher-order component pattern:

```tsx
import { withAuthenticationRequired } from '@auth0/auth0-react-router'

export default withAuthenticationRequired(PrivatePage, {
  onRedirecting: () => <div>Redirecting to login…</div>,
})
```

### Error Boundary

```tsx
import { Auth0ErrorBoundary } from '@auth0/auth0-react-router'
import { AuthenticationError, TokenError } from '@auth0/auth0-react-router/errors'

<Auth0ErrorBoundary
  fallback={(error) => (
    <div>
      <p>Authentication error: {error.message}</p>
      <p>Code: {error.code} — Status: {error.statusCode}</p>
    </div>
  )}
>
  <RequireRole role="admin"><AdminPanel /></RequireRole>
</Auth0ErrorBoundary>
```

## Session and Token Utilities

### Reading Session Data

```ts
import {
  getSession, requireSession,
  getUser, requireUser,
  getAccessToken,
} from '@auth0/auth0-react-router/server'

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const session = await getSession(request)
  if (!session) return null

  const token = await getAccessToken(request)  // refreshes automatically
  return { user: session.user, token }
}
```

### Updating the Session

```ts
import { getSession, updateSession } from '@auth0/auth0-react-router/server'

export const action = async ({ request }: ActionFunctionArgs) => {
  const session = await getSession(request)
  return updateSession(request, {
    ...session!,
    user: { ...session!.user, preferences: { theme: 'dark' } },
  })
}
```

### Clearing the Session (Custom Logout)

```ts
import { deleteSession } from '@auth0/auth0-react-router/server'

export const action = async ({ request }: ActionFunctionArgs) => {
  return deleteSession(request, { redirectTo: '/' })
}
```

### Creating an API Client

```ts
import { createApiClient } from '@auth0/auth0-react-router/server'

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const api = createApiClient(request, { baseUrl: 'https://api.example.com' })
  const orders = await api('/orders').then(r => r.json())
  return { orders }
}
```

`createApiClient` automatically fetches a fresh access token and attaches it as a Bearer header.

## Client-Side Hooks

```tsx
import { useUser, useSession, useAuth0 } from '@auth0/auth0-react-router'

function Profile() {
  const user = useUser()           // Auth0User | null
  const session = useSession()     // Auth0Session | null (RWA: browser-safe only)
  const { getAccessToken } = useAuth0()  // Full context; getAccessToken() works in SPA mode

  if (!user) return <p>Not signed in</p>
  return <p>Hello, {user.name}</p>
}
```

## Middleware (React Router ≥ 7.9.0)

### Global Middleware

```ts
// app/entry.server.tsx or react-router.config.ts
import { auth0Middleware } from '@auth0/auth0-react-router/server'

// Register in your middleware array
export const middleware = [auth0Middleware]
```

Access from any loader/action context:

```ts
import { auth0SessionContext, auth0UserContext } from '@auth0/auth0-react-router/server'

export const loader = ({ context }: LoaderFunctionArgs) => {
  const session = context.get(auth0SessionContext)
  const user = context.get(auth0UserContext)
  return { user }
}
```

### Per-Route Role Protection

```ts
// app/routes/admin.tsx
import { defineRouteHandle } from '@auth0/auth0-react-router'
import { defineRouteAuth, auth0UserContext } from '@auth0/auth0-react-router/server'

export const handle = defineRouteHandle({ role: 'admin' })
export const middleware = defineRouteAuth({ role: 'admin' }).middleware

export const loader = ({ context }: LoaderFunctionArgs) => {
  const user = context.get(auth0UserContext)
  return { user }
}
```

Requests from users without the `admin` role receive a `403 Forbidden` response.

### API Bearer Token Middleware

```ts
// app/routes/api.$.tsx (parent route)
import { bearerTokenMiddleware } from '@auth0/auth0-react-router/server'
export const middleware = [bearerTokenMiddleware]
```

```ts
// app/routes/api.orders.tsx (child route)
import { requireClaimsFromContext } from '@auth0/auth0-react-router/server'

export async function loader({ context }: LoaderFunctionArgs) {
  const claims = requireClaimsFromContext(context, { scope: 'read:orders' })
  return Response.json(await getOrders(claims.sub))
}
```

## API Resource Server Protection

For routes that accept Bearer tokens directly (without middleware):

```ts
import { requireClaims, getClaims } from '@auth0/auth0-react-router/server'

export async function loader({ request }: LoaderFunctionArgs) {
  // Strict: 401 if missing token, 403 if scope not met
  const claims = await requireClaims(request, { scope: 'read:orders' })
  return Response.json(await getOrders(claims.sub))
}

export async function optionalLoader({ request }: LoaderFunctionArgs) {
  // Optional: returns null if no token (no error thrown)
  const claims = await getClaims(request)
  return Response.json({ data: claims ? await getPersonalData(claims.sub) : getPublicData() })
}
```

## Login Customization

### Custom Connection / Sign-Up

```tsx
// Sign in with Google
<LoginButton authorizationParams={{ connection: 'google-oauth2' }}>
  Sign in with Google
</LoginButton>

// Show sign-up form
<LoginButton authorizationParams={{ screen_hint: 'signup' }}>
  Create account
</LoginButton>

// Redirect after login
<LoginButton returnTo="/dashboard" />
```

Via query string (works with `handleLogin`):

```text
/auth/login?connection=google-oauth2&returnTo=/dashboard
/auth/login?screen_hint=signup
```

### Organizations

```ts
// Login to a specific organization
/auth/login?organization=org_abc123

// Accept invitation
/auth/login?organization=org_abc123&invitation=inv_xyz

// Or lock to org in Auth0Server config
export const auth0 = new Auth0Server({
  authorizationParams: { organization: 'org_abc123' },
})
```

## Authentication Flow

```text
User → /auth/login
  → handleLogin() → redirect to Auth0 Universal Login
  → Auth0 authenticates → redirect to /auth/callback?code=...&state=...
  → handleCallback() → validates state, exchanges code for tokens
  → Tokens encrypted into JWE cookie → redirect to app (/ by default)
  → rootAuthLoader() decrypts cookie → returns BrowserSession (no tokens)
  → Auth0Provider hydrates client state from BrowserSession
```

The browser **never** receives raw tokens in RWA mode. Tokens are encrypted in the cookie and only accessible via server utilities.

## SPA Mode

Activated when both `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID` env vars are present. The same `Auth0Provider` detects these at render time.

```env
VITE_AUTH0_DOMAIN=example.us.auth0.com
VITE_AUTH0_CLIENT_ID=your_spa_client_id
VITE_AUTH0_REDIRECT_URI=http://localhost:5173
VITE_AUTH0_SCOPE=openid profile email offline_access
VITE_AUTH0_CACHE_LOCATION=memory
VITE_AUTH0_USE_REFRESH_TOKENS=true
```

Handle async initialization:

```tsx
import { AuthLoading, SignedIn, SignedOut } from '@auth0/auth0-react-router'

function Header() {
  return (
    <nav>
      <AuthLoading><span>Loading…</span></AuthLoading>
      <SignedIn><LogoutButton /></SignedIn>
      <SignedOut><LoginButton /></SignedOut>
    </nav>
  )
}
```

Access token in SPA mode:

```ts
const { getAccessToken } = useAuth0()
const token = await getAccessToken()
```

> **Important:** Do not set both `AUTH0_*` and `VITE_AUTH0_*` env vars simultaneously — the modes are mutually exclusive.

## Back-Channel Logout

Requires a `sessionStore` on `Auth0Server` (cookie-based sessions cannot be targeted by back-channel logout tokens).

```ts
import type { SessionStore, StateData } from '@auth0/auth0-react-router/server'

class MySessionStore implements SessionStore<unknown> {
  private store = new Map<string, StateData>()

  async get(id: string) { return this.store.get(id) }
  async set(id: string, data: StateData) { this.store.set(id, data) }
  async delete(id: string) { this.store.delete(id) }
  async deleteByLogoutToken(claims: { sub?: string; sid?: string }) {
    for (const [id, data] of this.store) {
      const d = data as { internal?: { sid?: string }; user?: { sub?: string } }
      if ((claims.sid && d.internal?.sid === claims.sid) ||
          (claims.sub && d.user?.sub === claims.sub)) {
        this.store.delete(id)
      }
    }
  }
}

export const auth0 = new Auth0Server({ sessionStore: new MySessionStore() })
```

The `POST /auth/backchannel-logout` endpoint is handled automatically by `handleAuth`.

## Error Handling

All errors extend `Auth0Error` with `.code` and `.statusCode`:

```ts
import { AuthenticationError, TokenError, InsufficientScopeError }
  from '@auth0/auth0-react-router/errors'

try {
  const token = await getAccessToken(request)
} catch (err) {
  if (err instanceof TokenError) {
    // Expired and no refresh token — force re-login
    return deleteSession(request, { redirectTo: '/auth/login' })
  }
  if (err instanceof AuthenticationError) {
    // Login failed
    return new Response('Login failed', { status: 401 })
  }
  throw err
}
```

## Testing Patterns

### Unit-Testing Loaders

```ts
import { createMockLoader, createMockSession, createMockUser }
  from '@auth0/auth0-react-router/testing'

it('returns user data when authenticated', async () => {
  const session = createMockSession({
    user: createMockUser({ name: 'Jane Doe', email: 'jane@example.com' }),
  })
  const { request } = createMockLoader({ session })
  const result = await loader({ request, params: {}, context: {} })
  expect(result.user.name).toBe('Jane Doe')
})
```

### Unit-Testing Bearer Routes

```ts
import { createMockBearerRequest } from '@auth0/auth0-react-router/testing'

it('returns 401 when no token', async () => {
  const request = createMockBearerRequest()  // no token
  const response = await loader({ request, params: {}, context: {} })
  expect(response.status).toBe(401)
})

it('returns data with valid token', async () => {
  const request = createMockBearerRequest({ token: 'valid.jwt.token' })
  const response = await loader({ request, params: {}, context: {} })
  expect(response.status).toBe(200)
})
```

### Unit-Testing React Components

```tsx
import { render, screen } from '@testing-library/react'
import { WithAuth, createMockAuth0Context } from '@auth0/auth0-react-router/testing'

it('shows logout button when authenticated', () => {
  const context = createMockAuth0Context({
    isAuthenticated: true,
    user: { name: 'Jane Doe' },
  })
  render(
    <WithAuth context={context}>
      <SignedIn><LogoutButton /></SignedIn>
      <SignedOut><LoginButton /></SignedOut>
    </WithAuth>
  )
  expect(screen.getByText('Log Out')).toBeInTheDocument()
})
```
