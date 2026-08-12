import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StateData } from '@auth0/auth0-server-js';
import {
  getSession,
  requireSession,
  getUser,
  requireUser,
  getAccessToken,
  updateSession,
  deleteSession,
  createApiClient,
  _setAuth0Instance
} from '../../src/server/utils.js';
import { MissingSessionError, TokenError } from '../../src/errors/index.js';
import type { Auth0Server } from '../../src/server/auth0-server.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

const BASE_STATE_DATA: StateData = {
  user: { sub: 'auth0|123', name: 'Test User', email: 'test@example.com' },
  idToken: 'id-token',
  refreshToken: 'refresh-token',
  tokenSets: [
    {
      audience: 'default',
      accessToken: 'access-token',
      scope: 'openid profile email',
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    }
  ],
  internal: { sid: 'sid-123', createdAt: Math.floor(Date.now() / 1000) }
};

/**
 * Creates a mock Auth0Server for utils tests.
 * Pass field overrides to adjust specific return values.
 */
function makeAuth0(
  overrides: {
    sessionData?: StateData | undefined;
    storeData?: StateData | undefined;
    accessToken?: string;
  } = {}
): Auth0Server {
  return {
    serverClient: {
      getSession: vi.fn().mockResolvedValue(overrides.sessionData),
      getAccessToken: vi.fn().mockResolvedValue({
        accessToken: overrides.accessToken ?? 'test-access-token',
        audience: 'default',
        scope: 'openid profile email',
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      })
    },
    stateStore: {
      get: vi.fn().mockResolvedValue(overrides.storeData),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    },
    stateIdentifier: '__a0_session',
    config: {
      domain: 'test.auth0.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      secret: 'a-32-char-secret-xxxxxxxxxxxxxxx',
      appBaseUrl: 'http://localhost:3000',
      scope: 'openid profile email'
    }
  } as unknown as Auth0Server;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _setAuth0Instance(makeAuth0());
});

afterEach(() => {
  _setAuth0Instance(undefined);
  vi.unstubAllEnvs();
});

// ─── getSession ───────────────────────────────────────────────────────────────

describe('getSession', () => {
  it('returns null when no session exists', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: undefined }));
    const result = await getSession(makeRequest('http://localhost:3000/'));
    expect(result).toBeNull();
  });

  it('returns a mapped Auth0Session when a session exists', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: BASE_STATE_DATA }));
    const result = await getSession(makeRequest('http://localhost:3000/'));

    expect(result).not.toBeNull();
    expect(result!.user.sub).toBe('auth0|123');
    expect(result!.user.name).toBe('Test User');
    expect(result!.idToken).toBe('id-token');
    expect(result!.refreshToken).toBe('refresh-token');
    expect(result!.tokenSets).toHaveLength(1);
    expect(result!.tokenSets[0].accessToken).toBe('access-token');
  });

  it('falls back to config domain when session carries no domain', async () => {
    const data: StateData = { ...BASE_STATE_DATA, domain: undefined };
    _setAuth0Instance(makeAuth0({ sessionData: data }));
    const result = await getSession(makeRequest('http://localhost:3000/'));
    expect(result!.domain).toBe('test.auth0.com');
  });

  it('uses the domain from the session when present', async () => {
    const data: StateData = { ...BASE_STATE_DATA, domain: 'custom.auth0.com' };
    _setAuth0Instance(makeAuth0({ sessionData: data }));
    const result = await getSession(makeRequest('http://localhost:3000/'));
    expect(result!.domain).toBe('custom.auth0.com');
  });

  it('returns null when session data has no user', async () => {
    const data: StateData = { ...BASE_STATE_DATA, user: undefined };
    _setAuth0Instance(makeAuth0({ sessionData: data }));
    const result = await getSession(makeRequest('http://localhost:3000/'));
    expect(result).toBeNull();
  });
});

// ─── requireSession ───────────────────────────────────────────────────────────

