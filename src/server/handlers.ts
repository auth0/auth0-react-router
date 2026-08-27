import {
  MissingTransactionError,
  BackchannelLogoutError
} from '@auth0/auth0-server-js';
import { Auth0Error, CallbackError } from '../errors/index.js';
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
 *
 * Uses the WHATWG URL parser as the validator rather than a block-list. The
 * parser strips raw control characters (TAB 0x09, LF 0x0A, CR 0x0D) and
 * normalises backslashes before producing the parsed form, so payloads like
 * "/<TAB>/evil.com" or "/\evil.com" that bypass simple prefix checks are
 * caught here. A URL is safe when its parsed origin equals our dummy base,
 * meaning it resolved as a path rather than as an absolute or
 * protocol-relative URL with a foreign authority.
 */
function isSafeRelativeUrl(url: string): boolean {
  if (!url.startsWith('/')) return false;
  try {
    return new URL(url, 'https://x.invalid').origin === 'https://x.invalid';
  } catch {
    return false;
  }
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
  // Both sources are validated as safe relative paths to prevent open redirects
  // (e.g. options.returnTo misconfigured as an absolute URL, or
  // ?returnTo=https://attacker.com / ?returnTo=/%09/evil.com from a crafted link).
  const queryReturnTo = new URL(request.url).searchParams.get('returnTo');
  const returnTo =
    (options.returnTo && isSafeRelativeUrl(options.returnTo)
      ? options.returnTo
      : null) ??
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

  // When the app sits behind a TLS-terminating proxy (e.g. Nginx, Caddy, AWS ALB)
  // the inbound request arrives over plain HTTP, so request.url carries an http://
  // scheme even though AUTH0_APP_BASE_URL is https://. handleLogin built the
  // redirect_uri from appBaseUrl (https://), so completeInteractiveLogin must
  // receive the same scheme — otherwise Auth0 rejects the token exchange with a
  // redirect_uri mismatch. We correct only the protocol; the path and query string
  // (code, state) come from the live request and are intentionally preserved.
  const callbackUrl = new URL(request.url);
  if (auth0.config.appBaseUrl) {
    callbackUrl.protocol = new URL(auth0.config.appBaseUrl).protocol;
  }

  try {
    const result = await auth0.serverClient.completeInteractiveLogin<{
      returnTo?: string;
    }>(callbackUrl, storeOptions);
    appState = result.appState;
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

  if (auth0.onCallback) {
    const session = auth0.stateStore.getCaptured(cookieJar);
    if (session) await auth0.onCallback(session);
  }

  const candidate = appState?.returnTo ?? options.returnTo ?? '/';
  const returnTo = isSafeRelativeUrl(candidate) ? candidate : '/';

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

  try {
    if (pathname.endsWith('/login')) {
      return await handleLogin(auth0, request, options.login);
    }
    if (pathname.endsWith('/callback')) {
      return await handleCallback(auth0, request, options.callback);
    }
    if (pathname.endsWith('/logout')) {
      return await handleLogout(auth0, request, options.logout);
    }
    if (pathname.endsWith('/backchannel-logout')) {
      return await handleBackchannelLogout(auth0, request);
    }

    return new Response('Not Found', { status: 404 });
  } catch (err) {
    if (err instanceof Auth0Error) {
      return new Response(err.message, { status: err.statusCode });
    }
    throw err;
  }
}

// ─── stripIdTokenClaims ───────────────────────────────────────────────────────

const STRIP_CLAIMS = new Set(['iss', 'aud', 'exp', 'iat', 'nonce', 'at_hash', 'sid']);

/**
 * Removes standard OIDC metadata fields from a user object.
 *
 * ID token claims (iss, aud, exp, iat, nonce, at_hash, sid) are written into the
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

