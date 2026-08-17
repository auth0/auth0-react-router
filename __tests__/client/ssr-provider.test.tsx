// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Auth0Provider } from '../../src/client/Auth0Provider.js';
import { useAuth0 } from '../../src/client/use-auth0.js';
import { createMockUser } from '../../src/testing/index.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRouteLoaderData = vi.fn();

vi.mock('react-router', async importActual => {
  const actual = await importActual<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useRouteLoaderData: () => mockRouteLoaderData()
  };
});

vi.mock('@auth0/auth0-spa-js', () => ({ Auth0Client: vi.fn() }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_USER = createMockUser();

function renderSsrProvider(
  session: { user: ReturnType<typeof createMockUser> } | null = {
    user: MOCK_USER
  }
) {
  mockRouteLoaderData.mockReturnValue({ session });

  let ctx!: ReturnType<typeof useAuth0>;

  function Consumer() {
    ctx = useAuth0();
    return null;
  }

  render(
    <Auth0Provider>
      <Consumer />
    </Auth0Provider>
  );

  return { getCtx: () => ctx };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

// ─── loginWithRedirect ────────────────────────────────────────────────────────

describe('SSR Auth0Provider — loginWithRedirect', () => {
  it('sets window.location.href to /auth/login with no args', () => {
    const { getCtx } = renderSsrProvider();
    getCtx().loginWithRedirect();
    expect(window.location.pathname).toBe('/auth/login');
    expect(window.location.search).toBe('');
  });

  it('encodes returnTo as a query param', () => {
    const { getCtx } = renderSsrProvider();
    getCtx().loginWithRedirect({ returnTo: '/dashboard' });
    expect(window.location.pathname).toBe('/auth/login');
    expect(window.location.search).toBe('?returnTo=%2Fdashboard');
  });
});

// ─── logout ──────────────────────────────────────────────────────────────────

describe('SSR Auth0Provider — logout', () => {
  let submitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    submitSpy = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.querySelectorAll('form').forEach(f => f.remove());
  });

  it('POSTs to /auth/logout with no args', () => {
    const { getCtx } = renderSsrProvider();
    getCtx().logout();
    const form = document.body.querySelector('form')!;
    expect(form.method).toBe('post');
    expect(form.action).toContain('/auth/logout');
    expect(form.action).not.toContain('returnTo');
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it('encodes returnTo as a query param', () => {
    const { getCtx } = renderSsrProvider();
    getCtx().logout({ returnTo: 'https://myapp.com' });
    const form = document.body.querySelector('form')!;
    expect(form.method).toBe('post');
    expect(form.action).toContain('/auth/logout?returnTo=');
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });
});
