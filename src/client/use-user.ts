import type { Auth0User } from '../types/index.js';
import { useAuth0 } from './use-auth0.js';

/**
 * Returns the authenticated user, or null when the visitor is unauthenticated.
 * Lightweight alternative to useAuth0() when only the user object is needed.
 */
export function useUser(): Auth0User | null {
  return useAuth0().user;
}
