import {
  MissingTransactionError,
  BackchannelLogoutError
} from '@auth0/auth0-server-js';
import { CallbackError } from '../errors/index.js';
import type { Auth0Server } from './auth0-server.js';
import type { Auth0User } from '../types/index.js';

// ─── Option types ─────────────────────────────────────────────────────────────

export interface HandleLoginOptions {
  /**
   * Where to send the user after a successful login.
   * Falls back to the `returnTo` query parameter on the request URL, then '/'.
   */
  returnTo?: string;

  /**
   * Additional authorization parameters merged into the Auth0 redirect URL.
   * Useful for prompting for consent, forcing login, etc.
   */
  authorizationParams?: Record<string, unknown>;
}

export interface HandleCallbackOptions {
  /**
   * Fallback redirect destination after a successful callback.
   * The `returnTo` stored in appState during login takes precedence.
   */
  returnTo?: string;
}

export interface HandleLogoutOptions {
  /**
   * Where to send the user after they are logged out.
   * Defaults to the app base URL.
   */
  returnTo?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a fresh Response to collect Set-Cookie headers written by the
 * transaction/state stores, then copies them onto the given Headers object.
 */
function drainCookies(cookieJar: Response, target: Headers): void {
  for (const value of cookieJar.headers.getSetCookie()) {
    target.append('Set-Cookie', value);
  }
}

/**
 * Returns true only for relative URLs that cannot redirect the user off-site.
 * Rejects absolute URLs (https://evil.com), protocol-relative URLs (//evil.com),
 * and backslash-prefixed URLs (/\evil.com) which browsers normalize to //evil.com.
 */
function isSafeRelativeUrl(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Starts the OIDC login flow.
 *
 * Writes the PKCE transaction cookie (__a0_tx) and redirects the user to
 * Auth0's /authorize endpoint.
 *
 * GET only — login initiates a browser redirect flow and must not be triggered
 * by non-idempotent methods. Responds with 405 for non-GET requests.
 *
 * @example
 * // app/routes/auth.login.ts
 * export const loader = ({ request }) => handleLogin(auth0, request);
 */
export async function handleLogin(
  auth0: Auth0Server,
  request: Request,
  options: HandleLoginOptions = {}
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET' }
    });
  }

  const cookieJar = new Response();
  const storeOptions = { request, response: cookieJar };

  // returnTo: explicit option > query param on the login URL > home
  // The query param is user-controlled input so we only accept relative paths
  // to prevent open redirects (e.g. ?returnTo=https://attacker.com).
  const queryReturnTo = new URL(request.url).searchParams.get('returnTo');
  const returnTo =
    options.returnTo ??
    (queryReturnTo && isSafeRelativeUrl(queryReturnTo)
      ? queryReturnTo
      : null) ??
    '/';

  const appBaseUrl = auth0.config.appBaseUrl ?? new URL(request.url).origin;

  const authUrl = await auth0.serverClient.startInteractiveLogin(
    {
      appState: { returnTo },
      authorizationParams: {
        redirect_uri: new URL('/auth/callback', appBaseUrl).toString(),
        ...options.authorizationParams
      }
    },
    storeOptions
  );

  const headers = new Headers({ Location: authUrl.toString() });
  drainCookies(cookieJar, headers);

  return new Response(null, { status: 302, headers });
}

/**
 * Completes the OIDC callback.
 *
 * Exchanges the authorization code for tokens, writes the session cookie
 * (__a0_session), clears the transaction cookie, and redirects to returnTo.
 *
 * GET only — Auth0 redirects back to the callback URL via a browser GET.
 * Responds with 405 for non-GET requests.
 *
 * @example
 * // app/routes/auth.callback.ts
 * export const loader = ({ request }) => handleCallback(auth0, request);
 */
