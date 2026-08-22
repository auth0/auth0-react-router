import type { Auth0User, BrowserSession } from '../types/index.js';
import { useAuth0 } from './use-auth0.js';

export interface SessionState {
  user: Auth0User | null;
  session: BrowserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * Returns auth state without the action methods (loginWithRedirect, logout).
 * Use this when components only need to read auth state.
 *
 * Returns a `SessionState` object — not the session directly. Access the
 * session object via the `.session` property:
 *
 * @example
 * const { user, session, isAuthenticated, isLoading } = useSession();
 * // session is BrowserSession | null
 * // user    is Auth0User | null
 */
export function useSession(): SessionState {
  const { user, session, isAuthenticated, isLoading } = useAuth0();
  return { user, session, isAuthenticated, isLoading };
}
