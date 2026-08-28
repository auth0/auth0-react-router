import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InsufficientScopeError } from '../../src/errors/index.js';
import type { Auth0Session } from '../../src/types/index.js';

// ─── Mock utils ───────────────────────────────────────────────────────────────

vi.mock('../../src/server/utils.js', () => ({
  getSession: vi.fn(),
  _setAuth0Instance: vi.fn(),
  _initRequestCookieJar: vi.fn(),
  _drainRequestCookieJar: vi.fn()
}));

// Import after vi.mock so the module receives the mocked version
import { getSession, _drainRequestCookieJar } from '../../src/server/utils.js';
import {
  auth0Middleware,
  defineRouteAuth,
  auth0SessionContext,
  auth0UserContext
} from '../../src/server/middleware.js';

const mockGetSession = vi.mocked(getSession);
const mockDrainCookieJar = vi.mocked(_drainRequestCookieJar);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal duck-typed context that mirrors RouterContextProvider's public API. */
function makeContext() {
  const store = new Map<object, unknown>();
  return {
    get: <T>(key: { defaultValue?: T }): T =>
      store.has(key) ? (store.get(key) as T) : (key.defaultValue as T),
    set: (key: object, value: unknown) => {
      store.set(key, value);
    }
  };
}

const SESSION: Auth0Session = {
  user: {
    sub: 'auth0|test',
    name: 'Test User',
    email: 'test@example.com',
    email_verified: true,
    'https://auth0.com/claims/roles': ['admin', 'user']
  },
  tokenSets: [],
  domain: 'test.auth0.com'
};

function makeNext() {
  return vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
}

function makeArgs(url = 'http://localhost:3000/dashboard') {
  return {
    request: new Request(url),
    url: new URL(url),
    pattern: '/dashboard',
    params: {},
    context: makeContext() as any
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: no cookies to forward
  mockDrainCookieJar.mockReturnValue([]);
  delete process.env['AUTH0_LOGIN_PATH'];
});

// ─── auth0SessionContext / auth0UserContext default values ─────────────────────

describe('context keys', () => {
  it('auth0SessionContext default value is undefined', () => {
    expect(auth0SessionContext.defaultValue).toBeUndefined();
  });

  it('auth0UserContext default value is undefined', () => {
    expect(auth0UserContext.defaultValue).toBeUndefined();
  });
});

// ─── auth0Middleware ───────────────────────────────────────────────────────────

describe('auth0Middleware', () => {
  it('sets session and user in context when authenticated', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    const args = makeArgs();
    const next = makeNext();

    await auth0Middleware(args, next);

    expect(args.context.get(auth0SessionContext)).toBe(SESSION);
    expect(args.context.get(auth0UserContext)).toBe(SESSION.user);
  });

  it('sets session=null and user=null when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const args = makeArgs();
    const next = makeNext();

    await auth0Middleware(args, next);

    expect(args.context.get(auth0SessionContext)).toBeNull();
    expect(args.context.get(auth0UserContext)).toBeNull();
  });

  it('calls next() and returns its response', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    const args = makeArgs();
    const next = makeNext();

    const result = await auth0Middleware(args, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(200);
  });

  it('does not throw when unauthenticated — no enforcement', async () => {
    mockGetSession.mockResolvedValue(null);
    const args = makeArgs();
    const next = makeNext();

    await expect(auth0Middleware(args, next)).resolves.not.toThrow();
  });

  it('returns the original response when there are no cookies to forward', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockDrainCookieJar.mockReturnValue([]);
    const next = makeNext();

    const result = await auth0Middleware(makeArgs(), next);

    expect((result as Response).headers.getSetCookie()).toHaveLength(0);
  });

  it('appends Set-Cookie headers from token refresh to the response', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockDrainCookieJar.mockReturnValue([
      '__a0_session=new-value; HttpOnly; Path=/'
    ]);
    const next = makeNext();

    const result = await auth0Middleware(makeArgs(), next);

    expect((result as Response).headers.getSetCookie()).toContain(
      '__a0_session=new-value; HttpOnly; Path=/'
    );
  });

  it('preserves the original response status and body when forwarding cookies', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockDrainCookieJar.mockReturnValue(['__a0_session=v; HttpOnly; Path=/']);
    const next = vi
      .fn()
      .mockResolvedValue(new Response('hello', { status: 201 }));

    const result = await auth0Middleware(makeArgs(), next);

    expect((result as Response).status).toBe(201);
  });
});

// ─── defineRouteAuth — handle metadata ────────────────────────────────────────

