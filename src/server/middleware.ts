import { createContext } from 'react-router';
import type { MiddlewareFunction, RouterContext } from 'react-router';
import {
  defineRouteHandle,
  type DefineRouteAuthOptions,
  type RouteAuthHandle
} from './route-handle.js';
import {
  ConfigurationError,
  InsufficientScopeError
} from '../errors/index.js';
import { getClaims } from './api.js';
import {
  getSession,
  _initRequestCookieJar,
  _drainRequestCookieJar
} from './utils.js';
import type { Auth0Session, Auth0User, JWTClaims } from '../types/index.js';
import type { RequireClaimsOptions } from './api.js';

/** The context object available in middleware and loader functions. @internal */
type MiddlewareContext = Parameters<MiddlewareFunction<Response>>[0]['context'];

// ─── Version helpers ──────────────────────────────────────────────────────────

// createContext was added in React Router 7.9.0.
// We must NOT call it at module-evaluation time — doing so would crash any
// import of this module (e.g. handleLogin) on React Router < 7.9.0 even if the
// caller never uses auth0Middleware or defineRouteAuth.
// Instead we create the context keys lazily-safely and assert inside each function.

function createContextSafe<T>(defaultValue: T): RouterContext<T> {
  return typeof createContext === 'function'
    ? createContext<T>(defaultValue)
    : ({ defaultValue } as RouterContext<T>);
}

function assertMiddlewareSupported(): void {
  if (typeof createContext !== 'function') {
    throw new ConfigurationError(
      'auth0Middleware, bearerTokenMiddleware and defineRouteAuth require React Router >= 7.9.0. ' +
        'Please upgrade: npm install react-router@latest'
    );
  }
}

// ─── Context keys ─────────────────────────────────────────────────────────────

/**
 * React Router context key for the server-side Auth0 session.
 *
 * Default value is `undefined` (not set). After auth0Middleware runs:
 *   - `null`         → request is unauthenticated
 *   - `Auth0Session` → request is authenticated
 *
 * @example
 * // app/routes/dashboard.ts
 * import { auth0SessionContext } from '@auth0/auth0-react-router/server';
 * export function loader({ context }) {
 *   const session = context.get(auth0SessionContext);
 * }
 */
export const auth0SessionContext = createContextSafe<
  Auth0Session | null | undefined
>(undefined);

/**
 * React Router context key for the authenticated user.
 *
 * Default value is `undefined` (not set). After auth0Middleware runs:
 *   - `null`      → request is unauthenticated
 *   - `Auth0User` → request is authenticated
 */
export const auth0UserContext = createContextSafe<Auth0User | null | undefined>(
  undefined
);

/**
 * React Router context key for validated Bearer token claims.
 *
 * Default value is `undefined` (not set). After bearerTokenMiddleware runs:
 *   - `null`       → request has no valid Bearer token
 *   - `JWTClaims`  → token was present and valid
 *
 * @example
 * // app/routes/api.users.ts
 * import { auth0ClaimsContext } from '@auth0/auth0-react-router/server';
 * export function loader({ context }) {
 *   const claims = context.get(auth0ClaimsContext);
 * }
 */
export const auth0ClaimsContext = createContextSafe<
  JWTClaims | null | undefined
>(undefined);

// ─── auth0Middleware ───────────────────────────────────────────────────────────

/**
 * React Router middleware that decrypts the Auth0 session once per request
 * and stores it in the router context.
 *
 * Place this on your root route so every loader in the tree can read auth
 * state via `context.get(auth0SessionContext)` without re-decrypting the cookie.
 *
 * After the downstream handler chain completes, any Set-Cookie headers written
 * by silent token refresh or session rolling are automatically forwarded to the
 * browser response.
 *
 * This middleware does NOT enforce authentication — it only populates context.
 * Use defineRouteAuth to block unauthenticated or unauthorised requests.
 *
 * Requires React Router >= 7.9.0.
 *
 * @example
 * // app/routes.ts
 * import { auth0Middleware } from '@auth0/auth0-react-router/server';
 *
 * export default [
 *   {
 *     id: 'root',
 *     path: '/',
 *     middleware: [auth0Middleware],
 *     ...rootRoute,
 *   },
 * ];
 */
