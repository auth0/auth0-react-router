// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  RequireAuth,
  RequireRole,
  SignedIn,
  SignedOut,
  AuthLoading,
  Auth0ErrorBoundary,
  LoginButton,
  LogoutButton,
  withAuthenticationRequired
} from '../../src/client/components.js';
import { InsufficientScopeError } from '../../src/errors/index.js';
import {
  WithAuth,
  createMockUser,
  createMockAuth0Context
} from '../../src/testing/index.js';
import { Auth0Context } from '../../src/client/auth0-context.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AUTHED_USER = createMockUser({
  sub: 'auth0|1',
  'https://auth0.com/claims/roles': ['admin', 'user']
});

function authed(ui: React.ReactElement) {
  return render(<WithAuth user={AUTHED_USER}>{ui}</WithAuth>);
}

function unauthed(ui: React.ReactElement) {
  return render(
    <WithAuth session={null} isAuthenticated={false}>
      {ui}
    </WithAuth>
  );
}

// Suppress React's console.error for expected thrown renders
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(cleanup);

// ─── RequireAuth ──────────────────────────────────────────────────────────────

describe('RequireAuth', () => {
  it('renders children when authenticated', () => {
    authed(
      <RequireAuth>
        <span>Protected</span>
      </RequireAuth>
    );
    expect(screen.getByText('Protected')).toBeDefined();
  });

  it('renders nothing when not authenticated', () => {
    unauthed(
      <RequireAuth>
        <span>Protected</span>
      </RequireAuth>
    );
    expect(screen.queryByText('Protected')).toBeNull();
  });

  it('calls loginWithRedirect when not authenticated', () => {
    const loginWithRedirect = vi.fn();
    const ctx = createMockAuth0Context({
      session: null,
      isAuthenticated: false,
      loginWithRedirect
    });
    render(
      <Auth0Context.Provider value={ctx}>
        <RequireAuth>
          <span>Protected</span>
        </RequireAuth>
      </Auth0Context.Provider>
    );
    expect(loginWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('passes returnTo to loginWithRedirect', () => {
    const loginWithRedirect = vi.fn();
    const ctx = createMockAuth0Context({
      session: null,
      isAuthenticated: false,
      loginWithRedirect
    });
    render(
      <Auth0Context.Provider value={ctx}>
        <RequireAuth returnTo="/dashboard">
          <span>x</span>
        </RequireAuth>
      </Auth0Context.Provider>
    );
    expect(loginWithRedirect).toHaveBeenCalledWith({ returnTo: '/dashboard' });
  });

  it('defaults returnTo to current pathname and search when not provided', () => {
    const loginWithRedirect = vi.fn();
    const ctx = createMockAuth0Context({
      session: null,
      isAuthenticated: false,
      loginWithRedirect
    });
    render(
      <Auth0Context.Provider value={ctx}>
        <RequireAuth>
          <span>x</span>
        </RequireAuth>
      </Auth0Context.Provider>
    );
    expect(loginWithRedirect).toHaveBeenCalledWith({
      returnTo: window.location.pathname + window.location.search
    });
  });
});

// ─── RequireRole ──────────────────────────────────────────────────────────────

describe('RequireRole', () => {
  it('renders children when the user has the required role', () => {
    authed(
      <RequireRole role="admin">
        <span>Admin area</span>
      </RequireRole>
    );
    expect(screen.getByText('Admin area')).toBeDefined();
  });

  it('accepts an array of roles and renders when all are present', () => {
    authed(
      <RequireRole role={['admin', 'user']}>
        <span>Multi-role</span>
      </RequireRole>
    );
    expect(screen.getByText('Multi-role')).toBeDefined();
  });

  it('throws InsufficientScopeError when the user lacks the role', () => {
    expect(() =>
      authed(
        <RequireRole role="superadmin">
          <span>Super</span>
        </RequireRole>
      )
    ).toThrow(InsufficientScopeError);
  });

  it('throws InsufficientScopeError when the user is not authenticated', () => {
    expect(() =>
      unauthed(
        <RequireRole role="admin">
          <span>x</span>
        </RequireRole>
      )
    ).toThrow(InsufficientScopeError);
  });

  it('never redirects — throws only', () => {
    const loginWithRedirect = vi.fn();
    const ctx = createMockAuth0Context({
      session: null,
      isAuthenticated: false,
      loginWithRedirect
    });
    expect(() =>
      render(
        <Auth0Context.Provider value={ctx}>
          <RequireRole role="admin">
            <span>x</span>
          </RequireRole>
        </Auth0Context.Provider>
      )
    ).toThrow(InsufficientScopeError);
    expect(loginWithRedirect).not.toHaveBeenCalled();
  });

  it('supports a custom rolesClaim', () => {
    const user = createMockUser({ 'my:roles': ['editor'] });
    render(
      <WithAuth user={user}>
        <RequireRole role="editor" rolesClaim="my:roles">
          <span>Custom claim</span>
        </RequireRole>
      </WithAuth>
    );
    expect(screen.getByText('Custom claim')).toBeDefined();
  });

  it('renders nothing while isLoading — does not throw during SPA init', () => {
    const ctx = createMockAuth0Context({ isLoading: true, isAuthenticated: false, session: null });
    const { container } = render(
      <Auth0Context.Provider value={ctx}>
        <RequireRole role="admin">
          <span>Admin</span>
        </RequireRole>
      </Auth0Context.Provider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders children when roles claim is a string that exactly matches the required role', () => {
    const user = createMockUser({ 'https://auth0.com/claims/roles': 'admin' });
    render(
      <WithAuth user={user}>
        <RequireRole role="admin">
          <span>Admin area</span>
        </RequireRole>
      </WithAuth>
    );
    expect(screen.getByText('Admin area')).toBeDefined();
  });

  it('throws InsufficientScopeError when roles claim is a string that only contains the required role as a substring', () => {
    const user = createMockUser({ 'https://auth0.com/claims/roles': 'billing-admin' });
    expect(() =>
      render(
        <WithAuth user={user}>
          <RequireRole role="admin">
            <span>Admin area</span>
          </RequireRole>
        </WithAuth>
      )
    ).toThrow(InsufficientScopeError);
  });
});

// ─── SignedIn / SignedOut / AuthLoading ───────────────────────────────────────

describe('SignedIn', () => {
  it('renders children when authenticated', () => {
    authed(
      <SignedIn>
        <span>Hello</span>
      </SignedIn>
    );
    expect(screen.getByText('Hello')).toBeDefined();
  });

  it('renders nothing when not authenticated', () => {
    unauthed(
      <SignedIn>
        <span>Hello</span>
      </SignedIn>
    );
    expect(screen.queryByText('Hello')).toBeNull();
  });
});

describe('SignedOut', () => {
  it('renders children when not authenticated', () => {
    unauthed(
      <SignedOut>
        <span>Sign in</span>
      </SignedOut>
    );
    expect(screen.getByText('Sign in')).toBeDefined();
  });

  it('renders nothing when authenticated', () => {
    authed(
      <SignedOut>
        <span>Sign in</span>
      </SignedOut>
    );
    expect(screen.queryByText('Sign in')).toBeNull();
  });
});

describe('AuthLoading', () => {
  it('renders children when isLoading is true', () => {
    render(
      <WithAuth isLoading={true} isAuthenticated={false} session={null}>
        <AuthLoading>
          <span>Loading…</span>
        </AuthLoading>
      </WithAuth>
    );
    expect(screen.getByText('Loading…')).toBeDefined();
  });

  it('renders nothing when isLoading is false (SSR mode default)', () => {
    authed(
      <AuthLoading>
        <span>Loading…</span>
      </AuthLoading>
    );
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});

// ─── Auth0ErrorBoundary ───────────────────────────────────────────────────────

describe('Auth0ErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    render(
      <Auth0ErrorBoundary fallback={<span>Error</span>}>
        <span>OK</span>
      </Auth0ErrorBoundary>
    );
    expect(screen.getByText('OK')).toBeDefined();
  });

  it('renders the fallback node when an Auth0Error is thrown', () => {
    function Bomb() {
      throw new InsufficientScopeError('no role');
    }
    render(
      <Auth0ErrorBoundary fallback={<span>Access denied</span>}>
        <Bomb />
      </Auth0ErrorBoundary>
    );
    expect(screen.getByText('Access denied')).toBeDefined();
  });

  it('passes the error to a fallback function', () => {
    function Bomb() {
      throw new InsufficientScopeError('missing role');
    }
    render(
      <Auth0ErrorBoundary fallback={err => <span>{err.message}</span>}>
        <Bomb />
      </Auth0ErrorBoundary>
    );
    expect(screen.getByText('missing role')).toBeDefined();
  });

  it('re-throws non-Auth0 errors', () => {
    function Bomb() {
      throw new Error('unexpected');
    }
    expect(() =>
      render(
        <Auth0ErrorBoundary fallback={<span>x</span>}>
          <Bomb />
        </Auth0ErrorBoundary>
      )
    ).toThrow('unexpected');
  });
});

// ─── LoginButton / LogoutButton ───────────────────────────────────────────────

describe('LoginButton', () => {
  it('renders with default label', () => {
    authed(<LoginButton />);
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDefined();
  });

  it('renders with custom children', () => {
    authed(<LoginButton>Sign in now</LoginButton>);
    expect(screen.getByRole('button', { name: 'Sign in now' })).toBeDefined();
  });

  it('calls loginWithRedirect on click', () => {
    const loginWithRedirect = vi.fn();
    const ctx = createMockAuth0Context({ loginWithRedirect });
    render(
      <Auth0Context.Provider value={ctx}>
        <LoginButton />
      </Auth0Context.Provider>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(loginWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('passes returnTo to loginWithRedirect', () => {
    const loginWithRedirect = vi.fn();
    const ctx = createMockAuth0Context({ loginWithRedirect });
    render(
      <Auth0Context.Provider value={ctx}>
        <LoginButton returnTo="/after-login" />
      </Auth0Context.Provider>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(loginWithRedirect).toHaveBeenCalledWith({
      returnTo: '/after-login'
    });
  });
});

describe('LogoutButton', () => {
  it('renders with default label', () => {
    authed(<LogoutButton />);
    expect(screen.getByRole('button', { name: 'Log out' })).toBeDefined();
  });

  it('calls logout on click', () => {
    const logout = vi.fn();
    const ctx = createMockAuth0Context({ logout });
    render(
      <Auth0Context.Provider value={ctx}>
        <LogoutButton />
      </Auth0Context.Provider>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('passes returnTo to logout', () => {
    const logout = vi.fn();
    const ctx = createMockAuth0Context({ logout });
    render(
      <Auth0Context.Provider value={ctx}>
        <LogoutButton returnTo="https://myapp.com/signed-out" />
      </Auth0Context.Provider>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(logout).toHaveBeenCalledWith({
      returnTo: 'https://myapp.com/signed-out'
    });
  });
});

// ─── withAuthenticationRequired ───────────────────────────────────────────────

describe('withAuthenticationRequired', () => {
  it('renders the wrapped component when authenticated', () => {
    function Profile() {
      return <span>Profile page</span>;
    }
    const Protected = withAuthenticationRequired(Profile);
    authed(<Protected />);
    expect(screen.getByText('Profile page')).toBeDefined();
  });

  it('renders nothing when not authenticated', () => {
    function Profile() {
      return <span>Profile page</span>;
    }
    const Protected = withAuthenticationRequired(Profile);
    unauthed(<Protected />);
    expect(screen.queryByText('Profile page')).toBeNull();
  });

  it('sets a displayName on the wrapper', () => {
    function MyPage() {
      return null;
    }
    const Protected = withAuthenticationRequired(MyPage);
    expect(Protected.displayName).toBe('withAuthenticationRequired(MyPage)');
  });
});
