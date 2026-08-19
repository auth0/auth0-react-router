import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Auth0Server } from '../../src/server/auth0-server.js';
import { ConfigurationError } from '../../src/errors/index.js';

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
    it('throws ConfigurationError when domain is missing', () => {
      const { domain: _, ...rest } = validConfig;
      expect(() => new Auth0Server(rest)).toThrowError(ConfigurationError);
    });

    it('throws ConfigurationError when clientId is missing', () => {
      const { clientId: _, ...rest } = validConfig;
      expect(() => new Auth0Server(rest)).toThrowError(ConfigurationError);
    });

    it('throws ConfigurationError when clientSecret is missing', () => {
      const { clientSecret: _, ...rest } = validConfig;
      expect(() => new Auth0Server(rest)).toThrowError(ConfigurationError);
    });

    it('throws ConfigurationError when secret is missing', () => {
      const { secret: _, ...rest } = validConfig;
      expect(() => new Auth0Server(rest)).toThrowError(ConfigurationError);
    });

    it('does not throw when appBaseUrl is missing (inferred from request at runtime)', () => {
      const { appBaseUrl: _, ...rest } = validConfig;
      expect(() => new Auth0Server(rest)).not.toThrow();
    });

    it('error message names the missing env var', () => {
      const { domain: _, ...rest } = validConfig;
      expect(() => new Auth0Server(rest)).toThrow('AUTH0_DOMAIN');
    });

    it('error message tells the developer where to find the value', () => {
      const { domain: _, ...rest } = validConfig;
      expect(() => new Auth0Server(rest)).toThrow('Auth0 Dashboard');
    });

    it('error message lists ALL missing fields at once', () => {
      try {
        new Auth0Server({});
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
        new Auth0Server({});
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as ConfigurationError).statusCode).toBe(500);
      }
    });
  });
});
