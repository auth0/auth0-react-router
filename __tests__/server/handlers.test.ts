import { describe, it, expect, vi } from 'vitest';
import {
  MissingTransactionError,
  BackchannelLogoutError
} from '@auth0/auth0-server-js';
import {
  handleLogin,
  handleCallback,
  handleLogout,
  handleBackchannelLogout,
  handleAuth,
  stripIdTokenClaims
} from '../../src/server/handlers.js';
import { CallbackError } from '../../src/errors/index.js';
import type { Auth0Server } from '../../src/server/auth0-server.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(
  url: string,
  options: RequestInit & { formData?: Record<string, string> } = {}
): Request {
  if (options.formData) {
    const body = new URLSearchParams(options.formData).toString();
    return new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
  }
  return new Request(url, options);
}

/**
 * Creates a mock Auth0Server. Pass overrides to replace specific serverClient methods.
 */
function makeAuth0(
  overrides: Partial<{
    startInteractiveLogin: ReturnType<typeof vi.fn>;
    completeInteractiveLogin: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    handleBackchannelLogout: ReturnType<typeof vi.fn>;
    appBaseUrl: string | undefined;
  }> = {}
): Auth0Server {
  return {
    serverClient: {
      startInteractiveLogin:
        overrides.startInteractiveLogin ??
        vi
          .fn()
          .mockResolvedValue(
            new URL('https://test.auth0.com/authorize?client_id=abc')
          ),
      completeInteractiveLogin:
        overrides.completeInteractiveLogin ??
        vi.fn().mockResolvedValue({ appState: { returnTo: '/dashboard' } }),
      logout:
        overrides.logout ??
        vi
          .fn()
          .mockResolvedValue(
            new URL('https://test.auth0.com/v2/logout?client_id=abc')
          ),
      handleBackchannelLogout:
        overrides.handleBackchannelLogout ??
        vi.fn().mockResolvedValue(undefined)
    },
    config: {
      appBaseUrl: 'appBaseUrl' in overrides ? overrides.appBaseUrl : 'http://localhost:3000',
      domain: 'test.auth0.com',
      clientId: 'abc',
      clientSecret: 'secret',
      secret: 'a-32-char-secret-xxxxxxxxxxxxxxx',
      scope: 'openid profile email'
    }
  } as unknown as Auth0Server;
}

// ─── handleLogin ──────────────────────────────────────────────────────────────

