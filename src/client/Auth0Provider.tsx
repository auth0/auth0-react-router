import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useRouteLoaderData } from 'react-router';
import { Auth0Context } from './auth0-context.js';
import type {
  Auth0ContextValue,
  Auth0User,
  BrowserSession
} from '../types/index.js';

export interface Auth0ProviderProps {
  children: ReactNode;
}

// ─── SSR mode ─────────────────────────────────────────────────────────────────

/**
 * Auth0Provider implementation for SSR mode.
 * Reads the session from the root loader — no network calls in the browser.
 */
function SsrAuth0Provider({ children }: Auth0ProviderProps) {
  // rootAuthLoader must be the loader for the 'root' route.
  // The session key holds { user } — no tokens.
  const rootData = useRouteLoaderData('root') as
    { session: BrowserSession | null } | undefined;

  const session = rootData?.session ?? null;
  const user = session?.user ?? null;

  // Full page navigation — must not use React Router's navigate() because:
  // 1. The /auth/login loader returns a 302 redirect to Auth0 (external URL).
  // 2. It sets a transaction cookie via Set-Cookie that client-side fetch ignores.
  // window.location.href forces a real browser request so cookies and redirects
  // are handled correctly by the browser.
  const loginWithRedirect = useCallback(
    ({ returnTo }: { returnTo?: string } = {}) => {
      window.location.href = returnTo
        ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
        : '/auth/login';
    },
    []
  );

  // Programmatic form POST — logout must be POST (GET logout can be triggered
  // by third-party image tags or links, silently logging users out).
  // A real form submission ensures the browser follows the 302 to Auth0's
  // /v2/logout and processes the Set-Cookie that clears the session.
  const logout = useCallback(
    ({ returnTo }: { returnTo?: string } = {}) => {
      const form = document.createElement('form');
      form.method = 'post';
      form.action = returnTo
        ? `/auth/logout?returnTo=${encodeURIComponent(returnTo)}`
        : '/auth/logout';
      document.body.appendChild(form);
      form.submit();
    },
    []
  );

  // Not available in SSR mode. Deferred to Phase 2 (Token Mediating).
  const getAccessToken = useCallback(async () => {
    throw new Error(
      'getAccessToken() is not available in SSR mode. ' +
        'Use SPA mode for client-side token access (Phase 2).'
    );
  }, []);

  const value = useMemo<Auth0ContextValue>(
    () => ({
      user,
      session,
      isAuthenticated: session !== null,
      isLoading: false, // always false in SSR mode — state comes from the server
      loginWithRedirect,
      logout,
      getAccessToken
    }),
    [user, session, loginWithRedirect, logout, getAccessToken]
  );

  return (
    <Auth0Context.Provider value={value}>{children}</Auth0Context.Provider>
  );
}

// ─── SPA mode ─────────────────────────────────────────────────────────────────

// Minimal interface covering the @auth0/auth0-spa-js methods this provider uses.
// Defined locally so SSR-only users who have not installed @auth0/auth0-spa-js
// don't get TypeScript errors when the package is absent.
interface SpaClient {
  handleRedirectCallback(): Promise<{ appState?: { returnTo?: string } }>;
  getUser<T = Auth0User>(): Promise<T | undefined>;
  loginWithRedirect(opts?: { appState?: { returnTo?: string } }): Promise<void>;
  logout(opts?: { logoutParams?: { returnTo?: string } }): Promise<void>;
  getTokenSilently(): Promise<string>;
}

/**
 * Auth0Provider implementation for SPA mode.
 * Wraps @auth0/auth0-spa-js and manages the browser PKCE flow.
 * The library is loaded via dynamic import so SSR-only users who have not
 * installed @auth0/auth0-spa-js are unaffected.
 */
