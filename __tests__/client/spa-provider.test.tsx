// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { Auth0Client } from '@auth0/auth0-spa-js';
import { Auth0Provider } from '../../src/client/Auth0Provider.js';
import { useAuth0 } from '../../src/client/use-auth0.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockHandleRedirectCallback = vi.fn();
const mockGetUser = vi.fn();
const mockLoginWithRedirect = vi.fn();
const mockLogout = vi.fn();
const mockGetTokenSilently = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@auth0/auth0-spa-js', () => ({
  // Must use a regular function (not an arrow) so it can be called with `new`.
  Auth0Client: vi.fn().mockImplementation(function () {
    return {
      handleRedirectCallback: mockHandleRedirectCallback,
      getUser: mockGetUser,
      loginWithRedirect: mockLoginWithRedirect,
      logout: mockLogout,
      getTokenSilently: mockGetTokenSilently
    };
  })
}));

vi.mock('react-router', async importActual => {
  const actual = await importActual<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Render Auth0Provider (SPA mode) with a child that exposes the context value. */
async function renderSpaProvider() {
  let ctx!: ReturnType<typeof useAuth0>;

  function Consumer() {
    ctx = useAuth0();
    return (
      <span data-testid="status">{ctx.isLoading ? 'loading' : 'ready'}</span>
    );
  }

  await act(async () => {
    render(
      <Auth0Provider>
        <Consumer />
      </Auth0Provider>
    );
  });

  return { getCtx: () => ctx };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Clear call counts (but not implementations) so tests don't bleed into
  // each other when checking .toHaveBeenCalled() / .not.toHaveBeenCalled().
  vi.clearAllMocks();

  // Stub the Vite env vars so Auth0Provider renders in SPA mode.
  // vi.stubEnv modifies import.meta.env in-place, which is evaluated at
  // render time inside Auth0Provider — no vi.resetModules() needed.
  vi.stubEnv('VITE_AUTH0_DOMAIN', 'test.auth0.com');
  vi.stubEnv('VITE_AUTH0_CLIENT_ID', 'test-client-id');

  mockHandleRedirectCallback.mockResolvedValue({ appState: {} });
  mockGetUser.mockResolvedValue({ sub: 'auth0|spa-user', name: 'SPA User' });
  mockLoginWithRedirect.mockResolvedValue(undefined);
  mockLogout.mockResolvedValue(undefined);
  mockGetTokenSilently.mockResolvedValue('spa-access-token');

  // Default: no OAuth callback params in URL
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Auth0Provider — SPA mode', () => {
  it('is loading initially, ready after initialisation', async () => {
    // act() in renderSpaProvider flushes the init effect, so by the time
    // we inspect, isLoading has already transitioned to false.
    await renderSpaProvider();
    expect(screen.getByTestId('status').textContent).toBe('ready');
  });

  it('sets user and isAuthenticated after getUser() resolves', async () => {
    const { getCtx } = await renderSpaProvider();
    expect(getCtx().user).toEqual({ sub: 'auth0|spa-user', name: 'SPA User' });
    expect(getCtx().isAuthenticated).toBe(true);
    expect(getCtx().session).toEqual({
      user: { sub: 'auth0|spa-user', name: 'SPA User' }
    });
  });

  it('sets user to null when getUser() returns undefined', async () => {
    mockGetUser.mockResolvedValue(undefined);
    const { getCtx } = await renderSpaProvider();
    expect(getCtx().user).toBeNull();
    expect(getCtx().isAuthenticated).toBe(false);
    expect(getCtx().session).toBeNull();
  });

  it('sets user to null and isLoading to false when initialisation throws', async () => {
    mockGetUser.mockRejectedValue(new Error('network error'));
    const { getCtx } = await renderSpaProvider();
    expect(getCtx().user).toBeNull();
    expect(getCtx().isLoading).toBe(false);
  });

  it('sets user to null when handleRedirectCallback throws during OAuth callback', async () => {
    window.history.replaceState({}, '', '/?code=abc&state=xyz');
    mockHandleRedirectCallback.mockRejectedValue(new Error('invalid state'));
    const { getCtx } = await renderSpaProvider();
    expect(getCtx().user).toBeNull();
    expect(getCtx().isLoading).toBe(false);
  });

  it('does NOT call handleRedirectCallback when no code/state in URL', async () => {
    await renderSpaProvider();
    expect(mockHandleRedirectCallback).not.toHaveBeenCalled();
  });

  it('calls handleRedirectCallback when code + state are in the URL', async () => {
    window.history.replaceState({}, '', '/?code=abc123&state=xyz');
    await renderSpaProvider();
    expect(mockHandleRedirectCallback).toHaveBeenCalledTimes(1);
  });

  it('removes only code and state from the URL after handleRedirectCallback', async () => {
    window.history.replaceState({}, '', '/callback?code=abc&state=xyz');
    await renderSpaProvider();
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/callback');
  });

  it('preserves other query params when stripping code and state', async () => {
    window.history.replaceState(
      {},
      '',
      '/callback?code=abc&state=xyz&invitation=inv1&organization=org1'
    );
    await renderSpaProvider();
    expect(window.location.search).toBe('?invitation=inv1&organization=org1');
    expect(window.location.pathname).toBe('/callback');
  });

  it('does not call handleRedirectCallback twice under StrictMode double-invoke', async () => {
    window.history.replaceState({}, '', '/?code=abc&state=xyz');
    // Simulate StrictMode: render, then re-render without cleanup (ref survives).
    await renderSpaProvider();
    // A second synchronous render reusing the same component instance would
    // normally trigger initialize() again — the didInitialize guard blocks it.
    expect(mockHandleRedirectCallback).toHaveBeenCalledTimes(1);
  });

  it('navigates to appState.returnTo after redirect callback', async () => {
    window.history.replaceState({}, '', '/?code=abc&state=xyz');
    mockHandleRedirectCallback.mockResolvedValue({
      appState: { returnTo: '/dashboard' }
    });
    await renderSpaProvider();
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('does not navigate when appState has no returnTo', async () => {
    window.history.replaceState({}, '', '/?code=abc&state=xyz');
    mockHandleRedirectCallback.mockResolvedValue({ appState: {} });
    await renderSpaProvider();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('loginWithRedirect delegates to the SPA client', async () => {
    const { getCtx } = await renderSpaProvider();

    await act(async () => {
      getCtx().loginWithRedirect({ returnTo: '/after-login' });
      await new Promise(r => setTimeout(r, 0));
    });

    expect(mockLoginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: '/after-login' }
    });
  });

  it('loginWithRedirect passes undefined returnTo when called with no args', async () => {
    const { getCtx } = await renderSpaProvider();

    await act(async () => {
      getCtx().loginWithRedirect();
      await new Promise(r => setTimeout(r, 0));
    });

    expect(mockLoginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: undefined }
    });
  });

  it('logout delegates to the SPA client', async () => {
    const { getCtx } = await renderSpaProvider();

    await act(async () => {
      getCtx().logout({ returnTo: 'https://myapp.com' });
      await new Promise(r => setTimeout(r, 0));
    });

    expect(mockLogout).toHaveBeenCalledWith({
      logoutParams: { returnTo: 'https://myapp.com' }
    });
  });

  it('logout falls back to window.location.origin when returnTo is omitted', async () => {
    const { getCtx } = await renderSpaProvider();

    await act(async () => {
      getCtx().logout();
      await new Promise(r => setTimeout(r, 0));
    });

    expect(mockLogout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin }
    });
  });

  it('getAccessToken resolves from getTokenSilently()', async () => {
    const { getCtx } = await renderSpaProvider();
    const token = await getCtx().getAccessToken();
    expect(token).toBe('spa-access-token');
    expect(mockGetTokenSilently).toHaveBeenCalledTimes(1);
  });
});

