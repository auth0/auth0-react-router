import { createElement } from 'react';
import type { ReactNode } from 'react';
import { Auth0Context } from '../client/auth0-context.js';
import type {
  Auth0ContextValue,
  Auth0User,
  BrowserSession,
  TokenSet
} from '../types/index.js';

// ─── Data factories ───────────────────────────────────────────────────────────

/**
 * Returns a fully-typed Auth0User with sensible defaults.
 * Pass overrides to customise individual fields.
 */
export function createMockUser(overrides: Partial<Auth0User> = {}): Auth0User {
  return {
    sub: 'auth0|test-user-id',
    name: 'Test User',
    email: 'test@example.com',
    email_verified: true,
    picture: 'https://example.com/avatar.png',
    ...overrides
  };
}

/**
 * Returns a BrowserSession (user only — no tokens).
 */
export function createMockSession(
  overrides: Partial<BrowserSession> = {}
): BrowserSession {
  return {
    user: createMockUser(),
    ...overrides
  };
}

/**
 * Returns a TokenSet with an access token that expires one hour from now.
 */
export function createMockTokenSet(
  overrides: Partial<TokenSet> = {}
): TokenSet {
  return {
    accessToken: 'mock-access-token',
    scope: 'openid profile email',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides
  };
}

/**
 * Returns a fully-typed Auth0ContextValue with no-op action functions.
 * Pass overrides to replace specific fields.
 */
export function createMockAuth0Context(
  overrides: Partial<Auth0ContextValue> = {}
): Auth0ContextValue {
  const session =
    overrides.session !== undefined
      ? overrides.session
      : overrides.user
        ? { user: overrides.user }
        : createMockSession();

  const user =
    overrides.user !== undefined ? overrides.user : (session?.user ?? null);

  return {
    user,
    session,
    isAuthenticated: overrides.isAuthenticated ?? session !== null,
    isLoading: overrides.isLoading ?? false,
    loginWithRedirect: overrides.loginWithRedirect ?? (() => {}),
    logout: overrides.logout ?? (() => {}),
    getAccessToken:
      overrides.getAccessToken ?? (() => Promise.resolve('mock-access-token'))
  };
}

// ─── Provider wrappers ────────────────────────────────────────────────────────

export interface WithAuthProps {
  children: ReactNode;
  /** Provide a specific user. If omitted, a mock user is used when authenticated. */
  user?: Auth0User | null;
  /** Override the full session object. */
  session?: BrowserSession | null;
  /** Defaults to true when user or session is provided, false otherwise. */
  isAuthenticated?: boolean;
  isLoading?: boolean;
  /** Override any other context values. */
  context?: Partial<Auth0ContextValue>;
}

/**
 * Drop-in replacement for Auth0Provider in tests.
 * Provides a mock Auth0 context without requiring a real session or Router.
 *
 * @example
 * render(
 *   <WithAuth user={{ sub: 'u1', name: 'Alice' }}>
 *     <Profile />
 *   </WithAuth>
 * );
 */
export function WithAuth({
  children,
  user,
  session,
  isAuthenticated,
  isLoading,
  context
}: WithAuthProps) {
  // Only forward props that were explicitly provided — null means "no user/session"
  // and must not be replaced by a default. Omitting a prop lets createMockAuth0Context
  // fill in sensible defaults.
  const overrides: Partial<Auth0ContextValue> = {
    ...(user !== undefined ? { user } : {}),
    ...(session !== undefined ? { session } : {}),
    ...(isAuthenticated !== undefined ? { isAuthenticated } : {}),
    ...(isLoading !== undefined ? { isLoading } : {}),
    ...context
  };
  const value = createMockAuth0Context(overrides);
  return createElement(Auth0Context.Provider, { value }, children);
}

/**
 * Alias for WithAuth. Exists for naming symmetry with Auth0Provider.
 */
export const Auth0ProviderMock = WithAuth;

// ─── Loader / request helpers ─────────────────────────────────────────────────

/**
 * Wraps a route loader with an injected mock session so it can be tested
 * without real cookie parsing.
 *
 * @example
 * const wrappedLoader = createMockLoader(myLoader, { session: createMockSession() });
 * const data = await wrappedLoader({ request: new Request('/dashboard') });
 */
export function createMockLoader<T>(
  loader: (args: {
    request: Request;
    session: BrowserSession | null;
  }) => Promise<T>,
  opts: { session?: BrowserSession | null } = {}
): (args: { request: Request }) => Promise<T> {
  return ({ request }) => loader({ request, session: opts.session ?? null });
}

/**
 * Creates a Request pre-populated with an Authorization: Bearer header.
 * Use this to test API protection routes without a real token.
 *
 * @example
 * const req = createMockBearerRequest('http://localhost/api/data');
 * const claims = await requireClaims(req);
 */
export function createMockBearerRequest(
  url: string,
  opts: { token?: string; init?: RequestInit } = {}
): Request {
  const token = opts.token ?? 'mock-bearer-token';
  const headers = new Headers(opts.init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return new Request(url, { ...opts.init, headers });
}
