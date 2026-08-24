import { ApiClient } from '@auth0/auth0-api-js';
import { ConfigurationError } from '../errors/index.js';
import type { JWTClaims } from '../types/index.js';

function jsonResponse(status: number, error: string, description: string): Response {
  return new Response(
    JSON.stringify({ error, error_description: description }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

// ─── Test injection ───────────────────────────────────────────────────────────

type VerifyFn = (token: string) => Promise<JWTClaims>;
let _verifyJwtFn: VerifyFn | undefined;
let _apiClient: ApiClient | undefined;

/** Override the JWT verifier. Pass undefined to restore the default. @internal */
export function _setVerifyJwt(fn: VerifyFn | undefined): void {
  _verifyJwtFn = fn;
}

/** Reset the cached ApiClient instance. @internal */
export function _resetApiClient(): void {
  _apiClient = undefined;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

// Reads AUTH0_DOMAIN and AUTH0_AUDIENCE directly from the environment — no
// Auth0Server instance required. This is intentional: getClaims /
// requireClaims are designed to work in API-only deployments where only JWT
// verification is needed and the full session/cookie stack (AUTH0_CLIENT_ID,
// AUTH0_CLIENT_SECRET, AUTH0_SESSION_SECRET) is not configured. If you are
// using a full Auth0Server setup, set AUTH0_DOMAIN and AUTH0_AUDIENCE as
// environment variables alongside the other required config — they will be
// picked up here automatically.
async function verifyJwt(token: string): Promise<JWTClaims> {
  if (_verifyJwtFn) return _verifyJwtFn(token);

  const domain = process.env['AUTH0_DOMAIN'];
  const audience = process.env['AUTH0_AUDIENCE'];

  if (!domain) {
    throw new ConfigurationError(
      'AUTH0_DOMAIN is required for Bearer token verification. ' +
        'Set it as an environment variable.'
    );
  }
  if (!audience) {
    throw new ConfigurationError(
      'AUTH0_AUDIENCE is required for Bearer token verification. ' +
        'Set it as an environment variable.'
    );
  }
  if (!_apiClient) {
    _apiClient = new ApiClient({ domain, audience });
  }
  const claims = await _apiClient.verifyAccessToken({ accessToken: token });
  return claims as unknown as JWTClaims;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RequireClaimsOptions {
  /** Required scope(s). Throws InsufficientScopeError (403) if missing. */
  scope?: string | string[];
}

/**
 * Returns validated JWT claims, or null if no/invalid token.
 * @throws {ConfigurationError} if AUTH0_DOMAIN or AUTH0_AUDIENCE is not configured.
 */
export async function getClaims(request: Request): Promise<JWTClaims | null> {
  const token = extractBearerToken(request);
  if (!token) return null;
  try {
    return await verifyJwt(token);
  } catch (err) {
    if (err instanceof ConfigurationError) throw err;
    return null;
  }
}

/**
 * Returns validated JWT claims.
 *
 * Throws a `Response` (401 or 403 JSON) that React Router forwards directly
 * to the client — no try/catch needed in the loader.
 *
 * @throws {Response} 401 — missing or invalid Bearer token
 * @throws {Response} 403 — token valid but missing required scope
 * @throws {ConfigurationError} 500 — AUTH0_DOMAIN or AUTH0_AUDIENCE not set
 */
export async function requireClaims(
  request: Request,
  opts?: RequireClaimsOptions
): Promise<JWTClaims> {
  const token = extractBearerToken(request);
  if (!token)
    throw jsonResponse(401, 'bearer_token_error', 'No Bearer token found in Authorization header');

  let claims: JWTClaims;
  try {
    claims = await verifyJwt(token);
  } catch (err) {
    if (err instanceof ConfigurationError) throw err;
    throw jsonResponse(
      401,
      'bearer_token_error',
      err instanceof Error ? err.message : 'Bearer token verification failed'
    );
  }

  if (opts?.scope) {
    const required = Array.isArray(opts.scope) ? opts.scope : [opts.scope];
    const tokenScopes = claims.scope?.trim().split(/\s+/) ?? [];
    if (!required.every(s => tokenScopes.includes(s))) {
      throw jsonResponse(403, 'insufficient_scope', `Required scope(s): ${required.join(', ')}`);
    }
  }

  return claims;
}