describe('requireSession', () => {
  it('returns the session when the user is authenticated', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: BASE_STATE_DATA }));
    const result = await requireSession(
      makeRequest('http://localhost:3000/dashboard')
    );
    expect(result.user.sub).toBe('auth0|123');
  });

  it('throws a 302 Response when not authenticated', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: undefined }));
    const request = makeRequest('http://localhost:3000/dashboard');
    await expect(requireSession(request)).rejects.toBeInstanceOf(Response);
  });

  it('redirects to /auth/login by default', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: undefined }));
    const request = makeRequest('http://localhost:3000/dashboard');
    let response: Response | undefined;
    try {
      await requireSession(request);
    } catch (e) {
      response = e as Response;
    }
    expect(response!.status).toBe(302);
    expect(response!.headers.get('Location')).toContain('/auth/login');
  });

  it('encodes the current pathname as returnTo', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: undefined }));
    const request = makeRequest('http://localhost:3000/settings/profile');
    let response: Response | undefined;
    try {
      await requireSession(request);
    } catch (e) {
      response = e as Response;
    }
    const location = response!.headers.get('Location')!;
    expect(location).toContain(encodeURIComponent('/settings/profile'));
  });

  it('includes query params in the default returnTo', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: undefined }));
    const request = makeRequest('http://localhost:3000/search?q=hello&page=2');
    let response: Response | undefined;
    try {
      await requireSession(request);
    } catch (e) {
      response = e as Response;
    }
    const location = response!.headers.get('Location')!;
    expect(location).toContain(encodeURIComponent('/search?q=hello&page=2'));
  });

  it('uses the AUTH0_LOGIN_PATH env var when set', async () => {
    vi.stubEnv('AUTH0_LOGIN_PATH', '/login');
    _setAuth0Instance(makeAuth0({ sessionData: undefined }));
    let response: Response | undefined;
    try {
      await requireSession(makeRequest('http://localhost:3000/dashboard'));
    } catch (e) {
      response = e as Response;
    }
    expect(response!.headers.get('Location')).toContain('/login?returnTo=');
  });

  it('appends returnTo correctly when AUTH0_LOGIN_PATH already has a query string', async () => {
    vi.stubEnv('AUTH0_LOGIN_PATH', '/login?locale=en');
    _setAuth0Instance(makeAuth0({ sessionData: undefined }));
    let response: Response | undefined;
    try {
      await requireSession(makeRequest('http://localhost:3000/dashboard'));
    } catch (e) {
      response = e as Response;
    }
    const location = response!.headers.get('Location')!;
    // Must be a valid URL — only one '?' present
    expect(location.split('?').length).toBe(2);
    expect(location).toContain('locale=en');
    expect(location).toContain('returnTo=');
  });

  it('uses a custom returnTo when provided', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: undefined }));
    let response: Response | undefined;
    try {
      await requireSession(makeRequest('http://localhost:3000/dashboard'), {
        returnTo: '/home'
      });
    } catch (e) {
      response = e as Response;
    }
    expect(response!.headers.get('Location')).toContain(
      encodeURIComponent('/home')
    );
  });
});

// ─── getUser ──────────────────────────────────────────────────────────────────

describe('getUser', () => {
  it('returns null when there is no session', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: undefined }));
    const result = await getUser(makeRequest('http://localhost:3000/'));
    expect(result).toBeNull();
  });

  it('returns the user when authenticated', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: BASE_STATE_DATA }));
    const result = await getUser(makeRequest('http://localhost:3000/'));
    expect(result!.sub).toBe('auth0|123');
    expect(result!.email).toBe('test@example.com');
  });
});

// ─── requireUser ──────────────────────────────────────────────────────────────

describe('requireUser', () => {
  it('returns the user when authenticated', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: BASE_STATE_DATA }));
    const result = await requireUser(makeRequest('http://localhost:3000/'));
    expect(result.sub).toBe('auth0|123');
  });

  it('throws a 302 Response when not authenticated', async () => {
    _setAuth0Instance(makeAuth0({ sessionData: undefined }));
    await expect(
      requireUser(makeRequest('http://localhost:3000/profile'))
    ).rejects.toBeInstanceOf(Response);
  });
});

// ─── getAccessToken ───────────────────────────────────────────────────────────

describe('getAccessToken', () => {
  it('returns the access token string', async () => {
    _setAuth0Instance(makeAuth0({ accessToken: 'my-token' }));
    const token = await getAccessToken(makeRequest('http://localhost:3000/'));
    expect(token).toBe('my-token');
  });

  it('deduplicates parallel calls on the same request object', async () => {
    const getAccessTokenFn = vi.fn().mockResolvedValue({
      accessToken: 'deduped-token',
      audience: 'default',
      scope: 'openid',
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    });
    const auth0 = makeAuth0();
    (auth0.serverClient.getAccessToken as ReturnType<typeof vi.fn>) =
      getAccessTokenFn;
    _setAuth0Instance(auth0);

    const request = makeRequest('http://localhost:3000/');
    const [t1, t2, t3] = await Promise.all([
      getAccessToken(request),
      getAccessToken(request),
      getAccessToken(request)
    ]);

    expect(t1).toBe('deduped-token');
    expect(t2).toBe('deduped-token');
    expect(t3).toBe('deduped-token');
    expect(getAccessTokenFn).toHaveBeenCalledTimes(1);
  });

  it('makes separate calls for different request objects', async () => {
    const getAccessTokenFn = vi.fn().mockResolvedValue({
      accessToken: 'separate-token',
      audience: 'default',
      scope: 'openid',
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    });
    const auth0 = makeAuth0();
    (auth0.serverClient.getAccessToken as ReturnType<typeof vi.fn>) =
      getAccessTokenFn;
    _setAuth0Instance(auth0);

    await getAccessToken(makeRequest('http://localhost:3000/a'));
    await getAccessToken(makeRequest('http://localhost:3000/b'));

    expect(getAccessTokenFn).toHaveBeenCalledTimes(2);
  });

  it('throws TokenError when the underlying call fails', async () => {
    const getAccessTokenFn = vi
      .fn()
      .mockRejectedValue(new Error('no refresh token'));
    const auth0 = makeAuth0();
    (auth0.serverClient.getAccessToken as ReturnType<typeof vi.fn>) =
      getAccessTokenFn;
    _setAuth0Instance(auth0);

    await expect(
      getAccessToken(makeRequest('http://localhost:3000/'))
    ).rejects.toBeInstanceOf(TokenError);
  });

  it('TokenError message reflects the underlying error', async () => {
    const getAccessTokenFn = vi
      .fn()
      .mockRejectedValue(new Error('token expired'));
    const auth0 = makeAuth0();
    (auth0.serverClient.getAccessToken as ReturnType<typeof vi.fn>) =
      getAccessTokenFn;
    _setAuth0Instance(auth0);

    await expect(
      getAccessToken(makeRequest('http://localhost:3000/'))
    ).rejects.toThrow('token expired');
  });
});

