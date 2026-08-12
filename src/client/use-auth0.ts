import { useContext } from 'react';
import { Auth0Context } from './auth0-context.js';
import type { Auth0ContextValue } from '../types/index.js';

/**
 * Returns the full Auth0 context value.
 *
 * @throws {Error} When called outside of <Auth0Provider>.
 *
 * @example
 * const { user, isAuthenticated, loginWithRedirect, logout } = useAuth0();
 */
export function useAuth0(): Auth0ContextValue {
  const ctx = useContext(Auth0Context);

  if (!ctx) {
    throw new Error(
      'useAuth0() was called outside of <Auth0Provider>. ' +
        'Wrap your application (or the relevant subtree) in <Auth0Provider>.'
    );
  }

  return ctx;
}
