// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import {
  createMockUser,
  createMockSession,
  createMockTokenSet,
  createMockAuth0Context,
  WithAuth,
  Auth0ProviderMock,
  createMockLoader,
  createMockBearerRequest
} from '../../src/testing/index.js';
import { useAuth0 } from '../../src/client/use-auth0.js';

afterEach(cleanup);

// ─── createMockUser ───────────────────────────────────────────────────────────

describe('createMockUser', () => {
  it('returns a user with default fields', () => {
    const user = createMockUser();
    expect(user.sub).toBe('auth0|test-user-id');
    expect(user.email).toBe('test@example.com');
    expect(user.email_verified).toBe(true);
  });

  it('applies overrides', () => {
    const user = createMockUser({ sub: 'google|abc', name: 'Bob' });
    expect(user.sub).toBe('google|abc');
    expect(user.name).toBe('Bob');
    expect(user.email).toBe('test@example.com'); // default preserved
  });
});

// ─── createMockSession ────────────────────────────────────────────────────────

describe('createMockSession', () => {
  it('returns a BrowserSession with a mock user', () => {
    const session = createMockSession();
    expect(session.user).toBeDefined();
    expect(session.user.sub).toBe('auth0|test-user-id');
  });

  it('applies overrides', () => {
    const customUser = createMockUser({ sub: 'custom|1' });
    const session = createMockSession({ user: customUser });
    expect(session.user.sub).toBe('custom|1');
  });
});

// ─── createMockTokenSet ───────────────────────────────────────────────────────

describe('createMockTokenSet', () => {
  it('returns a TokenSet with sensible defaults', () => {
    const ts = createMockTokenSet();
    expect(ts.accessToken).toBe('mock-access-token');
    expect(ts.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('applies overrides', () => {
    const ts = createMockTokenSet({ accessToken: 'my-token' });
    expect(ts.accessToken).toBe('my-token');
  });
});

// ─── createMockAuth0Context ───────────────────────────────────────────────────

describe('createMockAuth0Context', () => {
  it('creates an authenticated context by default', () => {
    const ctx = createMockAuth0Context();
    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.user).not.toBeNull();
    expect(ctx.session).not.toBeNull();
  });

  it('creates an unauthenticated context when session is null', () => {
    const ctx = createMockAuth0Context({ session: null });
    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.user).toBeNull();
  });

  it('derives isAuthenticated from session when not provided', () => {
    const session = createMockSession();
    const ctx = createMockAuth0Context({ session });
    expect(ctx.isAuthenticated).toBe(true);
  });

  it('isLoading defaults to false', () => {
    const ctx = createMockAuth0Context();
    expect(ctx.isLoading).toBe(false);
  });

  it('loginWithRedirect and logout are no-op functions by default', () => {
    const ctx = createMockAuth0Context();
    expect(() => ctx.loginWithRedirect()).not.toThrow();
    expect(() => ctx.logout()).not.toThrow();
  });

  it('getAccessToken resolves with a mock token by default', async () => {
    const ctx = createMockAuth0Context();
    await expect(ctx.getAccessToken()).resolves.toBe('mock-access-token');
  });
});

// ─── WithAuth ─────────────────────────────────────────────────────────────────

describe('WithAuth', () => {
  it('provides auth context to children', () => {
    const user = createMockUser({ sub: 'auth0|wrapped' });
    const { result } = renderHook(() => useAuth0(), {
      wrapper: ({ children }) => <WithAuth user={user}>{children}</WithAuth>
    });
    expect(result.current.user?.sub).toBe('auth0|wrapped');
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('supports unauthenticated state', () => {
    const { result } = renderHook(() => useAuth0(), {
      wrapper: ({ children }) => (
        <WithAuth session={null} isAuthenticated={false}>
          {children}
        </WithAuth>
      )
    });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('renders children', () => {
    render(
      <WithAuth>
        <span>child content</span>
      </WithAuth>
    );
    expect(screen.getByText('child content')).toBeDefined();
  });
});

// ─── Auth0ProviderMock ────────────────────────────────────────────────────────

describe('Auth0ProviderMock', () => {
  it('is an alias for WithAuth', () => {
    expect(Auth0ProviderMock).toBe(WithAuth);
  });
});

// ─── createMockLoader ─────────────────────────────────────────────────────────

describe('createMockLoader', () => {
  it('passes the injected session to the loader', async () => {
    const session = createMockSession();
    const loader = createMockLoader(
      async ({ session: s }) => ({ user: s?.user ?? null }),
      { session }
    );
    const result = await loader({ request: new Request('http://localhost/') });
    expect((result as { user: unknown }).user).toEqual(session.user);
  });

  it('passes null session when none is provided', async () => {
    const loader = createMockLoader(async ({ session }) => ({ session }));
    const result = await loader({ request: new Request('http://localhost/') });
    expect((result as { session: unknown }).session).toBeNull();
  });
});

// ─── createMockBearerRequest ──────────────────────────────────────────────────

describe('createMockBearerRequest', () => {
  it('creates a Request with an Authorization Bearer header', () => {
    const req = createMockBearerRequest('http://localhost/api');
    expect(req.headers.get('Authorization')).toBe('Bearer mock-bearer-token');
  });

  it('uses a custom token when provided', () => {
    const req = createMockBearerRequest('http://localhost/api', {
      token: 'custom-token'
    });
    expect(req.headers.get('Authorization')).toBe('Bearer custom-token');
  });

  it('preserves additional headers', () => {
    const req = createMockBearerRequest('http://localhost/api', {
      init: { headers: { 'X-Tenant': 'acme' } }
    });
    expect(req.headers.get('X-Tenant')).toBe('acme');
    expect(req.headers.get('Authorization')).toBe('Bearer mock-bearer-token');
  });
});
