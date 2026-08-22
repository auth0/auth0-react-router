import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Auth0Server, HookedStateStore } from '../../src/server/auth0-server.js';
import { ConfigurationError } from '../../src/errors/index.js';
import type { Auth0Session } from '../../src/types/index.js';

const validConfig = {
  domain: 'test.auth0.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  secret: 'a-secret-that-is-at-least-32-characters-long',
  appBaseUrl: 'http://localhost:3000'
};

describe('Auth0Server', () => {
  // ─── Construction ───────────────────────────────────────────────────────────

  describe('construction', () => {
    it('creates successfully with valid options', () => {
      const auth0 = new Auth0Server(validConfig);
      expect(auth0).toBeDefined();
    });

    it('exposes a serverClient after construction', () => {
      const auth0 = new Auth0Server(validConfig);
      expect(auth0.serverClient).toBeDefined();
    });

    it('exposes the resolved config after construction', () => {
      const auth0 = new Auth0Server(validConfig);
      expect(auth0.config.domain).toBe('test.auth0.com');
      expect(auth0.config.clientId).toBe('test-client-id');
      expect(auth0.config.appBaseUrl).toBe('http://localhost:3000');
    });

    it('defaults scope to "openid profile email" when not provided', () => {
      const auth0 = new Auth0Server(validConfig);
      expect(auth0.config.scope).toBe('openid profile email');
    });

    it('accepts a custom scope', () => {
      const auth0 = new Auth0Server({
        ...validConfig,
        scope: 'openid profile email read:data'
      });
      expect(auth0.config.scope).toBe('openid profile email read:data');
    });

    it('makes zero network calls on construction', () => {
      // If the constructor made network calls this test would fail or hang
      // without a real Auth0 tenant. It completes instantly — no network needed.
      const start = Date.now();
      new Auth0Server(validConfig);
      expect(Date.now() - start).toBeLessThan(100);
    });
  });

  // ─── Config from environment variables ──────────────────────────────────────

  describe('reading from environment variables', () => {
    beforeEach(() => {
      process.env['AUTH0_DOMAIN'] = 'env-tenant.auth0.com';
      process.env['AUTH0_CLIENT_ID'] = 'env-client-id';
      process.env['AUTH0_CLIENT_SECRET'] = 'env-client-secret';
      process.env['AUTH0_SESSION_SECRET'] =
        'env-secret-that-is-at-least-32-characters-long';
      process.env['AUTH0_APP_BASE_URL'] = 'https://myapp.com';
    });

    afterEach(() => {
      delete process.env['AUTH0_DOMAIN'];
      delete process.env['AUTH0_CLIENT_ID'];
      delete process.env['AUTH0_CLIENT_SECRET'];
      delete process.env['AUTH0_SESSION_SECRET'];
      delete process.env['AUTH0_APP_BASE_URL'];
    });

    it('reads all required values from environment variables when no options are given', () => {
      const auth0 = new Auth0Server();
      expect(auth0.config.domain).toBe('env-tenant.auth0.com');
      expect(auth0.config.clientId).toBe('env-client-id');
      expect(auth0.config.appBaseUrl).toBe('https://myapp.com');
    });

    it('options take precedence over environment variables', () => {
      const auth0 = new Auth0Server({ domain: 'override.auth0.com' });
      expect(auth0.config.domain).toBe('override.auth0.com');
      expect(auth0.config.clientId).toBe('env-client-id');
    });
  });

  // ─── ConfigurationError ─────────────────────────────────────────────────────

  describe('ConfigurationError', () => {
    it('does not throw on construction when domain is missing — throws on first use', () => {
      const { domain: _, ...rest } = validConfig;
      const auth0 = new Auth0Server(rest);
      expect(() => auth0.config).toThrowError(ConfigurationError);
    });

    it('does not throw on construction when clientId is missing — throws on first use', () => {
      const { clientId: _, ...rest } = validConfig;
      const auth0 = new Auth0Server(rest);
      expect(() => auth0.config).toThrowError(ConfigurationError);
    });

    it('does not throw on construction when clientSecret is missing — throws on first use', () => {
      const { clientSecret: _, ...rest } = validConfig;
      const auth0 = new Auth0Server(rest);
      expect(() => auth0.config).toThrowError(ConfigurationError);
    });

    it('does not throw on construction when secret is missing — throws on first use', () => {
      const { secret: _, ...rest } = validConfig;
      const auth0 = new Auth0Server(rest);
      expect(() => auth0.config).toThrowError(ConfigurationError);
    });

    it('does not throw when appBaseUrl is missing (inferred from request at runtime)', () => {
      const { appBaseUrl: _, ...rest } = validConfig;
      expect(() => new Auth0Server(rest).config).not.toThrow();
    });

    it('error message names the missing env var', () => {
      const { domain: _, ...rest } = validConfig;
      expect(() => new Auth0Server(rest).config).toThrow('AUTH0_DOMAIN');
    });

    it('error message tells the developer where to find the value', () => {
      const { domain: _, ...rest } = validConfig;
      expect(() => new Auth0Server(rest).config).toThrow('Auth0 Dashboard');
    });

    it('error message lists ALL missing fields at once', () => {
      try {
        new Auth0Server({}).config;
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        const message = (err as ConfigurationError).message;
        expect(message).toContain('AUTH0_DOMAIN');
        expect(message).toContain('AUTH0_CLIENT_ID');
        expect(message).toContain('AUTH0_CLIENT_SECRET');
        expect(message).toContain('AUTH0_SESSION_SECRET');
      }
    });

    it('thrown error has statusCode 500', () => {
      try {
        new Auth0Server({}).config;
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as ConfigurationError).statusCode).toBe(500);
      }
    });
  });

  // ─── Hooks ──────────────────────────────────────────────────────────────────

  describe('hooks', () => {
    it('accepts a beforeSessionSaved hook without throwing', () => {
      const auth0 = new Auth0Server({
        ...validConfig,
        beforeSessionSaved: session => session
      });
      expect(auth0).toBeDefined();
    });

    it('accepts an onCallback hook and exposes it', () => {
      const hook = vi.fn();
      const auth0 = new Auth0Server({ ...validConfig, onCallback: hook });
      expect(auth0.onCallback).toBe(hook);
    });

    it('onCallback is undefined when not provided', () => {
      const auth0 = new Auth0Server(validConfig);
      expect(auth0.onCallback).toBeUndefined();
    });
  });
});