function SpaAuth0Provider({ children }: Auth0ProviderProps) {
  const navigate = useNavigate();
  const [user, setUser] = useState<Auth0User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Holds a Promise rather than the resolved client so that concurrent callers
  // all await the same in-flight import and only one Auth0Client is ever created.
  const clientPromiseRef = useRef<Promise<SpaClient> | null>(null);
  const didInitialize = useRef(false);

  // Stable across renders — clientPromiseRef is a ref, never changes identity.
  const ensureClient = useCallback((): Promise<SpaClient> => {
    if (!clientPromiseRef.current) {
      clientPromiseRef.current = import('@auth0/auth0-spa-js').then(
        ({ Auth0Client }) =>
          new Auth0Client({
            domain: import.meta.env.VITE_AUTH0_DOMAIN as string,
            clientId: import.meta.env.VITE_AUTH0_CLIENT_ID as string,
            useRefreshTokens: import.meta.env.VITE_AUTH0_USE_REFRESH_TOKENS !== 'false',
            useRefreshTokensFallback: import.meta.env.VITE_AUTH0_USE_REFRESH_TOKENS_FALLBACK === 'true',
            cacheLocation: (import.meta.env.VITE_AUTH0_CACHE_LOCATION as 'memory' | 'localstorage') ?? 'memory',
            authorizationParams: {
              redirect_uri:
                import.meta.env.VITE_AUTH0_REDIRECT_URI ??
                window.location.origin,
              ...(import.meta.env.VITE_AUTH0_AUDIENCE && {
                audience: import.meta.env.VITE_AUTH0_AUDIENCE
              }),
              scope: import.meta.env.VITE_AUTH0_SCOPE ?? 'openid profile email'
            }
          }) as SpaClient
      );
    }
    return clientPromiseRef.current;
  }, []);

  useEffect(() => {
    // Guard against React 18 StrictMode's double-invoke. Without this, both
    // invocations call handleRedirectCallback(), the second finds the PKCE
    // transaction already consumed and throws, then setUser(null) can win the
    // race over setUser(user) and the UI shows logged-out despite a successful
    // token exchange.
    if (didInitialize.current) return;
    didInitialize.current = true;

    const initialize = async () => {
      const client = await ensureClient();
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has('code') && url.searchParams.has('state')) {
          // Exchange the authorization code for tokens, then remove only the
          // OAuth params from the address bar — preserving any other query
          // params the app or Auth0 may have included (org, invitation, UTM…).
          const { appState } = await client.handleRedirectCallback();
          url.searchParams.delete('code');
          url.searchParams.delete('state');
          window.history.replaceState(
            {},
            '',
            url.pathname + url.search + url.hash
          );
          if (appState?.returnTo) {
            navigate(appState.returnTo, { replace: true });
          }
        }
        let u = await client.getUser<Auth0User>();
        if (!u) {
          // On page refresh the in-memory cache is empty. getTokenSilently()
          // uses the stored refresh token to silently re-authenticate and
          // repopulate the cache. If useRefreshTokensFallback is enabled it
          // will also fall back to Auth0's SSO session (silent iframe).
          try {
            await client.getTokenSilently();
            u = await client.getUser<Auth0User>();
          } catch {
            u = undefined;
          }
        }
        setUser(u ?? null);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    initialize();
  }, []); // runs once on mount

  const loginWithRedirect = useCallback(
    ({ returnTo }: { returnTo?: string } = {}) => {
      ensureClient()
        .then(client => client.loginWithRedirect({ appState: { returnTo } }))
        .catch(err =>
          console.error('[auth0-react-router] loginWithRedirect failed', err)
        );
    },
    [ensureClient]
  );

  const logout = useCallback(
    ({ returnTo }: { returnTo?: string } = {}) => {
      ensureClient()
        .then(client =>
          client.logout({
            logoutParams: { returnTo: returnTo ?? window.location.origin }
          })
        )
        .catch(err => console.error('[auth0-react-router] logout failed', err));
    },
    [ensureClient]
  );

  const getAccessToken = useCallback(async () => {
    const client = await ensureClient();
    return client.getTokenSilently();
  }, [ensureClient]);

  const session = useMemo(() => (user ? { user } : null), [user]);

  const value = useMemo<Auth0ContextValue>(
    () => ({
      user,
      session,
      isAuthenticated: user !== null,
      isLoading,
      loginWithRedirect,
      logout,
      getAccessToken
    }),
    [user, session, isLoading, loginWithRedirect, logout, getAccessToken]
  );

  return (
    <Auth0Context.Provider value={value}>{children}</Auth0Context.Provider>
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Provides Auth0 authentication state to the component tree.
 *
 * **SSR mode** (default): reads the session from the root loader via
 * `useRouteLoaderData('root')`. No network calls are made in the browser —
 * all auth state comes from the server-side session set by `rootAuthLoader`.
 *
 * **SPA mode**: activated automatically when `VITE_AUTH0_DOMAIN` and
 * `VITE_AUTH0_CLIENT_ID` are defined in the consumer's Vite environment.
 * Wraps `@auth0/auth0-spa-js` and manages the full browser PKCE flow.
 * Requires `@auth0/auth0-spa-js` to be installed as a peer dependency.
 *
 * Place this inside your root layout, after the React Router outlet:
 * @example
 * // app/root.tsx
 * export default function Root() {
 *   return (
 *     <Auth0Provider>
 *       <Outlet />
 *     </Auth0Provider>
 *   );
 * }
 */
export function Auth0Provider({ children }: Auth0ProviderProps) {
  // Evaluated at render time rather than at module-evaluation time so that
  // vi.stubEnv() can control the mode in tests without vi.resetModules().
  // (Vite inlines import.meta.env.VITE_* at the consumer's build time
  // regardless of where they appear in source, not just at the module top.)
  const isSpa = Boolean(
    (import.meta.env.VITE_AUTH0_DOMAIN as string | undefined) &&
    (import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined)
  );
  return isSpa ? (
    <SpaAuth0Provider>{children}</SpaAuth0Provider>
  ) : (
    <SsrAuth0Provider>{children}</SsrAuth0Provider>
  );
}
