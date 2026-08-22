import type {
  StateData,
  SessionData,
  TokenSet as UpstreamTokenSet
} from '@auth0/auth0-server-js';
import type {
  Auth0Session,
  Auth0User,
  BrowserSession,
  TokenSet
} from '../types/index.js';
import { MissingSessionError, TokenError } from '../errors/index.js';
import { Auth0Server } from './auth0-server.js';

// ─── Request-scoped cookie jar ────────────────────────────────────────────────
//
// When auth0Middleware is active it creates a single Response per request that
// all server utilities share as their cookie jar. After the downstream handlers
// run, the middleware drains any Set-Cookie headers (e.g. from silent token
// refresh or session rolling) and appends them to the final response so they
// reach the browser without extra work in individual loaders.

const requestCookieJars = new WeakMap<Request, Response>();

/**
 * Initialises a per-request cookie jar. Called by auth0Middleware before the
 * downstream handler chain runs.
 * @internal
 */
export function _initRequestCookieJar(request: Request): void {
  requestCookieJars.set(request, new Response());
}

/**
 * Returns all Set-Cookie values accumulated in the per-request jar and removes
 * the jar from the map. Called by auth0Middleware after the downstream chain
 * completes.
 * @internal
 */
export function _drainRequestCookieJar(request: Request): string[] {
  const jar = requestCookieJars.get(request);
  requestCookieJars.delete(request);
  return jar?.headers.getSetCookie() ?? [];
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: Auth0Server | undefined;

export function getInstance(): Auth0Server {
  if (!_instance) _instance = new Auth0Server();
  return _instance;
}

/**
 * Override the shared Auth0Server instance.
 * @internal — use only in tests via _setAuth0Instance / _setAuth0Instance(undefined)
 */
export function _setAuth0Instance(instance: Auth0Server | undefined): void {
  _instance = instance;
}

/**
 * Registers your Auth0Server instance as the singleton used by standalone
 * helpers (getSession, requireSession, getAccessToken, updateSession,
 * deleteSession, etc.).
 *
 * Call this once at app startup, after constructing your Auth0Server instance,
 * so that hooks registered on it (onCallback, beforeSessionSaved) are honoured
 * during token refresh and session writes triggered by the standalone helpers.
 *
 * @example
 * // auth0.server.ts
 * export const auth0 = new Auth0Server({ onCallback, beforeSessionSaved });
 * registerAuth0Instance(auth0);
 */
export function registerAuth0Instance(instance: Auth0Server): void {
  _instance = instance;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps the upstream SessionData shape to our Auth0Session type.
 * Falls back to the configured domain when the session does not carry one.
 */
function toAuth0Session(data: SessionData, domain: string): Auth0Session {
  return {
    user: data.user as Auth0User,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    tokenSets: data.tokenSets as TokenSet[],
    domain: data.domain ?? domain
  };
}

// ─── Option types ─────────────────────────────────────────────────────────────

export interface RequireSessionOptions {
  /**
   * URL to send the user to after a successful login.
   * Defaults to the current request pathname.
   */
  returnTo?: string;
}

export interface CreateApiClientOptions {
  /**
   * Base URL prepended to every path passed to the client.
   * When omitted the path is used as-is.
   */
  baseUrl?: string;
}

// ─── Session reads ────────────────────────────────────────────────────────────

/**
 * Returns the decrypted server-side session, or null when the visitor is
 * unauthenticated or the session cookie is absent / expired.
 *
 * The returned value contains tokens and is safe to use server-side only.
 * Never include it in loader data returned to the browser.
 */
export async function getSession(
  request: Request
): Promise<Auth0Session | null> {
  const auth0 = getInstance();
  const cookieJar = requestCookieJars.get(request) ?? new Response();
  const storeOptions = { request, response: cookieJar };

  const data = await auth0.serverClient.getSession(storeOptions);
  if (!data?.user) return null;

  return toAuth0Session(data, auth0.config.domain);
}

/**
 * Like getSession, but throws a 302 redirect to the login page when there is
 * no active session. React Router catches the thrown Response automatically.
 *
 * @throws {Response} 302 redirect to the login path
 */
export async function requireSession(
  request: Request,
  opts?: RequireSessionOptions
): Promise<Auth0Session> {
  const session = await getSession(request);

  if (!session) {
    const { pathname, search } = new URL(request.url);
    const returnTo = opts?.returnTo ?? pathname + search;
    const loginPath = process.env['AUTH0_LOGIN_PATH'] ?? '/auth/login';
    // Use a dummy base so URL can parse relative loginPath values.
    // searchParams.set handles the case where loginPath already has a query string.
    const loginUrl = new URL(loginPath, 'http://x');
    loginUrl.searchParams.set('returnTo', returnTo);
    throw new Response(null, {
      status: 302,
      headers: { Location: loginUrl.pathname + loginUrl.search }
    });
  }

  return session;
}

/**
 * Returns the authenticated user, or null when the visitor is unauthenticated.
 */
export async function getUser(request: Request): Promise<Auth0User | null> {
  const session = await getSession(request);
  return session?.user ?? null;
}

/**
 * Like getUser, but throws a 302 redirect to the login page when there is no
 * active session. React Router catches the thrown Response automatically.
 *
 * @throws {Response} 302 redirect to the login path
 */
export async function requireUser(
  request: Request,
  opts?: RequireSessionOptions
): Promise<Auth0User> {
  const session = await requireSession(request, opts);
  return session.user;
}

// ─── Access token ─────────────────────────────────────────────────────────────

/**
 * Deduplication map: when multiple loaders call getAccessToken with the same
 * request object in parallel, only one token request is made.
 */
const accessTokenCache = new WeakMap<Request, Promise<string>>();

/**
 * Returns a valid access token for the current user.
 *
 * If the token is expired, it is silently refreshed using the refresh token.
 * Parallel calls within the same request share a single refresh operation.
 *
 * **Token refresh prerequisites** — silent refresh only works when all three of
 * the following are configured:
 *
 * 1. `AUTH0_SCOPE` (or the `scope` constructor option) includes `offline_access`.
 * 2. The Auth0 application has **Allow Offline Access** enabled
 *    (Dashboard → Applications → [your app] → Settings → scroll to "Refresh Token").
 * 3. The **Refresh Token** grant is enabled on the same settings page.
 *
 * If a refresh token is absent, `getAccessToken` throws a `TokenError`. The error
 * message will indicate that no refresh token is available.
 *
 * **Handling an expired refresh token** — when the refresh token itself has
 * expired or been revoked, `getAccessToken` throws a `TokenError`. The session
 * cookie is still present in the browser but the tokens inside are no longer
 * usable. Clear the stale session and redirect the user to login:
 *
 * @example
 * import { getAccessToken, deleteSession } from '@auth0/auth0-react-router/server';
 * import { TokenError } from '@auth0/auth0-react-router/errors';
 * import { redirect } from 'react-router';
 *
 * export const loader = async ({ request }) => {
 *   let token: string;
 *   try {
 *     token = await getAccessToken(request);
 *   } catch (err) {
 *     if (err instanceof TokenError) {
 *       const response = await deleteSession(request);
 *       throw redirect('/auth/login', { headers: response.headers });
 *     }
 *     throw err;
 *   }
 *   // use token to call your API...
 * };
 *
 * Note: when a refresh occurs, the updated session cookie is written internally
 * but is not automatically propagated to the browser response. Mount
 * `auth0Middleware` on the root route to have the refreshed cookie forwarded
 * automatically. Without middleware, the token is still returned correctly but
 * the refresh will repeat on every request until the session is explicitly
 * persisted.
 *
 * @throws {TokenError} When no session exists or the token cannot be retrieved.
 */
export async function getAccessToken(request: Request): Promise<string> {
  const cached = accessTokenCache.get(request);
  if (cached) return cached;

  const auth0 = getInstance();
  const cookieJar = requestCookieJars.get(request) ?? new Response();
  const storeOptions = { request, response: cookieJar };

  const promise = auth0.serverClient
    .getAccessToken(storeOptions)
    .then(tokenSet => tokenSet.accessToken)
    .catch(err => {
      accessTokenCache.delete(request);
      throw new TokenError(
        err instanceof Error ? err.message : 'Failed to retrieve access token'
      );
    });

  accessTokenCache.set(request, promise);
  return promise;
}

// ─── Session writes ───────────────────────────────────────────────────────────

/**
 * Merges updates into the current session and returns a Response whose
 * Set-Cookie headers contain the updated encrypted session.
 *
 * Typical usage — return the result directly from a React Router action:
 * @example
 * return updateSession(request, { user: { ...user, name: 'New Name' } });
 *
 * @throws {MissingSessionError} When there is no active session to update.
 */
export async function updateSession(
  request: Request,
  updates: Partial<Auth0Session>
): Promise<Response> {
  const auth0 = getInstance();
  const cookieJar = new Response();
  const storeOptions = { request, response: cookieJar };

  const current = await auth0.stateStore.get(
    auth0.stateIdentifier,
    storeOptions
  );
  if (!current) {
    throw new MissingSessionError(
      'Cannot update session: no active session found.'
    );
  }

  const updated: StateData = {
    ...current,
    ...(updates.user !== undefined ? { user: updates.user } : {}),
    ...(updates.idToken !== undefined ? { idToken: updates.idToken } : {}),
    ...(updates.refreshToken !== undefined
      ? { refreshToken: updates.refreshToken }
      : {}),
    ...(updates.tokenSets !== undefined
      ? { tokenSets: updates.tokenSets as UpstreamTokenSet[] }
      : {}),
    ...(updates.domain !== undefined ? { domain: updates.domain } : {})
  };

  await auth0.stateStore.set(
    auth0.stateIdentifier,
    updated,
    false,
    storeOptions
  );

  return cookieJar;
}

/**
 * Clears the local session cookie without redirecting to Auth0.
 *
 * Returns a Response whose Set-Cookie headers expire the session cookie.
 * The user's Auth0 SSO session is NOT terminated — use handleLogout for that.
 *
 * **Important:** always redirect to a public page after calling `deleteSession`.
 * If you call it from a protected route's action (one guarded by `requireSession`
 * or `defineRouteAuth`), React Router will re-run the loader after the action
 * completes. The loader will redirect to `/auth/login?returnTo=/page.data`
 * because the session is now gone. Return a redirect to a public page instead:
 *
 * @example
 * export const action = async ({ request }) => {
 *   const response = await deleteSession(request);
 *   // Redirect to a public page — do NOT return the bare deleteSession response
 *   // from a protected route or the loader will redirect to /auth/login?returnTo=/page.data
 *   return redirect('/', { headers: response.headers });
 * };
 */
export async function deleteSession(request: Request): Promise<Response> {
  const auth0 = getInstance();
  const cookieJar = new Response();
  const storeOptions = { request, response: cookieJar };

  await auth0.stateStore.delete(auth0.stateIdentifier, storeOptions);

  return cookieJar;
}

// ─── API client ───────────────────────────────────────────────────────────────

/**
 * Returns an authenticated fetch wrapper that attaches a Bearer token to
 * every request. The token is resolved lazily on the first call.
 *
 * @example
 * const api = createApiClient(request, { baseUrl: 'https://api.example.com' });
 * const data = await api('/users').then(r => r.json());
 */
export function createApiClient(
  request: Request,
  opts?: CreateApiClientOptions
): (path: string, init?: RequestInit) => Promise<Response> {
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const token = await getAccessToken(request);
    const url = opts?.baseUrl ? new URL(path, opts.baseUrl).toString() : path;

    // Normalise to a Headers instance so plain objects, Headers instances,
    // and [string, string][] arrays are all handled correctly.
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);

    return fetch(url, { ...init, headers });
  };
}

// ─── Browser-safe session ─────────────────────────────────────────────────────

/**
 * Extracts only the browser-safe portion of a session.
 * Strips tokens before any data leaves the server.
 * @internal — used by rootAuthLoader
 */
export function toBrowserSession(session: Auth0Session): BrowserSession {
  return { user: session.user };
}