describe('handleLogin', () => {
  it('returns a 302 redirect to the Auth0 authorization URL', async () => {
    const auth0 = makeAuth0();
    const response = await handleLogin(
      auth0,
      makeRequest('http://localhost:3000/auth/login')
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://test.auth0.com/authorize?client_id=abc'
    );
  });

  it('passes returnTo from options as appState', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin });

    await handleLogin(auth0, makeRequest('http://localhost:3000/auth/login'), {
      returnTo: '/profile'
    });

    expect(startInteractiveLogin).toHaveBeenCalledWith(
      expect.objectContaining({ appState: { returnTo: '/profile' } }),
      expect.any(Object)
    );
  });

  it('reads returnTo from the request URL query string', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin });

    await handleLogin(
      auth0,
      makeRequest('http://localhost:3000/auth/login?returnTo=/settings')
    );

    expect(startInteractiveLogin).toHaveBeenCalledWith(
      expect.objectContaining({ appState: { returnTo: '/settings' } }),
      expect.any(Object)
    );
  });

  it('defaults returnTo to / when not provided anywhere', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin });

    await handleLogin(auth0, makeRequest('http://localhost:3000/auth/login'));

    expect(startInteractiveLogin).toHaveBeenCalledWith(
      expect.objectContaining({ appState: { returnTo: '/' } }),
      expect.any(Object)
    );
  });

  it('option returnTo takes precedence over query string returnTo', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin });

    await handleLogin(
      auth0,
      makeRequest('http://localhost:3000/auth/login?returnTo=/from-query'),
      { returnTo: '/from-options' }
    );

    expect(startInteractiveLogin).toHaveBeenCalledWith(
      expect.objectContaining({ appState: { returnTo: '/from-options' } }),
      expect.any(Object)
    );
  });

  it('passes authorizationParams through to startInteractiveLogin', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin });

    await handleLogin(auth0, makeRequest('http://localhost:3000/auth/login'), {
      authorizationParams: { prompt: 'login', screen_hint: 'signup' }
    });

    expect(startInteractiveLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationParams: expect.objectContaining({ prompt: 'login', screen_hint: 'signup' })
      }),
      expect.any(Object)
    );
  });

  it('always passes redirect_uri derived from appBaseUrl to startInteractiveLogin', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin });

    await handleLogin(auth0, makeRequest('http://localhost:3000/auth/login'));

    expect(startInteractiveLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationParams: expect.objectContaining({
          redirect_uri: 'http://localhost:3000/auth/callback'
        })
      }),
      expect.any(Object)
    );
  });

  it('infers redirect_uri from the request origin when appBaseUrl is not configured', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin, appBaseUrl: undefined });

    await handleLogin(auth0, makeRequest('https://myapp.com/auth/login'));

    expect(startInteractiveLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationParams: expect.objectContaining({
          redirect_uri: 'https://myapp.com/auth/callback'
        })
      }),
      expect.any(Object)
    );
  });

  it('ignores an absolute returnTo from the query string and falls back to /', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin });

    await handleLogin(
      auth0,
      makeRequest('http://localhost:3000/auth/login?returnTo=https://evil.com')
    );

    expect(startInteractiveLogin).toHaveBeenCalledWith(
      expect.objectContaining({ appState: { returnTo: '/' } }),
      expect.any(Object)
    );
  });

  it('ignores a protocol-relative returnTo from the query string and falls back to /', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin });

    await handleLogin(
      auth0,
      makeRequest('http://localhost:3000/auth/login?returnTo=//evil.com')
    );

    expect(startInteractiveLogin).toHaveBeenCalledWith(
      expect.objectContaining({ appState: { returnTo: '/' } }),
      expect.any(Object)
    );
  });

  it('ignores a backslash-prefixed returnTo from the query string and falls back to /', async () => {
    // Browsers normalize /\evil.com to //evil.com (protocol-relative), enabling open redirect.
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin });

    await handleLogin(
      auth0,
      makeRequest('http://localhost:3000/auth/login?returnTo=%2F%5Cevil.com')
    );

    expect(startInteractiveLogin).toHaveBeenCalledWith(
      expect.objectContaining({ appState: { returnTo: '/' } }),
      expect.any(Object)
    );
  });

  it('copies Set-Cookie headers from the transaction store onto the redirect', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockImplementation(async (_opts, storeOptions) => {
        storeOptions.response.headers.append(
          'Set-Cookie',
          '__a0_tx=txvalue; HttpOnly; Path=/'
        );
        return new URL('https://test.auth0.com/authorize');
      });
    const auth0 = makeAuth0({ startInteractiveLogin });

    const response = await handleLogin(
      auth0,
      makeRequest('http://localhost:3000/auth/login')
    );

    expect(response.headers.getSetCookie()).toContain(
      '__a0_tx=txvalue; HttpOnly; Path=/'
    );
  });
});

// ─── handleCallback ───────────────────────────────────────────────────────────