describe('defineRouteAuth — handle metadata', () => {
  it('returns a handle with the auth config', () => {
    const { handle } = defineRouteAuth({ role: 'admin' });
    expect(handle.auth.role).toBe('admin');
  });

  it('returns an empty handle when called with no options', () => {
    const { handle } = defineRouteAuth();
    expect(handle.auth).toEqual({});
  });

  it('includes rolesClaim in the handle when provided', () => {
    const { handle } = defineRouteAuth({
      role: 'editor',
      rolesClaim: 'my:roles'
    });
    expect(handle.auth.rolesClaim).toBe('my:roles');
  });

  it('returns a middleware array alongside the handle', () => {
    const { middleware } = defineRouteAuth();
    expect(Array.isArray(middleware)).toBe(true);
    expect(middleware).toHaveLength(1);
  });
});

// ─── defineRouteAuth — unauthenticated ───────────────────────────────────────

describe('defineRouteAuth — unauthenticated', () => {
  it('throws a 302 Response when no session', async () => {
    mockGetSession.mockResolvedValue(null);
    const {
      middleware: [mw]
    } = defineRouteAuth();
    const args = makeArgs('http://localhost:3000/dashboard');

    await expect(mw(args, makeNext())).rejects.toBeInstanceOf(Response);
  });

  it('302 Response has correct status', async () => {
    mockGetSession.mockResolvedValue(null);
    const {
      middleware: [mw]
    } = defineRouteAuth();
    const args = makeArgs('http://localhost:3000/dashboard');

    const err = await mw(args, makeNext()).catch(e => e);
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(302);
  });

  it('returnTo includes pathname and search', async () => {
    mockGetSession.mockResolvedValue(null);
    const {
      middleware: [mw]
    } = defineRouteAuth();
    const args = makeArgs('http://localhost:3000/dashboard?tab=settings');

    const err = await mw(args, makeNext()).catch(e => e);
    expect(err).toBeInstanceOf(Response);
    const location = (err as Response).headers.get('Location')!;
    expect(location).toContain('returnTo=%2Fdashboard%3Ftab%3Dsettings');
  });

  it('redirects to /auth/login by default', async () => {
    mockGetSession.mockResolvedValue(null);
    const {
      middleware: [mw]
    } = defineRouteAuth();
    const args = makeArgs('http://localhost:3000/dashboard');

    const err = await mw(args, makeNext()).catch(e => e);
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).headers.get('Location')).toMatch(/^\/auth\/login/);
  });

  it('reads AUTH0_LOGIN_PATH env var for the login path', async () => {
    process.env['AUTH0_LOGIN_PATH'] = '/login';
    mockGetSession.mockResolvedValue(null);
    const {
      middleware: [mw]
    } = defineRouteAuth();
    const args = makeArgs('http://localhost:3000/dashboard');

    const err = await mw(args, makeNext()).catch(e => e);
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).headers.get('Location')).toMatch(/^\/login/);
  });

  it('handles a login path that already has a query string', async () => {
    process.env['AUTH0_LOGIN_PATH'] = '/auth/login?prompt=login';
    mockGetSession.mockResolvedValue(null);
    const {
      middleware: [mw]
    } = defineRouteAuth();
    const args = makeArgs('http://localhost:3000/dashboard');

    const err = await mw(args, makeNext()).catch(e => e);
    expect(err).toBeInstanceOf(Response);
    const location = (err as Response).headers.get('Location')!;
    expect(location).toContain('prompt=login');
    expect(location).toContain('returnTo=');
  });
});

// ─── defineRouteAuth — authenticated, no role requirement ────────────────────

describe('defineRouteAuth — authenticated, no role requirement', () => {
  it('calls next() and returns its response', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    const {
      middleware: [mw]
    } = defineRouteAuth();
    const args = makeArgs();
    const next = makeNext();

    const result = await mw(args, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((result as Response).status).toBe(200);
  });

  it('sets session and user in context', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    const {
      middleware: [mw]
    } = defineRouteAuth();
    const args = makeArgs();

    await mw(args, makeNext());

    expect(args.context.get(auth0SessionContext)).toBe(SESSION);
    expect(args.context.get(auth0UserContext)).toBe(SESSION.user);
  });
});

// ─── defineRouteAuth — role check ─────────────────────────────────────────────

