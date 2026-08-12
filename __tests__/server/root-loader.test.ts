import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import type { StateData } from '@auth0/auth0-server-js';
import { rootAuthLoader } from '../../src/server/root-loader.js';
import { _setAuth0Instance } from '../../src/server/utils.js';
import type { Auth0Server } from '../../src/server/auth0-server.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(url: string): Request {
  return new Request(url);
}

const AUTHENTICATED_STATE: StateData = {
  user: { sub: 'auth0|abc', name: 'Alice', email: 'alice@example.com' },
  idToken: 'id-token',
  refreshToken: 'refresh-token',
  tokenSets: [
    {
      audience: 'default',
      accessToken: 'access-token',
      scope: 'openid',
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    }
  ],
  internal: { sid: 'sid-1', createdAt: Math.floor(Date.now() / 1000) }
};

function makeAuth0(sessionData?: StateData): Auth0Server {
  return {
    serverClient: {
      getSession: vi.fn().mockResolvedValue(sessionData)
    },
    stateStore: {
      get: vi.fn().mockResolvedValue(undefined),
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
});

// ─── rootAuthLoader ───────────────────────────────────────────────────────────

describe('rootAuthLoader', () => {
  it('returns { session: null } when the visitor is not authenticated', async () => {
    _setAuth0Instance(makeAuth0(undefined));
    const result = await rootAuthLoader(makeRequest('http://localhost:3000/'));
    expect(result).toEqual({ session: null });
  });

  it('returns { session: { user } } when the visitor is authenticated', async () => {
    _setAuth0Instance(makeAuth0(AUTHENTICATED_STATE));
    const result = await rootAuthLoader(makeRequest('http://localhost:3000/'));
    expect(result.session).not.toBeNull();
    expect(result.session!.user.sub).toBe('auth0|abc');
    expect(result.session!.user.name).toBe('Alice');
  });

  it('never includes tokens in the returned session', async () => {
    _setAuth0Instance(makeAuth0(AUTHENTICATED_STATE));
    const result = await rootAuthLoader(makeRequest('http://localhost:3000/'));
    const session = result.session as Record<string, unknown>;
    expect(session).not.toHaveProperty('idToken');
    expect(session).not.toHaveProperty('refreshToken');
    expect(session).not.toHaveProperty('tokenSets');
    expect(session).not.toHaveProperty('accessToken');
  });

  it('merges callback data with the auth data', async () => {
    _setAuth0Instance(makeAuth0(AUTHENTICATED_STATE));
    const result = await rootAuthLoader(
      makeRequest('http://localhost:3000/'),
      async () => ({ featureFlags: ['new-ui'] })
    );
    expect(result.session).not.toBeNull();
    expect(result.featureFlags).toEqual(['new-ui']);
  });

  it('session key wins when the callback tries to overwrite it', async () => {
    _setAuth0Instance(makeAuth0(AUTHENTICATED_STATE));
    const result = await rootAuthLoader(
      makeRequest('http://localhost:3000/'),
      async () => ({ session: 'overwritten' })
    );
    expect(result.session).not.toBe('overwritten');
    expect(result.session!.user.sub).toBe('auth0|abc');
  });

  it('passes the auth data to the callback', async () => {
    _setAuth0Instance(makeAuth0(AUTHENTICATED_STATE));
    const callback = vi.fn().mockResolvedValue({});
    await rootAuthLoader(makeRequest('http://localhost:3000/'), callback);
    expect(callback).toHaveBeenCalledWith({
      session: expect.objectContaining({
        user: expect.objectContaining({ sub: 'auth0|abc' })
      })
    });
  });

  it('returns auth data directly when no callback is provided', async () => {
    _setAuth0Instance(makeAuth0(AUTHENTICATED_STATE));
    const result = await rootAuthLoader(makeRequest('http://localhost:3000/'));
    expect(Object.keys(result)).toEqual(['session']);
  });
});
