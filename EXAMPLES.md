# Examples

- [Custom login parameters](#custom-login-parameters)
- [Sign-up screen](#sign-up-screen)
- [Wiring hooks to standalone helpers](#wiring-hooks-to-standalone-helpers)
- [Protecting a route (server-side)](#protecting-a-route-server-side)
- [Protecting a route (client-side)](#protecting-a-route-client-side)
- [Role-based route protection](#role-based-route-protection)
- [Handling auth errors](#handling-auth-errors)
- [Accessing session data in loaders](#accessing-session-data-in-loaders)
- [Calling an API with an access token](#calling-an-api-with-an-access-token)
- [Handling token expiry](#handling-token-expiry)
- [Updating and deleting session data](#updating-and-deleting-session-data)
- [Organizations](#organizations)
- [SPA mode](#spa-mode)
- [Protecting API routes with Bearer tokens](#protecting-api-routes-with-bearer-tokens)
- [Back-channel logout](#back-channel-logout)
- [Testing authenticated flows](#testing-authenticated-flows)
- [Key behaviors](#key-behaviors)

## Custom login parameters

Pass extra authorization parameters to `handleLogin` or link to `/auth/login` directly:

```tsx
// Using the LoginButton component with extra params
import { LoginButton } from '@auth0/auth0-react-router';

<LoginButton authorizationParams={{ connection: 'google-oauth2' }}>
  Sign in with Google
</LoginButton>
```

Or trigger login from a loader/action and forward parameters via the query string:

```
/auth/login?connection=google-oauth2&returnTo=/dashboard
```

`handleLogin` reads `connection`, `audience`, `scope`, `screen_hint`, and any other
`authorizationParams` from the search params automatically.

## Sign-up screen

Show the Auth0 sign-up form instead of the login form by passing `screen_hint=signup`.
This requires **New Universal Login** to be enabled on your tenant (Auth0 Dashboard →
Branding → Universal Login).

```tsx
import { LoginButton } from '@auth0/auth0-react-router';

<LoginButton authorizationParams={{ screen_hint: 'signup' }}>
  Create account
</LoginButton>
```

Or link directly:

```
/auth/login?screen_hint=signup
```

## Wiring hooks to standalone helpers

By default, standalone helpers (`getSession`, `updateSession`, `deleteSession`,
`getAccessToken`, etc.) use an internal `Auth0Server` instance that has no hooks.
Call `registerAuth0Instance` once after constructing your instance so that
`onCallback` and `beforeSessionSaved` fire across all helpers, not just `handleCallback`:

```ts
// app/auth0.server.ts
import { Auth0Server, registerAuth0Instance } from '@auth0/auth0-react-router/server';

export const auth0 = new Auth0Server({
  async beforeSessionSaved(session) {
    // Runs before the session cookie is written — add custom claims here
    return { ...session, user: { ...session.user, app_role: 'member' } };
  },
  onCallback(session) {
    // Runs after a successful login — provision the user in your database here
  },
});

registerAuth0Instance(auth0);
```

> **Note:** If you skip `registerAuth0Instance`, `beforeSessionSaved` and `onCallback`
> will only fire during the login callback. They will not fire when the session is updated
> via `updateSession` or refreshed via `getAccessToken`.

## Protecting a route (server-side)

Use `requireSession` in a loader to block unauthenticated requests at the server.
It returns the session or throws a `302` redirect to `/auth/login` with a `returnTo`
parameter so the user lands back on the original page after login:

```ts
// app/routes/dashboard.tsx
import { requireSession } from '@auth0/auth0-react-router/server';

export const loader = async ({ request }) => {
  const session = await requireSession(request);
  return { user: session.user };
};
```

Use `requireUser` when you only need the user profile, not the full session:

```ts
import { requireUser } from '@auth0/auth0-react-router/server';

export const loader = async ({ request }) => {
  const user = await requireUser(request);
  return { user };
};
```

## Protecting a route (client-side)

> **Note:** Client-side guards control rendering after hydration — they do not block the
> server response. For real server-side protection use `requireSession` in the loader.

**Redirect to login when unauthenticated:**

```tsx
import { RequireAuth } from '@auth0/auth0-react-router';

export default function Dashboard() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}
```

**Show/hide UI based on auth state:**

```tsx
import { SignedIn, SignedOut, AuthLoading, LoginButton, LogoutButton } from '@auth0/auth0-react-router';

function Header() {
  return (
    <nav>
      <AuthLoading>
        <Spinner />
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

**Higher-order component:**

```tsx
import { withAuthenticationRequired } from '@auth0/auth0-react-router';

const PrivatePage = () => <div>Private content</div>;

export default withAuthenticationRequired(PrivatePage, {
  onRedirecting: () => <div>Redirecting to login…</div>,
});
```

## Role-based route protection

Use `defineRouteAuth` middleware to enforce roles at the route level. The middleware
reads roles from the `https://auth0.com/claims/roles` claim by default.

```ts
// app/routes/admin.tsx
import { defineRouteHandle } from '@auth0/auth0-react-router';
import { defineRouteAuth, auth0UserContext } from '@auth0/auth0-react-router/server';

// handle is read client-side (e.g. by useMatches for breadcrumbs)
export const handle = defineRouteHandle({ role: 'admin' });

// middleware is stripped from the client bundle by React Router
export const middleware = defineRouteAuth({ role: 'admin' }).middleware;

export const loader = ({ context }) => {
  // User is guaranteed to exist and have the role here
  const user = context.get(auth0UserContext);
  return { user };
};
```

Requests without the required role receive a `403`. To use a non-default roles claim:

```ts
export const middleware = defineRouteAuth({
  role: 'admin',
  rolesClaim: 'https://myapp.example.com/roles',
}).middleware;
```

**Client-side role guard:**

```tsx
import { RequireRole } from '@auth0/auth0-react-router';

<RequireRole role="admin">
  <AdminPanel />
</RequireRole>
```

## Handling auth errors

Wrap any component that might throw an Auth0 error in `Auth0ErrorBoundary`. All eight
error classes are caught, useful around `RequireRole` and other guards that throw on failure:

```tsx
import { Auth0ErrorBoundary, RequireRole } from '@auth0/auth0-react-router';

export default function AdminPanel() {
  return (
    <Auth0ErrorBoundary
      fallback={(error) => (
        <div>
          <p>Access denied: {error.message}</p>
          <p>Code: {error.code} — Status: {error.statusCode}</p>
        </div>
      )}
    >
      <RequireRole role="admin">
        <AdminContent />
      </RequireRole>
    </Auth0ErrorBoundary>
  );
}
```

Error classes exported from `@auth0/auth0-react-router/errors`:

| Class | `code` | `statusCode` |
|---|---|---|
| `AuthenticationError` | `authentication_error` | 401 |
| `SessionExpiredError` | `session_expired` | 401 |
| `MissingSessionError` | `missing_session` | 401 |
| `TokenError` | `token_error` | 401 |
| `BearerTokenError` | `bearer_token_error` | 401 |
| `CallbackError` | `callback_error` | 400 |
| `InsufficientScopeError` | `insufficient_scope` | 403 |
| `ConfigurationError` | `configuration_error` | 500 |

## Accessing session data in loaders

Read the session or user without throwing a redirect — useful when auth is optional:

```ts
import { getSession, getUser } from '@auth0/auth0-react-router/server';

export const loader = async ({ request }) => {
  const session = await getSession(request); // Auth0Session | null
  const user = await getUser(request);       // Auth0User | null
  return { user };
};
```

Read from React Router middleware context when using `auth0Middleware`:

```ts
import { auth0SessionContext, auth0UserContext } from '@auth0/auth0-react-router/server';

export const loader = ({ context }) => {
  const session = context.get(auth0SessionContext); // Auth0Session | null
  const user    = context.get(auth0UserContext);    // Auth0User | null
  return { user };
};
```

## Calling an API with an access token

Use `getAccessToken` in a loader or action. Expired tokens are silently refreshed
before being returned.

```ts
// app/routes/orders.tsx
import { getAccessToken } from '@auth0/auth0-react-router/server';

export const loader = async ({ request }) => {
  const token = await getAccessToken(request);

  const data = await fetch('https://api.example.com/orders', {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());

  return { data };
};
```

Or use `createApiClient` to get a pre-configured client that injects the token
automatically:

```ts
import { createApiClient } from '@auth0/auth0-react-router/server';

export const loader = async ({ request }) => {
  const api = createApiClient(request, { baseUrl: 'https://api.example.com' });

  const orders = await api('/orders').then(r => r.json());
  return { orders };
};
```

## Handling token expiry

When `AUTH0_SCOPE` does not include `offline_access` or the refresh token is missing,
`getAccessToken` throws a `TokenError`. Clear the stale session and redirect to login:

```ts
import { getAccessToken, deleteSession } from '@auth0/auth0-react-router/server';
import { TokenError } from '@auth0/auth0-react-router/errors';

export const loader = async ({ request }) => {
  let token: string;
  try {
    token = await getAccessToken(request);
  } catch (err) {
    if (err instanceof TokenError) {
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

**Token refresh prerequisites** — silent refresh requires all three of:

1. `AUTH0_SCOPE=openid profile email offline_access` in your `.env`
2. **Allow Offline Access** enabled on your API (Auth0 Dashboard → Applications → APIs →
   your API → Settings)
3. **Refresh Token** grant enabled on your application (Auth0 Dashboard → Applications →
   your app → Settings → Advanced Settings → Grant Types)

## Updating and deleting session data

Store arbitrary data alongside the Auth0 session:

```ts
import { getSession, updateSession } from '@auth0/auth0-react-router/server';

export const action = async ({ request }) => {
  const session = await getSession(request);
  const response = await updateSession(request, {
    ...session,
    user: { ...session.user, preferences: { theme: 'dark' } },
  });
  return response;
};
```

Clear the session and redirect (e.g. after a security event):

```ts
import { deleteSession } from '@auth0/auth0-react-router/server';

export const action = async ({ request }) => {
  return deleteSession(request, { redirectTo: '/' });
};
```

## Organizations

To log users in to a specific Auth0 organization, pass the `organization` parameter:

```
/auth/login?organization=org_abc123
```

Or set it in the `Auth0Server` constructor so it applies to every login:

```ts
// app/auth0.server.ts
import { Auth0Server, registerAuth0Instance } from '@auth0/auth0-react-router/server';

export const auth0 = new Auth0Server({
  authorizationParams: {
    organization: 'org_abc123',
  },
});

registerAuth0Instance(auth0);
```

To accept an organization invitation, pass both `organization` and `invitation`:

```
/auth/login?organization=org_abc123&invitation=inv_xyz
```

## SPA mode

SPA mode activates automatically when `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID`
are both set. No `Auth0Server`, no session cookie, no server-side handlers — the full
OIDC flow runs in the browser.

The same `Auth0Provider`, hooks, and components work in both modes.

```sh
# .env
VITE_AUTH0_DOMAIN=example.us.auth0.com
VITE_AUTH0_CLIENT_ID=your_client_id
```

**Persistent sessions across page refreshes:**

By default tokens are kept in memory and lost on refresh. To persist sessions,
three steps are required:

1. Enable **Allow Offline Access** on your Auth0 API
2. Enable the **Refresh Token** grant on your application
3. Add to your `.env`:

```sh
VITE_AUTH0_CACHE_LOCATION=localstorage
VITE_AUTH0_SCOPE=openid profile email offline_access
```

> **Security note:** `localstorage` tokens are readable by any JavaScript on the page.
> Only use this if your application has strong XSS mitigations in place.

**Getting an access token in SPA mode:**

```tsx
import { useAuth0 } from '@auth0/auth0-react-router';

function CallApi() {
  const { getAccessToken } = useAuth0();

  const fetchData = async () => {
    const token = await getAccessToken();
    await fetch('https://api.example.com/data', {
      headers: { Authorization: `Bearer ${token}` },
    });
  };

  return <button onClick={fetchData}>Fetch data</button>;
}
```

## Protecting API routes with Bearer tokens

React Router loaders and actions can also serve as API endpoints called by mobile apps,
SPAs, or other services using a Bearer JWT.

**Single route — `requireClaims`:**

```ts
import { requireClaims } from '@auth0/auth0-react-router/server';

export async function loader({ request }) {
  const claims = await requireClaims(request, { scope: 'read:orders' });
  //   no token      → 401 { "error": "bearer_token_error", ... }
  //   missing scope → 403 { "error": "insufficient_scope", ... }
  return Response.json(await getOrders(claims.sub));
}
```

Use `getClaims` when you want to handle the unauthenticated case yourself:

```ts
import { getClaims } from '@auth0/auth0-react-router/server';

export async function loader({ request }) {
  const claims = await getClaims(request);
  if (!claims) return Response.json({ public: true });
  return Response.json({ user: claims.sub });
}
```

**Shared parent route — `bearerTokenMiddleware`:**

Verify the token once in a parent route and read it from context in child loaders,
avoiding repeated JWKS calls:

```ts
// app/routes.ts
import { route } from '@react-router/dev/routes';
import { bearerTokenMiddleware } from '@auth0/auth0-react-router/server';

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

Two environment variables are required — no client secret or session config needed:

```sh
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://your-api-identifier
```

## Back-channel logout

Auth0 can terminate a user session from the Dashboard or another application via a
back-channel logout request. The `handleAuth` splat route handles it automatically on
`POST /auth/backchannel-logout`.

If you are using individual handlers, register it explicitly:

```ts
// app/routes/auth.$.tsx
import {
  handleLogin,
  handleCallback,
  handleLogout,
  handleBackchannelLogout,
} from '@auth0/auth0-react-router/server';
import { auth0 } from '../auth0.server';

export const action = async ({ request }) => {
  const url = new URL(request.url);

  if (url.pathname.endsWith('/login'))               return handleLogin(auth0, request);
  if (url.pathname.endsWith('/callback'))            return handleCallback(auth0, request);
  if (url.pathname.endsWith('/logout'))              return handleLogout(auth0, request);
  if (url.pathname.endsWith('/backchannel-logout'))  return handleBackchannelLogout(auth0, request);

  return new Response('Not found', { status: 404 });
};
```

Register the back-channel logout URL in the Auth0 Dashboard under your application's
**Settings** → **Back-Channel Logout URI**:
`https://your-app.com/auth/backchannel-logout`

## Testing authenticated flows

Use the provided test utilities to test loaders, actions, and components without a
real Auth0 tenant.

**Mocking server-side helpers:**

```ts
import { createMockLoader, createMockSession, createMockUser } from '@auth0/auth0-react-router/testing';

it('returns user data when authenticated', async () => {
  const session = createMockSession({
    user: createMockUser({ name: 'Jane Doe' }),
  });

  const { request } = createMockLoader({ session });
  const result = await loader({ request });

  expect(result.user.name).toBe('Jane Doe');
});
```

**Mocking Bearer token routes:**

```ts
import { createMockBearerRequest } from '@auth0/auth0-react-router/testing';

it('returns 401 when token is missing', async () => {
  const request = createMockBearerRequest(); // no token
  const response = await loader({ request });
  expect(response.status).toBe(401);
});
```

**Wrapping components in a mock provider:**

```tsx
import { render, screen } from '@testing-library/react';
import { WithAuth, createMockAuth0Context } from '@auth0/auth0-react-router/testing';
import { Dashboard } from './Dashboard';

it('shows user name when signed in', () => {
  const context = createMockAuth0Context({
    isAuthenticated: true,
    user: { name: 'Jane Doe' },
  });

  render(
    <WithAuth context={context}>
      <Dashboard />
    </WithAuth>
  );

  expect(screen.getByText('Jane Doe')).toBeInTheDocument();
});
```

## Key behaviors

- **Lazy initialization:** `Auth0Server` does not validate environment variables until
  the first auth operation. Safe to instantiate at module scope without crashing public routes.

- **Register your instance:** call `registerAuth0Instance(auth0)` after constructing
  `Auth0Server` so that standalone helpers fire your `onCallback` and `beforeSessionSaved` hooks.

- **Context access pattern:** use `context.get(auth0SessionContext)`, not
  `auth0SessionContext.get(context)`.

- **Server-side vs client-side protection:** `requireSession` and `requireUser` block
  the server response entirely. `RequireAuth`, `RequireRole`, and `withAuthenticationRequired`
  are client-only and only control rendering after hydration.

- **Tokens stay on the server:** tokens are encrypted in the JWE session cookie and
  never sent to the browser. Use `getAccessToken` in a loader, not a client hook.

- **`deleteSession` footgun:** returning `deleteSession` directly from a protected loader
  or action causes a redirect loop because the new request hits the same protection check
  on a blank session. Always pass `{ redirectTo }` pointing to a public page.

- **API routes need `AUTH0_AUDIENCE`:** without it, tokens are opaque JWE and cannot be
  validated by `getClaims` or `requireClaims`. Set `AUTH0_AUDIENCE` to your API identifier.

- **Hybrid mode is not supported:** do not set both `AUTH0_*` and `VITE_*` env vars at
  the same time. The app runs in one mode only: SSR (`AUTH0_*`) or SPA (`VITE_*`).