describe('defineRouteAuth — role check', () => {
  it('calls next() when user has the required role', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    const {
      middleware: [mw]
    } = defineRouteAuth({ role: 'admin' });
    const args = makeArgs();
    const next = makeNext();

    await mw(args, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws InsufficientScopeError when user lacks the role', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    const {
      middleware: [mw]
    } = defineRouteAuth({ role: 'superadmin' });

    await expect(mw(makeArgs(), makeNext())).rejects.toBeInstanceOf(
      InsufficientScopeError
    );
  });

  it('throws InsufficientScopeError when user has no roles claim', async () => {
    const sessionNoRoles: Auth0Session = {
      ...SESSION,
      user: { sub: 'auth0|1', name: 'No Roles' }
    };
    mockGetSession.mockResolvedValue(sessionNoRoles);
    const {
      middleware: [mw]
    } = defineRouteAuth({ role: 'admin' });

    await expect(mw(makeArgs(), makeNext())).rejects.toBeInstanceOf(
      InsufficientScopeError
    );
  });

  it('accepts an array of roles — passes when user has all', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    const {
      middleware: [mw]
    } = defineRouteAuth({ role: ['admin', 'user'] });
    const next = makeNext();

    await mw(makeArgs(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('accepts an array of roles — throws when user is missing one', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    const {
      middleware: [mw]
    } = defineRouteAuth({ role: ['admin', 'superadmin'] });

    await expect(mw(makeArgs(), makeNext())).rejects.toBeInstanceOf(
      InsufficientScopeError
    );
  });

  it('respects a custom rolesClaim option', async () => {
    const sessionCustomClaim: Auth0Session = {
      ...SESSION,
      user: { sub: 'auth0|1', 'my:roles': ['editor'] }
    };
    mockGetSession.mockResolvedValue(sessionCustomClaim);
    const {
      middleware: [mw]
    } = defineRouteAuth({
      role: 'editor',
      rolesClaim: 'my:roles'
    });
    const next = makeNext();

    await mw(makeArgs(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes when roles claim is a string that exactly matches the required role', async () => {
    const sessionStringRole: Auth0Session = {
      ...SESSION,
      user: { sub: 'auth0|1', 'https://auth0.com/claims/roles': 'admin' }
    };
    mockGetSession.mockResolvedValue(sessionStringRole);
    const {
      middleware: [mw]
    } = defineRouteAuth({ role: 'admin' });
    const next = makeNext();

    await mw(makeArgs(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws InsufficientScopeError when roles claim is a string that only contains the required role as a substring', async () => {
    const sessionSubstring: Auth0Session = {
      ...SESSION,
      user: { sub: 'auth0|1', 'https://auth0.com/claims/roles': 'billing-admin' }
    };
    mockGetSession.mockResolvedValue(sessionSubstring);
    const {
      middleware: [mw]
    } = defineRouteAuth({ role: 'admin' });

    await expect(mw(makeArgs(), makeNext())).rejects.toBeInstanceOf(
      InsufficientScopeError
    );
  });

  it('drops non-string elements from array claim and still passes for valid string role', async () => {
    const sessionMixed: Auth0Session = {
      ...SESSION,
      user: { sub: 'auth0|1', 'https://auth0.com/claims/roles': ['admin', 123] }
    };
    mockGetSession.mockResolvedValue(sessionMixed);
    const {
      middleware: [mw]
    } = defineRouteAuth({ role: 'admin' });
    const next = makeNext();

    await mw(makeArgs(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws InsufficientScopeError when roles claim is an empty string', async () => {
    const sessionEmptyString: Auth0Session = {
      ...SESSION,
      user: { sub: 'auth0|1', 'https://auth0.com/claims/roles': '' }
    };
    mockGetSession.mockResolvedValue(sessionEmptyString);
    const {
      middleware: [mw]
    } = defineRouteAuth({ role: 'admin' });

    await expect(mw(makeArgs(), makeNext())).rejects.toBeInstanceOf(
      InsufficientScopeError
    );
  });
});

// ─── defineRouteAuth — composition with auth0Middleware ───────────────────────

describe('defineRouteAuth — composition with auth0Middleware', () => {
  it('reads session from context when auth0Middleware already ran — no second getSession call', async () => {
    mockGetSession.mockResolvedValue(SESSION);

    // Simulate auth0Middleware having run: pre-populate context
    const args = makeArgs();
    args.context.set(auth0SessionContext as any, SESSION);
    args.context.set(auth0UserContext as any, SESSION.user);

    const {
      middleware: [mw]
    } = defineRouteAuth();
    await mw(args, makeNext());

    // getSession should NOT have been called — session came from context
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('falls back to getSession when context is empty (auth0Middleware not used)', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    const {
      middleware: [mw]
    } = defineRouteAuth();

    await mw(makeArgs(), makeNext());

    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  it('treats context null as unauthenticated without calling getSession', async () => {
    // auth0Middleware ran and found no session — set null in context
    const args = makeArgs();
    args.context.set(auth0SessionContext as any, null);

    const {
      middleware: [mw]
    } = defineRouteAuth();

    await expect(mw(args, makeNext())).rejects.toBeInstanceOf(Response);
    expect(mockGetSession).not.toHaveBeenCalled();
  });
});
