import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReactRouterCookieHandler } from '../../src/server/cookie-handler.js';

function makeRequest(
  cookieString: string,
  url = 'http://example.com/'
): Request {
  return new Request(url, {
    headers: cookieString ? { Cookie: cookieString } : {}
  });
}

function makeResponse(): Response {
  return new Response();
}

describe('ReactRouterCookieHandler', () => {
  const handler = new ReactRouterCookieHandler();

  // ─── getCookies ─────────────────────────────────────────────────────────────

  describe('getCookies', () => {
    it('parses all cookies from the request header', () => {
      const request = makeRequest('__session=abc123; theme=dark');
      const result = handler.getCookies({ request, response: makeResponse() });
      expect(result).toEqual({ __session: 'abc123', theme: 'dark' });
    });

    it('returns an empty object when no cookies are present', () => {
      const result = handler.getCookies({
        request: makeRequest(''),
        response: makeResponse()
      });
      expect(result).toEqual({});
    });

    it('returns an empty object when storeOptions is not provided', () => {
      expect(handler.getCookies(undefined)).toEqual({});
    });
  });

  // ─── getCookie ──────────────────────────────────────────────────────────────

  describe('getCookie', () => {
    it('returns the value of a specific cookie', () => {
      const request = makeRequest('__session=abc123; theme=dark');
      const result = handler.getCookie('__session', {
        request,
        response: makeResponse()
      });
      expect(result).toBe('abc123');
    });

    it('returns undefined when the cookie does not exist', () => {
      const request = makeRequest('theme=dark');
      const result = handler.getCookie('__session', {
        request,
        response: makeResponse()
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined when storeOptions is not provided', () => {
      expect(handler.getCookie('__session', undefined)).toBeUndefined();
    });
  });

  // ─── setCookie ──────────────────────────────────────────────────────────────

  describe('setCookie', () => {
    it('appends a Set-Cookie header to the response', () => {
      const response = makeResponse();
      handler.setCookie(
        '__session',
        'token',
        { httpOnly: true, secure: true, sameSite: 'lax' },
        { request: makeRequest(''), response }
      );
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toContain('__session=token');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Lax');
    });

    it('defaults path to / when not provided', () => {
      const response = makeResponse();
      handler.setCookie(
        '__session',
        'token',
        {},
        { request: makeRequest(''), response }
      );
      expect(response.headers.get('Set-Cookie')).toContain('Path=/');
    });

    it('can set multiple cookies on the same response', () => {
      const response = makeResponse();
      handler.setCookie(
        '__session',
        'token1',
        {},
        { request: makeRequest(''), response }
      );
      handler.setCookie(
        '__a0_tx',
        'token2',
        {},
        { request: makeRequest(''), response }
      );
      const cookies = response.headers.getSetCookie();
      expect(cookies).toHaveLength(2);
      expect(cookies[0]).toContain('__session=token1');
      expect(cookies[1]).toContain('__a0_tx=token2');
    });

    it('does nothing when storeOptions is not provided', () => {
      expect(() =>
        handler.setCookie('name', 'value', {}, undefined)
      ).not.toThrow();
    });
  });

  // ─── deleteCookie ───────────────────────────────────────────────────────────

  describe('deleteCookie', () => {
    it('sets Max-Age=0 to tell the browser to remove the cookie', () => {
      const response = makeResponse();
      handler.deleteCookie('__a0_tx', { request: makeRequest(''), response });
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toContain('__a0_tx=');
      expect(setCookie).toContain('Max-Age=0');
    });

    it('does nothing when storeOptions is not provided', () => {
      expect(() => handler.deleteCookie('name', undefined)).not.toThrow();
    });

    it('strips Secure from delete header on localhost in development', () => {
      process.env['NODE_ENV'] = 'development';
      try {
        const response = makeResponse();
        const request = makeRequest('', 'http://localhost:3000/');
        handler.deleteCookie(
          '__session',
          { request, response },
          { secure: true }
        );
        const setCookie = response.headers.get('Set-Cookie');
        expect(setCookie).toContain('Max-Age=0');
        expect(setCookie).not.toContain('Secure');
      } finally {
        delete process.env['NODE_ENV'];
      }
    });
  });

  // ─── localhost secure:false auto-detection ──────────────────────────────────

  describe('localhost secure:false auto-detection', () => {
    beforeEach(() => {
      process.env['NODE_ENV'] = 'development';
    });
    afterEach(() => {
      delete process.env['NODE_ENV'];
    });

    it('forces secure:false on localhost even when options say secure:true', () => {
      const response = makeResponse();
      const request = makeRequest('', 'http://localhost:3000/');
      handler.setCookie(
        '__session',
        'token',
        { secure: true },
        { request, response }
      );
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).not.toContain('Secure');
    });

    it('forces secure:false on 127.0.0.1 even when options say secure:true', () => {
      const response = makeResponse();
      const request = makeRequest('', 'http://127.0.0.1:3000/');
      handler.setCookie(
        '__session',
        'token',
        { secure: true },
        { request, response }
      );
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).not.toContain('Secure');
    });

    it('preserves secure:true on non-localhost in development', () => {
      const response = makeResponse();
      const request = makeRequest('', 'https://staging.example.com/');
      handler.setCookie(
        '__session',
        'token',
        { secure: true },
        { request, response }
      );
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toContain('Secure');
    });

    it('preserves secure:true on localhost in production', () => {
      process.env['NODE_ENV'] = 'production';
      const response = makeResponse();
      const request = makeRequest('', 'http://localhost:3000/');
      handler.setCookie(
        '__session',
        'token',
        { secure: true },
        { request, response }
      );
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toContain('Secure');
    });
  });
});