// ─── HookedStateStore ─────────────────────────────────────────────────────────

function makeMockInner() {
  return {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined)
  };
}

function makeSessionData() {
  return {
    user: { sub: 'auth0|1', name: 'Test User' },
    tokenSets: [],
    idToken: undefined,
    refreshToken: undefined,
    domain: 'test.auth0.com'
  };
}

describe('HookedStateStore', () => {
  it('calls the inner store set without modification when no hook is provided', async () => {
    const inner = makeMockInner();
    const store = new HookedStateStore(inner as never);
    const data = makeSessionData();
    const cookieJar = new Response();

    await store.set('key', data as never, false, {
      request: new Request('http://localhost'),
      response: cookieJar
    });

    expect(inner.set).toHaveBeenCalledWith('key', expect.objectContaining({ user: data.user }), false, expect.any(Object));
  });

  it('calls beforeSessionSaved and writes the modified session', async () => {
    const inner = makeMockInner();
    const beforeSessionSaved = vi.fn((s: Auth0Session) => ({
      ...s,
      user: { ...s.user, name: 'Modified' }
    }));
    const store = new HookedStateStore(inner as never, beforeSessionSaved);
    const data = makeSessionData();
    const cookieJar = new Response();

    await store.set('key', data as never, false, {
      request: new Request('http://localhost'),
      response: cookieJar
    });

    expect(beforeSessionSaved).toHaveBeenCalled();
    expect(inner.set).toHaveBeenCalledWith(
      'key',
      expect.objectContaining({ user: expect.objectContaining({ name: 'Modified' }) }),
      false,
      expect.any(Object)
    );
  });

  it('captures the session keyed by the cookieJar response', async () => {
    const inner = makeMockInner();
    const store = new HookedStateStore(inner as never);
    const data = makeSessionData();
    const cookieJar = new Response();

    await store.set('key', data as never, false, {
      request: new Request('http://localhost'),
      response: cookieJar
    });

    const captured = store.getCaptured(cookieJar);
    expect(captured?.user.sub).toBe('auth0|1');
  });

  it('getCaptured returns null for an unknown cookieJar', () => {
    const inner = makeMockInner();
    const store = new HookedStateStore(inner as never);
    expect(store.getCaptured(new Response())).toBeNull();
  });

  it('different cookieJars do not share captured data', async () => {
    const inner = makeMockInner();
    const store = new HookedStateStore(inner as never);
    const jarA = new Response();
    const jarB = new Response();

    await store.set('key', makeSessionData() as never, false, {
      request: new Request('http://localhost'),
      response: jarA
    });

    expect(store.getCaptured(jarA)).not.toBeNull();
    expect(store.getCaptured(jarB)).toBeNull();
  });

  it('delegates get to the inner store', async () => {
    const inner = makeMockInner();
    inner.get.mockResolvedValue({ user: { sub: 'auth0|1' } });
    const store = new HookedStateStore(inner as never);

    const result = await store.get('key', { request: new Request('http://localhost'), response: new Response() });

    expect(inner.get).toHaveBeenCalledWith('key', expect.any(Object));
    expect(result).toEqual({ user: { sub: 'auth0|1' } });
  });

  it('delegates delete to the inner store', async () => {
    const inner = makeMockInner();
    const store = new HookedStateStore(inner as never);

    await store.delete('key', { request: new Request('http://localhost'), response: new Response() });

    expect(inner.delete).toHaveBeenCalledWith('key', expect.any(Object));
  });
});