export const auth0Middleware: MiddlewareFunction<Response> = async (
  { request, context },
  next
) => {
  assertMiddlewareSupported();
  _initRequestCookieJar(request);

  const session = await getSession(request);
  context.set(auth0SessionContext, session);
  context.set(auth0UserContext, session?.user ?? null);

  const response = await next();

  // Forward Set-Cookie headers from silent token refresh or session rolling
  // so the browser receives the updated cookie without loaders having to handle it.
  const cookies = _drainRequestCookieJar(request);
  if (cookies.length === 0) return response;

  const forwarded = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers)
  });
  for (const cookie of cookies) {
    forwarded.headers.append('Set-Cookie', cookie);
  }
  return forwarded;
};

// ─── bearerTokenMiddleware ────────────────────────────────────────────────────

/**
 * React Router middleware that validates the Bearer token once per request
 * and stores the resulting claims in the router context.
 *
 * Place this on any route tree that serves as a resource server (API routes).
 * Loaders in the tree can then read claims via `context.get(auth0ClaimsContext)`
 * or use `requireClaimsFromContext` / `getClaimsFromContext` without
 * re-verifying the token on every loader call.
 *
 * This middleware does NOT throw when the token is absent or invalid — it sets
 * claims to `null`. Use `requireClaimsFromContext` inside individual loaders
 * to enforce authentication.
 *
 * Requires React Router >= 7.9.0.
 *
 * @example
 * // app/routes.ts
 * import { bearerTokenMiddleware } from '@auth0/auth0-react-router/server';
 *
 * export default [
 *   {
 *     path: '/api',
 *     middleware: [bearerTokenMiddleware],
 *     children: [...apiRoutes],
 *   },
 * ];
 */
export const bearerTokenMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next
) => {
  assertMiddlewareSupported();
  const claims = await getClaims(request);
  context.set(auth0ClaimsContext, claims);
  return next();
};

// ─── Context helpers ──────────────────────────────────────────────────────────

/**
 * Returns validated JWT claims from the router context, or null if
 * no valid Bearer token was present. Normalises the `undefined` default
 * (middleware not mounted) to `null`.
 *
 * Requires `bearerTokenMiddleware` to be mounted on a parent route.
 */
export function getClaimsFromContext(
  context: MiddlewareContext
): JWTClaims | null {
  assertMiddlewareSupported();
  return context.get(auth0ClaimsContext) ?? null;
}

/**
 * Returns validated JWT claims from the router context.
 *
 * Throws a `Response` (401 or 403 JSON) that React Router forwards directly
 * to the client — no try/catch needed in the loader.
 *
 * Synchronous — the token was already verified by `bearerTokenMiddleware`,
 * so no JWT re-verification or network call is made.
 *
 * Requires `bearerTokenMiddleware` to be mounted on a parent route.
 *
 * @throws {Response} 401 — no valid Bearer token in context
 * @throws {Response} 403 — token valid but missing required scope
 *
 * @example
 * export async function loader({ context }: LoaderFunctionArgs) {
 *   const claims = requireClaimsFromContext(context, { scope: 'read:users' });
 *   return { sub: claims.sub };
 * }
 */