export async function handleCallback(
  auth0: Auth0Server,
  request: Request,
  options: HandleCallbackOptions = {}
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET' }
    });
  }

  const cookieJar = new Response();
  const storeOptions = { request, response: cookieJar };

  let appState: { returnTo?: string } | undefined;

  try {
    const result = await auth0.serverClient.completeInteractiveLogin<{
      returnTo?: string;
    }>(new URL(request.url), storeOptions);
    appState = result.appState;

    if (auth0.onCallback) {
      const session = auth0.stateStore.getCaptured(cookieJar);
      if (session) await auth0.onCallback(session);
    }
  } catch (err) {
    if (err instanceof MissingTransactionError) {
      throw new CallbackError(
        `Login transaction not found. This usually means the callback URL was opened ` +
          `directly or the transaction cookie expired. Start a new login flow at /auth/login.`
      );
    }
    throw new CallbackError(
      `Failed to complete login: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const returnTo = appState?.returnTo ?? options.returnTo ?? '/';

  const headers = new Headers({ Location: returnTo });
  drainCookies(cookieJar, headers);

  return new Response(null, { status: 302, headers });
}

/**
 * Logs the user out.
 *
 * Clears the session cookie and redirects the user to Auth0's /v2/logout
 * endpoint, which then sends them to `returnTo`.
 *
 * POST only — GET logout can be triggered by third-party links or image tags,
 * which would silently log users out. Responds with 405 for non-POST requests.
 *
 * @example
 * // app/routes/auth.logout.ts
 * export const action = ({ request }) => handleLogout(auth0, request);
 */
export async function handleLogout(
  auth0: Auth0Server,
  request: Request,
  options: HandleLogoutOptions = {}
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'POST' }
    });
  }

  const cookieJar = new Response();
  const storeOptions = { request, response: cookieJar };

  // returnTo: explicit option > query param on the logout URL > app origin.
  // Query-string returnTo is validated as a relative path (same rules as login)
  // and resolved against the app origin before being forwarded to Auth0.
  // This prevents open redirects: only paths on the same domain are accepted.
  const appBaseUrl = auth0.config.appBaseUrl ?? new URL(request.url).origin;
  const queryReturnTo = new URL(request.url).searchParams.get('returnTo');
  const returnTo =
    options.returnTo ??
    (queryReturnTo && isSafeRelativeUrl(queryReturnTo)
      ? new URL(appBaseUrl).origin + queryReturnTo
      : null) ??
    new URL(appBaseUrl).origin;

  const logoutUrl = await auth0.serverClient.logout({ returnTo }, storeOptions);

  const headers = new Headers({ Location: logoutUrl.toString() });
  drainCookies(cookieJar, headers);

  return new Response(null, { status: 302, headers });
}

/**
 * Handles OIDC Back-Channel Logout.
 *
 * Auth0 POSTs a signed `logout_token` to this endpoint when a session is
 * terminated server-side (e.g. admin logout, IdP-initiated logout).
 *
 * Validates the token and deletes the matching session from the state store.
 * Returns 204 on success, 400 if the token is missing or invalid.
 *
 * @example
 * // app/routes/auth.logout.backchannel.ts
 * export const action = ({ request }) => handleBackchannelLogout(auth0, request);
 */
export async function handleBackchannelLogout(
  auth0: Auth0Server,
  request: Request
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'POST' }
    });
  }

  let logoutToken: string | null = null;

  try {
    const body = await request.formData();
    logoutToken = body.get('logout_token') as string | null;
  } catch {
    return new Response('Bad Request: could not parse request body', {
      status: 400
    });
  }

  if (!logoutToken) {
    return new Response('Bad Request: logout_token is required', {
      status: 400
    });
  }

  const cookieJar = new Response();
  const storeOptions = { request, response: cookieJar };

  try {
    await auth0.serverClient.handleBackchannelLogout(logoutToken, storeOptions);
  } catch (err) {
    if (err instanceof BackchannelLogoutError) {
      return new Response(`Bad Request: ${err.message}`, { status: 400 });
    }
    // VerifyLogoutTokenError and other validation failures
    return new Response(
      `Bad Request: ${err instanceof Error ? err.message : 'invalid logout token'}`,
      { status: 400 }
    );
  }

  return new Response(null, { status: 204 });
}

export interface HandleAuthOptions {
  login?: HandleLoginOptions;
  callback?: HandleCallbackOptions;
  logout?: HandleLogoutOptions;
}

/**
 * Unified Auth0 request handler for use as both `loader` and `action` on a
 * splat route (`/auth/*`). Dispatches to the appropriate handler based on
 * the URL pathname:
 *
 *   /auth/login               → handleLogin
 *   /auth/callback            → handleCallback
 *   /auth/logout              → handleLogout
 *   /auth/backchannel-logout  → handleBackchannelLogout
 *
 * Each handler enforces its expected method and returns 405 for unexpected
 * methods, so both loader and action can safely point to this function.
 *
 * @example
 * // app/routes/auth.$.ts
 * export const loader = ({ request }) => handleAuth(auth0, request);
 * export const action  = ({ request }) => handleAuth(auth0, request);
 */
export async function handleAuth(
  auth0: Auth0Server,
  request: Request,
  options: HandleAuthOptions = {}
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname.endsWith('/login')) {
    return handleLogin(auth0, request, options.login);
  }
  if (pathname.endsWith('/callback')) {
    return handleCallback(auth0, request, options.callback);
  }
  if (pathname.endsWith('/logout')) {
    return handleLogout(auth0, request, options.logout);
  }
  if (pathname.endsWith('/backchannel-logout')) {
    return handleBackchannelLogout(auth0, request);
  }

  return new Response('Not Found', { status: 404 });
}

// ─── stripIdTokenClaims ───────────────────────────────────────────────────────

const STRIP_CLAIMS = new Set(['iss', 'aud', 'exp', 'iat', 'nonce', 'at_hash']);

/**
 * Removes standard OIDC metadata fields from a user object.
 *
 * ID token claims (iss, aud, exp, iat, nonce, at_hash) are written into the
 * user object during the callback but are not useful after that point. Stripping
 * them inside a beforeSessionSaved hook reduces the encrypted session cookie size.
 *
 * @example
 * const auth0 = new Auth0Server({
 *   ...config,
 *   beforeSessionSaved: (session) => ({
 *     ...session,
 *     user: stripIdTokenClaims(session.user),
 *   }),
 * });
 */
export function stripIdTokenClaims(user: Auth0User): Auth0User {
  return Object.fromEntries(
    Object.entries(user).filter(([key]) => !STRIP_CLAIMS.has(key))
  ) as Auth0User;
}

