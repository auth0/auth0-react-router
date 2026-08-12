export { Auth0Provider } from './Auth0Provider.js';
export type { Auth0ProviderProps } from './Auth0Provider.js';

export { useAuth0 } from './use-auth0.js';
export { useUser } from './use-user.js';
export { useSession } from './use-session.js';
export type { SessionState } from './use-session.js';

export {
  RequireAuth,
  RequireRole,
  SignedIn,
  SignedOut,
  AuthLoading,
  Auth0ErrorBoundary,
  LoginButton,
  LogoutButton,
  withAuthenticationRequired
} from './components.js';
export type {
  RequireAuthProps,
  RequireRoleProps,
  Auth0ErrorBoundaryProps,
  LoginButtonProps,
  LogoutButtonProps
} from './components.js';
