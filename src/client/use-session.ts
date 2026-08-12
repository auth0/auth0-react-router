import type { Auth0User, BrowserSession } from '../types/index.js';
import { useAuth0 } from './use-auth0.js';

export interface SessionState {
  user: Auth0User | null;
  session: BrowserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * Returns auth state without the action methods.
 * Use this when components only need to check auth state and don't
 * need loginWithRedirect or logout.
 */
export function useSession(): SessionState {
  const { user, session, isAuthenticated, isLoading } = useAuth0();
  return { user, session, isAuthenticated, isLoading };
}