describe('handleCallback', () => {
  it('returns a 302 redirect to appState.returnTo on success', async () => {
    const auth0 = makeAuth0({
      completeInteractiveLogin: vi
        .fn()
        .mockResolvedValue({ appState: { returnTo: '/dashboard' } })
    });

    const response = await handleCallback(
      auth0,
      makeRequest('http://localhost:3000/auth/callback?code=abc&state=xyz')
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/dashboard');
  });

  it('falls back to options.returnTo when appState has no returnTo', async () => {
    const auth0 = makeAuth0({
      completeInteractiveLogin: vi
        .fn()
        .mockResolvedValue({ appState: undefined })
    });

    const response = await handleCallback(
      auth0,
      makeRequest('http://localhost:3000/auth/callback?code=abc&state=xyz'),
      { returnTo: '/fallback' }
    );

    expect(response.headers.get('Location')).toBe('/fallback');
  });

  it('falls back to / when neither appState nor options provide returnTo', async () => {
    const auth0 = makeAuth0({
      completeInteractiveLogin: vi
        .fn()
        .mockResolvedValue({ appState: undefined })
    });

    const response = await handleCallback(
      auth0,
      makeRequest('http://localhost:3000/auth/callback?code=abc&state=xyz')
    );

    expect(response.headers.get('Location')).toBe('/');
  });

  it('copies Set-Cookie headers from the session store onto the redirect', async () => {
    const completeInteractiveLogin = vi
      .fn()
      .mockImplementation(async (_url, storeOptions) => {
        storeOptions.response.headers.append(
          'Set-Cookie',
          '__a0_session=s1; HttpOnly; Path=/'
        );
        return { appState: { returnTo: '/' } };
      });
    const auth0 = makeAuth0({ completeInteractiveLogin });

    const response = await handleCallback(
      auth0,
      makeRequest('http://localhost:3000/auth/callback?code=abc&state=xyz')
    );

    expect(response.headers.getSetCookie()).toContain(
      '__a0_session=s1; HttpOnly; Path=/'
    );
  });

  it('throws CallbackError when the transaction is missing', async () => {
    const auth0 = makeAuth0({
      completeInteractiveLogin: vi
        .fn()
        .mockRejectedValue(new MissingTransactionError())
    });

    await expect(
      handleCallback(
        auth0,
        makeRequest('http://localhost:3000/auth/callback?code=abc&state=xyz')
      )
    ).rejects.toThrow(CallbackError);
  });

  it('CallbackError for missing transaction has an actionable message', async () => {
    const auth0 = makeAuth0({
      completeInteractiveLogin: vi
        .fn()
        .mockRejectedValue(new MissingTransactionError())
    });

    await expect(
      handleCallback(
        auth0,
        makeRequest('http://localhost:3000/auth/callback?code=abc&state=xyz')
      )
    ).rejects.toThrow('/auth/login');
  });

  it('throws CallbackError for other completeInteractiveLogin errors', async () => {
    const auth0 = makeAuth0({
      completeInteractiveLogin: vi
        .fn()
        .mockRejectedValue(new Error('token exchange failed'))
    });

    await expect(
      handleCallback(
        auth0,
        makeRequest('http://localhost:3000/auth/callback?code=abc&state=xyz')
      )
    ).rejects.toThrow(CallbackError);
  });
});

// ─── handleLogout ─────────────────────────────────────────────────────────────

describe('handleLogout', () => {
  it('returns a 302 redirect to the Auth0 logout URL on POST', async () => {
    const auth0 = makeAuth0();
    const request = makeRequest('http://localhost:3000/auth/logout', {
      method: 'POST'
    });

    const response = await handleLogout(auth0, request);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://test.auth0.com/v2/logout?client_id=abc'
    );
  });

  it('returns 405 for a GET request', async () => {
    const auth0 = makeAuth0();
    const request = makeRequest('http://localhost:3000/auth/logout', {
      method: 'GET'
    });

    const response = await handleLogout(auth0, request);

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('returns 405 for methods other than POST', async () => {
    const auth0 = makeAuth0();

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const response = await handleLogout(
        auth0,
        makeRequest('http://localhost:3000/auth/logout', { method })
      );
      expect(response.status).toBe(405);
    }
  });

  it('does not call serverClient.logout for non-POST requests', async () => {
    const logoutFn = vi.fn();
    const auth0 = makeAuth0({ logout: logoutFn });

    await handleLogout(
      auth0,
      makeRequest('http://localhost:3000/auth/logout', { method: 'GET' })
    );

    expect(logoutFn).not.toHaveBeenCalled();
  });

  it('passes options.returnTo to serverClient.logout', async () => {
    const logoutFn = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/v2/logout'));
    const auth0 = makeAuth0({ logout: logoutFn });

    await handleLogout(
      auth0,
      makeRequest('http://localhost:3000/auth/logout', { method: 'POST' }),
      { returnTo: 'https://myapp.com/goodbye' }
    );

    expect(logoutFn).toHaveBeenCalledWith(
      { returnTo: 'https://myapp.com/goodbye' },
      expect.any(Object)
    );
  });

  it('reads a relative returnTo from the request query string and resolves it against the app origin', async () => {
    const logoutFn = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/v2/logout'));
    const auth0 = makeAuth0({ logout: logoutFn });

    await handleLogout(
      auth0,
      makeRequest('http://localhost:3000/auth/logout?returnTo=%2Fsigned-out', {
        method: 'POST'
      })
    );

    expect(logoutFn).toHaveBeenCalledWith(
      { returnTo: 'http://localhost:3000/signed-out' },
      expect.any(Object)
    );
  });

  it('options.returnTo takes precedence over the query string', async () => {
    const logoutFn = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/v2/logout'));
    const auth0 = makeAuth0({ logout: logoutFn });

    await handleLogout(
      auth0,
      makeRequest('http://localhost:3000/auth/logout?returnTo=%2Ffrom-query', {
        method: 'POST'
      }),
      { returnTo: 'https://myapp.com/explicit' }
    );

    expect(logoutFn).toHaveBeenCalledWith(
      { returnTo: 'https://myapp.com/explicit' },
      expect.any(Object)
    );
  });

  it('defaults returnTo to the app base URL origin', async () => {
    const logoutFn = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/v2/logout'));
    const auth0 = makeAuth0({ logout: logoutFn });

    await handleLogout(
      auth0,
      makeRequest('http://localhost:3000/auth/logout', { method: 'POST' })
    );

    expect(logoutFn).toHaveBeenCalledWith(
      { returnTo: 'http://localhost:3000' },
      expect.any(Object)
    );
  });

  it('infers returnTo from the request origin when appBaseUrl is not configured', async () => {
    const logoutFn = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/v2/logout'));
    const auth0 = makeAuth0({ logout: logoutFn, appBaseUrl: undefined });

    await handleLogout(
      auth0,
      makeRequest('https://myapp.com/auth/logout', { method: 'POST' })
    );

    expect(logoutFn).toHaveBeenCalledWith(
      { returnTo: 'https://myapp.com' },
      expect.any(Object)
    );
  });

  it('copies Set-Cookie headers (cleared session) onto the redirect', async () => {
    const logoutFn = vi.fn().mockImplementation(async (_opts, storeOptions) => {
      storeOptions.response.headers.append(
        'Set-Cookie',
        '__a0_session=; Max-Age=0; Path=/'
      );
      return new URL('https://test.auth0.com/v2/logout');
    });
    const auth0 = makeAuth0({ logout: logoutFn });

    const response = await handleLogout(
      auth0,
      makeRequest('http://localhost:3000/auth/logout', { method: 'POST' })
    );

    expect(response.headers.getSetCookie()).toContain(
      '__a0_session=; Max-Age=0; Path=/'
    );
  });

  it('ignores an absolute returnTo query param (e.g. https://evil.com) and falls back to app origin', async () => {
    const logoutFn = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/v2/logout'));
    const auth0 = makeAuth0({ logout: logoutFn });

    await handleLogout(
      auth0,
      makeRequest(
        'http://localhost:3000/auth/logout?returnTo=https%3A%2F%2Fevil.com',
        { method: 'POST' }
      )
    );

    expect(logoutFn).toHaveBeenCalledWith(
      { returnTo: 'http://localhost:3000' },
      expect.any(Object)
    );
  });

  it('ignores a javascript: returnTo query param and falls back to app origin', async () => {
    const logoutFn = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/v2/logout'));
    const auth0 = makeAuth0({ logout: logoutFn });

    await handleLogout(
      auth0,
      makeRequest(
        'http://localhost:3000/auth/logout?returnTo=javascript%3Aalert(1)',
        { method: 'POST' }
      )
    );

    expect(logoutFn).toHaveBeenCalledWith(
      { returnTo: 'http://localhost:3000' },
      expect.any(Object)
    );
  });

  it('ignores a backslash-prefixed returnTo query param and falls back to app origin', async () => {
    const logoutFn = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/v2/logout'));
    const auth0 = makeAuth0({ logout: logoutFn });

    await handleLogout(
      auth0,
      makeRequest('http://localhost:3000/auth/logout?returnTo=%2F%5Cevil.com', {
        method: 'POST'
      })
    );

    expect(logoutFn).toHaveBeenCalledWith(
      { returnTo: 'http://localhost:3000' },
      expect.any(Object)
    );
  });

  it('ignores a malformed returnTo query param and falls back to app origin', async () => {
    const logoutFn = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/v2/logout'));
    const auth0 = makeAuth0({ logout: logoutFn });

    await handleLogout(
      auth0,
      makeRequest('http://localhost:3000/auth/logout?returnTo=not-a-url', {
        method: 'POST'
      })
    );

    expect(logoutFn).toHaveBeenCalledWith(
      { returnTo: 'http://localhost:3000' },
      expect.any(Object)
    );
  });
});

// ─── handleBackchannelLogout ──────────────────────────────────────────────────

describe('handleBackchannelLogout', () => {
  it('returns 405 for non-POST requests', async () => {
    const auth0 = makeAuth0();
    const request = makeRequest(
      'http://localhost:3000/auth/logout/backchannel',
      { method: 'GET' }
    );

    const response = await handleBackchannelLogout(auth0, request);

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('returns 204 when the logout token is valid', async () => {
    const auth0 = makeAuth0();
    const request = makeRequest(
      'http://localhost:3000/auth/logout/backchannel',
      {
        formData: { logout_token: 'valid.jwt.token' }
      }
    );

    const response = await handleBackchannelLogout(auth0, request);

    expect(response.status).toBe(204);
  });

  it('passes the logout_token to serverClient.handleBackchannelLogout', async () => {
    const handleBackchannelLogoutFn = vi.fn().mockResolvedValue(undefined);
    const auth0 = makeAuth0({
      handleBackchannelLogout: handleBackchannelLogoutFn
    });

    const request = makeRequest(
      'http://localhost:3000/auth/logout/backchannel',
      {
        formData: { logout_token: 'my.jwt.token' }
      }
    );

    await handleBackchannelLogout(auth0, request);

    expect(handleBackchannelLogoutFn).toHaveBeenCalledWith(
      'my.jwt.token',
      expect.any(Object)
    );
  });

  it('returns 400 when logout_token is missing from the body', async () => {
    const auth0 = makeAuth0();
    const request = makeRequest(
      'http://localhost:3000/auth/logout/backchannel',
      {
        formData: {}
      }
    );

    const response = await handleBackchannelLogout(auth0, request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when BackchannelLogoutError is thrown', async () => {
    const auth0 = makeAuth0({
      handleBackchannelLogout: vi
        .fn()
        .mockRejectedValue(new BackchannelLogoutError('invalid token'))
    });

    const request = makeRequest(
      'http://localhost:3000/auth/logout/backchannel',
      {
        formData: { logout_token: 'bad.token' }
      }
    );

    const response = await handleBackchannelLogout(auth0, request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when token verification fails with a generic error', async () => {
    const auth0 = makeAuth0({
      handleBackchannelLogout: vi
        .fn()
        .mockRejectedValue(new Error('JWT verification failed'))
    });

    const request = makeRequest(
      'http://localhost:3000/auth/logout/backchannel',
      {
        formData: { logout_token: 'bad.token' }
      }
    );

    const response = await handleBackchannelLogout(auth0, request);

    expect(response.status).toBe(400);
  });
});

// ─── handleAuth ───────────────────────────────────────────────────────────────

describe('handleAuth', () => {
  it('dispatches GET /auth/login to handleLogin', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin });

    const response = await handleAuth(
      auth0,
      makeRequest('http://localhost:3000/auth/login')
    );

    expect(startInteractiveLogin).toHaveBeenCalled();
    expect(response.status).toBe(302);
  });

  it('dispatches GET /auth/callback to handleCallback', async () => {
    const completeInteractiveLogin = vi
      .fn()
      .mockResolvedValue({ appState: { returnTo: '/dashboard' } });
    const auth0 = makeAuth0({ completeInteractiveLogin });

    const response = await handleAuth(
      auth0,
      makeRequest('http://localhost:3000/auth/callback?code=abc&state=xyz')
    );

    expect(completeInteractiveLogin).toHaveBeenCalled();
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/dashboard');
  });

  it('dispatches POST /auth/logout to handleLogout', async () => {
    const logoutFn = vi
      .fn()
      .mockResolvedValue(
        new URL('https://test.auth0.com/v2/logout?client_id=abc')
      );
    const auth0 = makeAuth0({ logout: logoutFn });

    const response = await handleAuth(
      auth0,
      makeRequest('http://localhost:3000/auth/logout', { method: 'POST' })
    );

    expect(logoutFn).toHaveBeenCalled();
    expect(response.status).toBe(302);
  });

  it('dispatches POST /auth/backchannel-logout to handleBackchannelLogout', async () => {
    const handleBackchannelLogoutFn = vi.fn().mockResolvedValue(undefined);
    const auth0 = makeAuth0({
      handleBackchannelLogout: handleBackchannelLogoutFn
    });

    const response = await handleAuth(
      auth0,
      makeRequest('http://localhost:3000/auth/backchannel-logout', {
        formData: { logout_token: 'valid.jwt.token' }
      })
    );

    expect(handleBackchannelLogoutFn).toHaveBeenCalled();
    expect(response.status).toBe(204);
  });

  it('/auth/backchannel-logout is not swallowed by the /logout branch', async () => {
    const logoutFn = vi.fn();
    const handleBackchannelLogoutFn = vi.fn().mockResolvedValue(undefined);
    const auth0 = makeAuth0({
      logout: logoutFn,
      handleBackchannelLogout: handleBackchannelLogoutFn
    });

    await handleAuth(
      auth0,
      makeRequest('http://localhost:3000/auth/backchannel-logout', {
        formData: { logout_token: 'valid.jwt.token' }
      })
    );

    expect(logoutFn).not.toHaveBeenCalled();
    expect(handleBackchannelLogoutFn).toHaveBeenCalled();
  });

  it('returns 404 for an unrecognised path', async () => {
    const auth0 = makeAuth0();

    const response = await handleAuth(
      auth0,
      makeRequest('http://localhost:3000/auth/unknown')
    );

    expect(response.status).toBe(404);
  });

  it('forwards login options to handleLogin', async () => {
    const startInteractiveLogin = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/authorize'));
    const auth0 = makeAuth0({ startInteractiveLogin });

    await handleAuth(auth0, makeRequest('http://localhost:3000/auth/login'), {
      login: { returnTo: '/after-login' }
    });

    expect(startInteractiveLogin).toHaveBeenCalledWith(
      expect.objectContaining({ appState: { returnTo: '/after-login' } }),
      expect.any(Object)
    );
  });

  it('forwards callback options to handleCallback', async () => {
    const completeInteractiveLogin = vi
      .fn()
      .mockResolvedValue({ appState: undefined });
    const auth0 = makeAuth0({ completeInteractiveLogin });

    const response = await handleAuth(
      auth0,
      makeRequest('http://localhost:3000/auth/callback?code=abc&state=xyz'),
      { callback: { returnTo: '/after-callback' } }
    );

    expect(response.headers.get('Location')).toBe('/after-callback');
  });

  it('forwards logout options to handleLogout', async () => {
    const logoutFn = vi
      .fn()
      .mockResolvedValue(new URL('https://test.auth0.com/v2/logout'));
    const auth0 = makeAuth0({ logout: logoutFn });

    await handleAuth(
      auth0,
      makeRequest('http://localhost:3000/auth/logout', { method: 'POST' }),
      { logout: { returnTo: 'https://myapp.com/bye' } }
    );

    expect(logoutFn).toHaveBeenCalledWith(
      { returnTo: 'https://myapp.com/bye' },
      expect.any(Object)
    );
  });
});

// ─── stripIdTokenClaims ───────────────────────────────────────────────────────

describe('stripIdTokenClaims', () => {
  it('removes iss, aud, exp, iat, nonce, and at_hash', () => {
    const user = {
      sub: 'auth0|1',
      name: 'Test User',
      email: 'test@example.com',
      iss: 'https://tenant.auth0.com/',
      aud: 'client-id',
      exp: 9999999999,
      iat: 1000000000,
      nonce: 'abc123',
      at_hash: 'hashvalue'
    };

    const stripped = stripIdTokenClaims(user);

    expect(stripped).not.toHaveProperty('iss');
    expect(stripped).not.toHaveProperty('aud');
    expect(stripped).not.toHaveProperty('exp');
    expect(stripped).not.toHaveProperty('iat');
    expect(stripped).not.toHaveProperty('nonce');
    expect(stripped).not.toHaveProperty('at_hash');
  });

  it('preserves sub, name, email and custom claims', () => {
    const user = {
      sub: 'auth0|1',
      name: 'Test User',
      email: 'test@example.com',
      'https://myapp.com/roles': ['admin'],
      iss: 'https://tenant.auth0.com/',
      exp: 9999999999
    };

    const stripped = stripIdTokenClaims(user);

    expect(stripped.sub).toBe('auth0|1');
    expect(stripped.name).toBe('Test User');
    expect(stripped.email).toBe('test@example.com');
    expect(stripped['https://myapp.com/roles']).toEqual(['admin']);
  });

  it('is a no-op when no OIDC metadata fields are present', () => {
    const user = { sub: 'auth0|1', name: 'Test User' };
    const stripped = stripIdTokenClaims(user);
    expect(stripped).toEqual(user);
  });

  it('does not mutate the original user object', () => {
    const user = {
      sub: 'auth0|1',
      iss: 'https://tenant.auth0.com/',
      exp: 9999
    };
    const original = { ...user };

    stripIdTokenClaims(user);

    expect(user).toEqual(original);
  });
});