export function requireClaimsFromContext(
  context: MiddlewareContext,
  opts?: RequireClaimsOptions
): JWTClaims {
  assertMiddlewareSupported();
  const claims = context.get(auth0ClaimsContext);
  if (!claims)
    throw new Response(
      JSON.stringify({ error: 'bearer_token_error', error_description: 'No Bearer token found in Authorization header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );

  if (opts?.scope) {
    const required = Array.isArray(opts.scope) ? opts.scope : [opts.scope];
    const tokenScopes = claims.scope?.trim().split(/\s+/) ?? [];
    if (!required.every(s => tokenScopes.includes(s))) {
      throw new Response(
        JSON.stringify({ error: 'insufficient_scope', error_description: `Required scope(s): ${required.join(', ')}` }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  return claims;
}

// ─── Context helpers (internal) ───────────────────────────────────────────────

// React Router's context.get() throws "No value found for context" when the key
// has never been set and the default value is undefined — it treats undefined as
// "no default provided" rather than "default is undefined". Use this helper
// wherever we speculatively read a context key that may not have been set yet.
function getOptionalContext<T>(
  context: MiddlewareContext,
  key: RouterContext<T>
): T | undefined {
  try {
    return context.get(key);
  } catch {
    return undefined;
  }
}

// ─── defineRouteAuth ──────────────────────────────────────────────────────────

export type { DefineRouteAuthOptions, RouteAuthHandle } from './route-handle.js';
export { defineRouteHandle } from './route-handle.js';

const DEFAULT_ROLES_CLAIM = 'https://auth0.com/claims/roles';

/**
 * Creates both the route handle metadata and the enforcement middleware from a
 * single config object. Spread `middleware` onto a layout route to protect the
 * entire subtree; export `handle` so `useMatches()` can identify protected routes.
 *
 * - Unauthenticated requests are redirected to the login page (302).
 *   The current URL is preserved as `?returnTo=` so the user lands back
 *   where they started after a successful login.
 * - Authenticated requests that lack the required role(s) throw
 *   InsufficientScopeError (403). React Router's error boundary handles this.
 * - If auth0Middleware has already run on a parent route, the session is read
 *   from context — no second cookie decrypt.
 *
 * Requires React Router >= 7.9.0.
 *
 * @example
 * // Protect /admin and all child routes, require the 'admin' role
 * const adminAuth = defineRouteAuth({ role: 'admin' });
 *
 * {
 *   path: '/admin',
 *   handle: adminAuth.handle,
 *   middleware: adminAuth.middleware,
 *   children: [...adminRoutes],
 * }
 */
export function defineRouteAuth(opts?: DefineRouteAuthOptions): {
  handle: RouteAuthHandle;
  middleware: MiddlewareFunction<Response>[];
} {
  assertMiddlewareSupported();
  return {
    handle: defineRouteHandle(opts),
    middleware: [
      async ({ request, context }, next) => {
        // Read from context if auth0Middleware already ran; otherwise decrypt now.
        // getOptionalContext is used here because context.get() throws when the
        // key was never set and the default is undefined (see helper above).
        const sessionInCtx = getOptionalContext(context, auth0SessionContext);
        const session =
          sessionInCtx !== undefined ? sessionInCtx : await getSession(request);

        if (sessionInCtx === undefined) {
          context.set(auth0SessionContext, session);
          context.set(auth0UserContext, session?.user ?? null);
        }

        // ── Unauthenticated → redirect to login ──────────────────────────────
        if (!session) {
          const { pathname, search } = new URL(request.url);
          const returnTo = pathname + search;
          const loginPath = process.env['AUTH0_LOGIN_PATH'] ?? '/auth/login';
          // Dummy base lets URL parse relative loginPath values.
          // searchParams.set handles the case where loginPath already has a query string.
          const loginUrl = new URL(loginPath, 'http://x');
          loginUrl.searchParams.set('returnTo', returnTo);
          throw new Response(null, {
            status: 302,
            headers: { Location: loginUrl.pathname + loginUrl.search }
          });
        }

        // ── Role check → 403 ─────────────────────────────────────────────────
        if (opts?.role) {
          const rolesClaim = opts.rolesClaim ?? DEFAULT_ROLES_CLAIM;
          const userRoles =
            (session.user[rolesClaim] as string[] | undefined) ?? [];
          const required = Array.isArray(opts.role) ? opts.role : [opts.role];

          if (!required.every(r => userRoles.includes(r))) {
            throw new InsufficientScopeError(
              `Required role(s): ${required.join(', ')}`
            );
          }
        }

        return next();
      }
    ]
  };
}
