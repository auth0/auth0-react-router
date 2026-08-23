import { Component, useEffect } from 'react';
import type {
  ButtonHTMLAttributes,
  ComponentType,
  ErrorInfo,
  ReactNode
} from 'react';
import { Auth0Error, InsufficientScopeError } from '../errors/index.js';
import { useAuth0 } from './use-auth0.js';

// ─── RequireAuth ──────────────────────────────────────────────────────────────

export interface RequireAuthProps {
  children: ReactNode;
  /** Where to redirect after a successful login. Defaults to the current URL. */
  returnTo?: string;
}

/**
 * Redirects unauthenticated users to the login page.
 * Renders nothing while auth state is loading or the redirect is in flight.
 *
 * Use requireSession() in your loader for server-side protection — this
 * component is a client-side safety net.
 */
export function RequireAuth({ children, returnTo }: RequireAuthProps) {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      loginWithRedirect({
        returnTo: returnTo ?? window.location.pathname + window.location.search
      });
    }
  }, [isAuthenticated, isLoading, loginWithRedirect, returnTo]);

  if (isLoading || !isAuthenticated) return null;

  return <>{children}</>;
}

// ─── RequireRole ──────────────────────────────────────────────────────────────

const DEFAULT_ROLES_CLAIM = 'https://auth0.com/claims/roles';

export interface RequireRoleProps {
  /** The role name (or array of names) the user must have. */
  role: string | string[];
  /** The user claim that holds the roles array. */
  rolesClaim?: string;
  children: ReactNode;
}

/**
 * Throws InsufficientScopeError (403) if the authenticated user does not hold
 * the required role(s). React Router's error boundary renders the 403 page.
 *
 * Never redirects — an authenticated user who lacks a role should not be sent
 * to the login page.
 *
 * @throws {InsufficientScopeError} When the user is unauthenticated or missing
 *   the required role.
 */
export function RequireRole({
  role,
  rolesClaim = DEFAULT_ROLES_CLAIM,
  children
}: RequireRoleProps) {
  const { user, isAuthenticated, isLoading } = useAuth0();

  // Error boundaries are a client-only React mechanism. Throwing during SSR
  // bypasses Auth0ErrorBoundary and surfaces at the framework root error handler.
  // Return null on the server and defer the role check to the client after hydration.
  if (typeof window === 'undefined') {
    return null;
  }

  // In SPA mode, isLoading is true during SDK initialisation. Throwing here
  // would cause Auth0ErrorBoundary to render the error fallback for every user
  // before auth state is known — including users who do have the required role.
  if (isLoading) return null;

  // Error boundaries are a client-only React mechanism. Throwing during SSR
  // bypasses Auth0ErrorBoundary and surfaces at the framework root error handler.
  // Return null on the server and defer the role check to the client after hydration.
  if (typeof window === 'undefined') {
    return null;
  }

  if (!isAuthenticated || !user) {
    throw new InsufficientScopeError('Insufficient permissions.');
  }

  const userRoles = (user[rolesClaim] as string[] | undefined) ?? [];
  const required = Array.isArray(role) ? role : [role];

  if (!required.every(r => userRoles.includes(r))) {
    throw new InsufficientScopeError(
      `Required role(s): ${required.join(', ')}`
    );
  }

  return <>{children}</>;
}

// ─── SignedIn / SignedOut / AuthLoading ───────────────────────────────────────

/**
 * Renders children only when the user is authenticated.
 * Does not redirect — use RequireAuth for gating.
 */
export function SignedIn({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth0();
  return isAuthenticated ? <>{children}</> : null;
}

/**
 * Renders children only when the user is not authenticated.
 */
export function SignedOut({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth0();
  return !isAuthenticated ? <>{children}</> : null;
}

/**
 * Renders children while isLoading is true.
 * Only relevant in SPA mode — in SSR mode isLoading is always false.
 */
export function AuthLoading({ children }: { children: ReactNode }) {
  const { isLoading } = useAuth0();
  return isLoading ? <>{children}</> : null;
}

// ─── Auth0ErrorBoundary ───────────────────────────────────────────────────────

export interface Auth0ErrorBoundaryProps {
  /** Fallback UI. Pass a function to receive the error. */
  fallback: ReactNode | ((error: Auth0Error) => ReactNode);
  children: ReactNode;
}

interface Auth0ErrorBoundaryState {
  error: Auth0Error | null;
}

/**
 * Catches Auth0Error subclasses thrown during render (e.g. from RequireRole)
 * and renders the fallback. Non-Auth0 errors are re-thrown.
 */
export class Auth0ErrorBoundary extends Component<
  Auth0ErrorBoundaryProps,
  Auth0ErrorBoundaryState
> {
  constructor(props: Auth0ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(
    error: unknown
  ): Partial<Auth0ErrorBoundaryState> | null {
    if (error instanceof Auth0Error) {
      return { error };
    }
    throw error; // re-throw non-Auth0 errors
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  render() {
    const { error } = this.state;
    if (error) {
      const { fallback } = this.props;
      return typeof fallback === 'function' ? fallback(error) : fallback;
    }
    return this.props.children;
  }
}

// ─── LoginButton / LogoutButton ───────────────────────────────────────────────

export interface LoginButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  returnTo?: string;
}

/**
 * A zero-style button that calls loginWithRedirect on click.
 * Accepts all standard button props plus an optional returnTo.
 */
export function LoginButton({
  returnTo,
  onClick,
  children = 'Log in',
  ...rest
}: LoginButtonProps) {
  const { loginWithRedirect } = useAuth0();

  return (
    <button
      type="button"
      onClick={e => {
        loginWithRedirect({ returnTo });
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface LogoutButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  returnTo?: string;
}

/**
 * A zero-style button that calls logout on click.
 * Accepts all standard button props plus an optional returnTo.
 */
export function LogoutButton({
  returnTo,
  onClick,
  children = 'Log out',
  ...rest
}: LogoutButtonProps) {
  const { logout } = useAuth0();

  return (
    <button
      type="button"
      onClick={e => {
        logout({ returnTo });
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

// ─── withAuthenticationRequired ───────────────────────────────────────────────

/**
 * HOC that wraps a component in RequireAuth.
 * Unauthenticated users are redirected to login before the component renders.
 */
export function withAuthenticationRequired<P extends object>(
  Component: ComponentType<P>,
  opts?: { returnTo?: string }
): ComponentType<P> {
  function WithAuthenticationRequired(props: P) {
    return (
      <RequireAuth returnTo={opts?.returnTo}>
        <Component {...props} />
      </RequireAuth>
    );
  }

  WithAuthenticationRequired.displayName = `withAuthenticationRequired(${
    Component.displayName ?? Component.name ?? 'Component'
  })`;

  return WithAuthenticationRequired;
}
