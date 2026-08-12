import { createContext } from 'react';
import type { Auth0ContextValue } from '../types/index.js';

/**
 * The React context that holds the Auth0 state.
 * Consume via useAuth0(), useUser(), or useSession() — never directly.
 */
export const Auth0Context = createContext<Auth0ContextValue | null>(null);
