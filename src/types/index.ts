// ─── User ─────────────────────────────────────────────────────────────────────

export interface Auth0User {
  sub: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  [claim: string]: unknown;
}

// ─── Token ────────────────────────────────────────────────────────────────────

export interface TokenSet {
  audience?: string;
  accessToken: string;
  scope?: string;
  expiresAt: number; // Unix timestamp (seconds)
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

/**
 * Safe for the browser. Only the user profile — no tokens.
 * This is what rootAuthLoader returns to React components.
 */
export interface BrowserSession {
  user: Auth0User;
}

/**
 * Server-side only. Contains tokens.
 * Never serialized into loader data or sent to the browser.
 */
export interface Auth0Session {
  user: Auth0User;
  idToken?: string;
  refreshToken?: string;
  tokenSets: TokenSet[];
  domain?: string;
}

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * What useAuth0() returns in React components.
 * getAccessToken is SPA mode only — not available in SSR mode (Phase 2).
 * isLoading is always false in SSR mode.
 */
export interface Auth0ContextValue {
  user: Auth0User | null;
  session: BrowserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginWithRedirect: (opts?: { returnTo?: string }) => void;
  logout: (opts?: { returnTo?: string }) => void;
  getAccessToken: () => Promise<string>;
}

// ─── API protection ───────────────────────────────────────────────────────────

/**
 * Validated claims from a Bearer token.
 * Used in API protection routes (Resource Server).
 */
export interface JWTClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  scope?: string;
  [key: string]: unknown;
}