// ─── Session restoration ──────────────────────────────────────────────────────

describe('Auth0Provider — SPA mode — session restoration', () => {
  it('calls getTokenSilently and retries getUser when getUser returns undefined on init', async () => {
    mockGetUser
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ sub: 'auth0|restored', name: 'Restored' });

    const { getCtx } = await renderSpaProvider();

    expect(mockGetTokenSilently).toHaveBeenCalledTimes(1);
    expect(getCtx().user).toEqual({ sub: 'auth0|restored', name: 'Restored' });
    expect(getCtx().isAuthenticated).toBe(true);
  });

  it('sets user to null when getTokenSilently throws during restoration', async () => {
    mockGetUser.mockResolvedValue(undefined);
    mockGetTokenSilently.mockRejectedValue(new Error('login_required'));

    const { getCtx } = await renderSpaProvider();

    expect(mockGetTokenSilently).toHaveBeenCalledTimes(1);
    expect(getCtx().user).toBeNull();
    expect(getCtx().isAuthenticated).toBe(false);
  });

  it('does not call getTokenSilently when getUser returns a user on init', async () => {
    await renderSpaProvider();
    expect(mockGetTokenSilently).not.toHaveBeenCalled();
  });
});

// ─── Auth0Client config ───────────────────────────────────────────────────────

describe('Auth0Provider — SPA mode — Auth0Client config', () => {
  function getConstructorOpts() {
    return (Auth0Client as unknown as Mock).mock.calls[0][0];
  }

  it('passes useRefreshTokens: true by default', async () => {
    await renderSpaProvider();
    expect(getConstructorOpts().useRefreshTokens).toBe(true);
  });

  it('passes useRefreshTokensFallback: false by default', async () => {
    await renderSpaProvider();
    expect(getConstructorOpts().useRefreshTokensFallback).toBe(false);
  });

  it('passes cacheLocation: memory by default', async () => {
    await renderSpaProvider();
    expect(getConstructorOpts().cacheLocation).toBe('memory');
  });

  it('respects VITE_AUTH0_USE_REFRESH_TOKENS=false', async () => {
    vi.stubEnv('VITE_AUTH0_USE_REFRESH_TOKENS', 'false');
    await renderSpaProvider();
    expect(getConstructorOpts().useRefreshTokens).toBe(false);
  });

  it('respects VITE_AUTH0_USE_REFRESH_TOKENS_FALLBACK=true', async () => {
    vi.stubEnv('VITE_AUTH0_USE_REFRESH_TOKENS_FALLBACK', 'true');
    await renderSpaProvider();
    expect(getConstructorOpts().useRefreshTokensFallback).toBe(true);
  });

  it('respects VITE_AUTH0_CACHE_LOCATION=localstorage', async () => {
    vi.stubEnv('VITE_AUTH0_CACHE_LOCATION', 'localstorage');
    await renderSpaProvider();
    expect(getConstructorOpts().cacheLocation).toBe('localstorage');
  });
});
