// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useAuth0 } from '../../src/client/use-auth0.js';
import { useUser } from '../../src/client/use-user.js';
import { useSession } from '../../src/client/use-session.js';
import {
  WithAuth,
  createMockUser,
  createMockSession
} from '../../src/testing/index.js';

afterEach(cleanup);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  return <WithAuth>{children}</WithAuth>;
}

function unauthWrapper({ children }: { children: ReactNode }) {
  return (
    <WithAuth session={null} isAuthenticated={false}>
      {children}
    </WithAuth>
  );
}

// ─── useAuth0 ─────────────────────────────────────────────────────────────────

describe('useAuth0', () => {
  it('throws a helpful error when called outside Auth0Provider', () => {
    expect(() => renderHook(() => useAuth0())).toThrow(
      'useAuth0() was called outside of <Auth0Provider>'
    );
  });

  it('returns the context value when inside Auth0Provider', () => {
    const { result } = renderHook(() => useAuth0(), { wrapper });
    expect(result.current).toHaveProperty('user');
    expect(result.current).toHaveProperty('isAuthenticated');
    expect(result.current).toHaveProperty('loginWithRedirect');
    expect(result.current).toHaveProperty('logout');
  });

  it('reflects authenticated state', () => {
    const user = createMockUser({ sub: 'auth0|abc' });
    const { result } = renderHook(() => useAuth0(), {
      wrapper: ({ children }) => <WithAuth user={user}>{children}</WithAuth>
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.sub).toBe('auth0|abc');
  });

  it('reflects unauthenticated state', () => {
    const { result } = renderHook(() => useAuth0(), { wrapper: unauthWrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it('isLoading is false in SSR mode', () => {
    const { result } = renderHook(() => useAuth0(), { wrapper });
    expect(result.current.isLoading).toBe(false);
  });

  it('getAccessToken resolves with a mock token by default', async () => {
    const { result } = renderHook(() => useAuth0(), { wrapper });
    await expect(result.current.getAccessToken()).resolves.toBe(
      'mock-access-token'
    );
  });
});

// ─── useUser ──────────────────────────────────────────────────────────────────

describe('useUser', () => {
  it('returns null when not authenticated', () => {
    const { result } = renderHook(() => useUser(), { wrapper: unauthWrapper });
    expect(result.current).toBeNull();
  });

  it('returns the user when authenticated', () => {
    const user = createMockUser({ sub: 'auth0|xyz', email: 'alice@test.com' });
    const { result } = renderHook(() => useUser(), {
      wrapper: ({ children }) => <WithAuth user={user}>{children}</WithAuth>
    });
    expect(result.current?.sub).toBe('auth0|xyz');
    expect(result.current?.email).toBe('alice@test.com');
  });
});

// ─── useSession ───────────────────────────────────────────────────────────────

describe('useSession', () => {
  it('returns the full session state', () => {
    const session = createMockSession();
    const { result } = renderHook(() => useSession(), {
      wrapper: ({ children }) => (
        <WithAuth session={session}>{children}</WithAuth>
      )
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.session).toEqual(session);
    expect(result.current.user).toEqual(session.user);
  });

  it('returns null session when unauthenticated', () => {
    const { result } = renderHook(() => useSession(), {
      wrapper: unauthWrapper
    });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.session).toBeNull();
    expect(result.current.user).toBeNull();
  });
});
