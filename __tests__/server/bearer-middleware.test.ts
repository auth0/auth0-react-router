import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JWTClaims } from '../../src/types/index.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/server/api.js', () => ({
  getClaims: vi.fn()
}));

// Import after vi.mock so the module receives the mocked version
import { getClaims } from '../../src/server/api.js';
import {
  auth0ClaimsContext,
  bearerTokenMiddleware,
  getClaimsFromContext,
  requireClaimsFromContext
} from '../../src/server/middleware.js';

const mockGetClaims = vi.mocked(getClaims);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CLAIMS: JWTClaims = {
  sub: 'api|1',
  iss: 'https://test.auth0.com/',
  aud: 'https://api.example.com',
  exp: 9999999999,
  iat: 0,
  scope: 'read:users write:posts'
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(initial?: JWTClaims | null) {
  const store = new Map<object, unknown>();
  if (initial !== undefined) store.set(auth0ClaimsContext, initial);
  return {
    get: <T>(key: { defaultValue?: T }): T =>
      store.has(key) ? (store.get(key) as T) : (key.defaultValue as T),
    set: (key: object, value: unknown) => {
      store.set(key, value);
    }
  };
}

function makeNext() {
  return vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
}

function makeArgs(url = 'http://localhost:3000/api/users') {
  return {
    request: new Request(url),
    url: new URL(url),
    pattern: '/api/users',
    params: {},
    context: makeContext() as any
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── auth0ClaimsContext ───────────────────────────────────────────────────────

describe('auth0ClaimsContext', () => {
  it('default value is undefined', () => {
    expect(auth0ClaimsContext.defaultValue).toBeUndefined();
  });
});

// ─── bearerTokenMiddleware ────────────────────────────────────────────────────

describe('bearerTokenMiddleware', () => {
  it('sets claims in context when token is valid', async () => {
    mockGetClaims.mockResolvedValue(CLAIMS);
    const args = makeArgs();

    await bearerTokenMiddleware(args, makeNext());

    expect(args.context.get(auth0ClaimsContext)).toBe(CLAIMS);
  });

  it('sets null in context when no token present', async () => {
    mockGetClaims.mockResolvedValue(null);
    const args = makeArgs();

    await bearerTokenMiddleware(args, makeNext());

    expect(args.context.get(auth0ClaimsContext)).toBeNull();
  });

  it('calls next() and returns its response', async () => {
    mockGetClaims.mockResolvedValue(CLAIMS);
    const args = makeArgs();
    const next = makeNext();

    const result = await bearerTokenMiddleware(args, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((result as Response).status).toBe(200);
  });

  it('does not throw when token is invalid', async () => {
    mockGetClaims.mockResolvedValue(null);
    const args = makeArgs();

    await expect(
      bearerTokenMiddleware(args, makeNext())
    ).resolves.not.toThrow();
  });
});

// ─── getClaimsFromContext ─────────────────────────────────────────────────────

describe('getClaimsFromContext', () => {
  it('returns claims when middleware set them', () => {
    const context = makeContext(CLAIMS) as any;
    expect(getClaimsFromContext(context)).toBe(CLAIMS);
  });

  it('returns null when middleware found no valid token', () => {
    const context = makeContext(null) as any;
    expect(getClaimsFromContext(context)).toBeNull();
  });

  it('returns null when middleware was not mounted (undefined default)', () => {
    const context = makeContext() as any; // no initial value → undefined
    expect(getClaimsFromContext(context)).toBeNull();
  });
});

// ─── requireClaimsFromContext ─────────────────────────────────────────────────

describe('requireClaimsFromContext', () => {
  it('returns claims when middleware set valid claims', () => {
    const context = makeContext(CLAIMS) as any;
    expect(requireClaimsFromContext(context)).toBe(CLAIMS);
  });

  it('throws a 401 Response when middleware found no valid token (null)', () => {
    const context = makeContext(null) as any;
    let err: unknown;
    try { requireClaimsFromContext(context); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(401);
  });

  it('throws a 401 Response when middleware was not mounted (undefined)', () => {
    const context = makeContext() as any;
    let err: unknown;
    try { requireClaimsFromContext(context); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(401);
  });

  it('passes when token has the required single scope', () => {
    const context = makeContext(CLAIMS) as any;
    expect(() =>
      requireClaimsFromContext(context, { scope: 'read:users' })
    ).not.toThrow();
  });

  it('passes when token has all required scopes (array)', () => {
    const context = makeContext(CLAIMS) as any;
    expect(() =>
      requireClaimsFromContext(context, {
        scope: ['read:users', 'write:posts']
      })
    ).not.toThrow();
  });

  it('throws a 403 Response when token is missing a scope', () => {
    const context = makeContext(CLAIMS) as any;
    let err: unknown;
    try { requireClaimsFromContext(context, { scope: ['read:users', 'delete:posts'] }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(403);
  });

  it('403 Response carries the missing scope in error_description', async () => {
    const context = makeContext(CLAIMS) as any;
    let err: unknown;
    try { requireClaimsFromContext(context, { scope: ['read:users', 'delete:posts'] }); } catch (e) { err = e; }
    const body = await (err as Response).json();
    expect(body.error).toBe('insufficient_scope');
    expect(body.error_description).toBe('Required scope(s): read:users, delete:posts');
  });

  it('throws a 403 Response when token has no scope claim', () => {
    const claimsNoScope: JWTClaims = { ...CLAIMS, scope: undefined };
    const context = makeContext(claimsNoScope) as any;
    let err: unknown;
    try { requireClaimsFromContext(context, { scope: 'read:users' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(403);
  });

  it('passes when no scope option is provided', () => {
    const context = makeContext(CLAIMS) as any;
    expect(() => requireClaimsFromContext(context)).not.toThrow();
  });

  it('passes when scope is an empty array (vacuously true)', () => {
    const context = makeContext(CLAIMS) as any;
    expect(() =>
      requireClaimsFromContext(context, { scope: [] })
    ).not.toThrow();
  });

  it('is synchronous — returns JWTClaims directly, not a Promise', () => {
    const context = makeContext(CLAIMS) as any;
    const result = requireClaimsFromContext(context);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toBe(CLAIMS);
  });
});