// ─── updateSession ────────────────────────────────────────────────────────────

describe('updateSession', () => {
  it('throws MissingSessionError when there is no active session', async () => {
    _setAuth0Instance(makeAuth0({ storeData: undefined }));
    await expect(
      updateSession(makeRequest('http://localhost:3000/'), {
        user: { sub: 'new-sub' }
      })
    ).rejects.toBeInstanceOf(MissingSessionError);
  });

  it('merges user update into the session and writes it back', async () => {
    const auth0 = makeAuth0({ storeData: BASE_STATE_DATA });
    _setAuth0Instance(auth0);

    await updateSession(makeRequest('http://localhost:3000/'), {
      user: { sub: 'auth0|123', name: 'Updated Name' }
    });

    const setCall = (auth0.stateStore.set as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(setCall[1].user.name).toBe('Updated Name');
  });

  it('preserves existing fields that are not in updates', async () => {
    const auth0 = makeAuth0({ storeData: BASE_STATE_DATA });
    _setAuth0Instance(auth0);

    await updateSession(makeRequest('http://localhost:3000/'), {
      user: { sub: 'auth0|123', name: 'Updated Name' }
    });

    const setCall = (auth0.stateStore.set as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(setCall[1].refreshToken).toBe('refresh-token');
    expect(setCall[1].internal).toEqual(BASE_STATE_DATA.internal);
  });

  it('returns a Response (for Set-Cookie propagation)', async () => {
    _setAuth0Instance(makeAuth0({ storeData: BASE_STATE_DATA }));
    const result = await updateSession(makeRequest('http://localhost:3000/'), {
      user: { sub: 'auth0|123' }
    });
    expect(result).toBeInstanceOf(Response);
  });
});

// ─── deleteSession ────────────────────────────────────────────────────────────

describe('deleteSession', () => {
  it('calls stateStore.delete with the correct identifier', async () => {
    const auth0 = makeAuth0();
    _setAuth0Instance(auth0);

    await deleteSession(makeRequest('http://localhost:3000/'));

    expect(auth0.stateStore.delete).toHaveBeenCalledWith(
      '__a0_session',
      expect.objectContaining({ request: expect.any(Request) })
    );
  });

  it('returns a Response (for Set-Cookie propagation)', async () => {
    const result = await deleteSession(makeRequest('http://localhost:3000/'));
    expect(result).toBeInstanceOf(Response);
  });
});

// ─── createApiClient ──────────────────────────────────────────────────────────

describe('createApiClient', () => {
  it('attaches a Bearer token to every request', async () => {
    _setAuth0Instance(makeAuth0({ accessToken: 'api-token' }));
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient(makeRequest('http://localhost:3000/'));
    await api('https://api.example.com/data');

    const [, init] = mockFetch.mock.calls[0];
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer api-token'
    );
  });

  it('prepends baseUrl when provided', async () => {
    _setAuth0Instance(makeAuth0({ accessToken: 'api-token' }));
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient(makeRequest('http://localhost:3000/'), {
      baseUrl: 'https://api.example.com'
    });
    await api('/users/me');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/users/me');
  });

  it('preserves custom headers from a plain object', async () => {
    _setAuth0Instance(makeAuth0({ accessToken: 'api-token' }));
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient(makeRequest('http://localhost:3000/'));
    await api('https://api.example.com/data', {
      headers: { 'X-Custom': 'value' }
    });

    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer api-token');
    expect(headers.get('X-Custom')).toBe('value');
  });

  it('preserves custom headers from a Headers instance', async () => {
    _setAuth0Instance(makeAuth0({ accessToken: 'api-token' }));
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient(makeRequest('http://localhost:3000/'));
    await api('https://api.example.com/data', {
      headers: new Headers({ 'X-Custom': 'from-headers' })
    });

    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer api-token');
    expect(headers.get('X-Custom')).toBe('from-headers');
  });

  it('preserves custom headers from a [string, string][] array', async () => {
    _setAuth0Instance(makeAuth0({ accessToken: 'api-token' }));
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient(makeRequest('http://localhost:3000/'));
    await api('https://api.example.com/data', {
      headers: [['X-Custom', 'from-array']]
    });

    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer api-token');
    expect(headers.get('X-Custom')).toBe('from-array');
  });
});
