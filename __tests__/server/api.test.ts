import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getClaims,
  requireClaims,
  _setVerifyJwt,
  _resetApiClient
} from '../../src/server/api.js';
import { ConfigurationError } from '../../src/errors/index.js';
import { ApiClient } from '@auth0/auth0-api-js';
import type { JWTClaims } from '../../src/types/index.js';

const mockVerifyAccessToken = vi.hoisted(() => vi.fn());

vi.mock('@auth0/auth0-api-js', () => {
  const ApiClientMock = vi.fn();
  ApiClientMock.prototype.verifyAccessToken = mockVerifyAccessToken;
  return { ApiClient: ApiClientMock };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CLAIMS: JWTClaims = {
  sub: 'api|1',
  iss: 'https://test.auth0.com/',
  aud: 'https://api.example.com',
  exp: 9999999999,
  iat: 0,
  scope: 'read:users write:posts'
};

function makeRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers['Authorization'] = authHeader;
  return new Request('http://localhost/api/data', { headers });
}

// ─── getClaims ────────────────────────────────────────────────────────────────

describe('getClaims', () => {
  beforeEach(() => {
    _setVerifyJwt(async () => CLAIMS);
  });

  afterEach(() => {
    _setVerifyJwt(undefined);
  });

  it('returns null when no Authorization header', async () => {
    const result = await getClaims(makeRequest());
    expect(result).toBeNull();
  });

  it('returns null when Authorization is not Bearer', async () => {
    const result = await getClaims(makeRequest('Basic dXNlcjpwYXNz'));
    expect(result).toBeNull();
  });

  it('returns null when token fails verification', async () => {
    _setVerifyJwt(async () => {
      throw new Error('invalid signature');
    });
    const result = await getClaims(makeRequest('Bearer bad-token'));
    expect(result).toBeNull();
  });

  it('returns claims when token is valid', async () => {
    const result = await getClaims(makeRequest('Bearer valid-token'));
    expect(result).toEqual(CLAIMS);
  });
});

// ─── requireClaims ────────────────────────────────────────────────────────────

describe('requireClaims', () => {
  beforeEach(() => {
    _setVerifyJwt(async () => CLAIMS);
  });

  afterEach(() => {
    _setVerifyJwt(undefined);
  });

  it('throws a 401 Response when no Authorization header', async () => {
    const err = await requireClaims(makeRequest()).catch(e => e);
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(401);
    const body = await err.json();
    expect(body.error).toBe('bearer_token_error');
    expect(body.error_description).toBe('No Bearer token found in Authorization header');
  });

  it('throws a 401 Response when Authorization is not Bearer format', async () => {
    const err = await requireClaims(makeRequest('Basic dXNlcjpwYXNz')).catch(e => e);
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(401);
  });

  it('throws a 401 Response when token fails verification', async () => {
    _setVerifyJwt(async () => { throw new Error('jwt expired'); });
    const err = await requireClaims(makeRequest('Bearer bad-token')).catch(e => e);
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(401);
  });

  it('401 Response carries the underlying error message in error_description', async () => {
    _setVerifyJwt(async () => { throw new Error('jwt expired'); });
    const err = await requireClaims(makeRequest('Bearer bad-token')).catch(e => e);
    const body = await err.json();
    expect(body.error_description).toBe('jwt expired');
  });

  it('returns claims when token is valid', async () => {
    const result = await requireClaims(makeRequest('Bearer valid-token'));
    expect(result).toEqual(CLAIMS);
  });
});

// ─── requireClaims — scope check ──────────────────────────────────────────────

describe('requireClaims — scope check', () => {
  beforeEach(() => {
    _setVerifyJwt(async () => CLAIMS);
  });

  afterEach(() => {
    _setVerifyJwt(undefined);
  });

  it('passes when token has the required single scope', async () => {
    const result = await requireClaims(makeRequest('Bearer valid-token'), {
      scope: 'read:users'
    });
    expect(result).toEqual(CLAIMS);
  });

  it('passes when token has all required scopes (array)', async () => {
    const result = await requireClaims(makeRequest('Bearer valid-token'), {
      scope: ['read:users', 'write:posts']
    });
    expect(result).toEqual(CLAIMS);
  });

  it('throws a 403 Response when token is missing a required scope', async () => {
    const err = await requireClaims(makeRequest('Bearer valid-token'), {
      scope: ['read:users', 'delete:posts']
    }).catch(e => e);
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(403);
    const body = await err.json();
    expect(body.error).toBe('insufficient_scope');
    expect(body.error_description).toBe('Required scope(s): read:users, delete:posts');
  });

  it('throws a 403 Response when token has no scope claim', async () => {
    const claimsNoScope: JWTClaims = { ...CLAIMS, scope: undefined };
    _setVerifyJwt(async () => claimsNoScope);
    const err = await requireClaims(makeRequest('Bearer valid-token'), {
      scope: 'read:users'
    }).catch(e => e);
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(403);
  });

  it('passes when no scope option is provided (no scope check)', async () => {
    const result = await requireClaims(makeRequest('Bearer valid-token'));
    expect(result).toEqual(CLAIMS);
  });

  it('passes when scope is an empty array (vacuously true)', async () => {
    const result = await requireClaims(makeRequest('Bearer valid-token'), {
      scope: []
    });
    expect(result).toEqual(CLAIMS);
  });
});

// ─── config guards (no _setVerifyJwt stub) ────────────────────────────────────

describe('config guard — missing AUTH0_DOMAIN', () => {
  beforeEach(() => {
    delete process.env['AUTH0_DOMAIN'];
    process.env['AUTH0_AUDIENCE'] = 'https://api.example.com';
  });

  afterEach(() => {
    delete process.env['AUTH0_DOMAIN'];
    delete process.env['AUTH0_AUDIENCE'];
    _resetApiClient();
  });

  it('getClaims throws ConfigurationError when AUTH0_DOMAIN is not set', async () => {
    await expect(getClaims(makeRequest('Bearer some-token'))).rejects.toThrow(
      ConfigurationError
    );
  });

  it('requireClaims throws ConfigurationError when AUTH0_DOMAIN is not set', async () => {
    await expect(
      requireClaims(makeRequest('Bearer some-token'))
    ).rejects.toThrow(ConfigurationError);
  });
});

describe('config guard — missing AUTH0_AUDIENCE', () => {
  beforeEach(() => {
    process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
    delete process.env['AUTH0_AUDIENCE'];
  });

  afterEach(() => {
    delete process.env['AUTH0_DOMAIN'];
    delete process.env['AUTH0_AUDIENCE'];
    _resetApiClient();
  });

  it('getClaims throws ConfigurationError when AUTH0_AUDIENCE is not set', async () => {
    await expect(getClaims(makeRequest('Bearer some-token'))).rejects.toThrow(
      ConfigurationError
    );
  });

  it('requireClaims throws ConfigurationError when AUTH0_AUDIENCE is not set', async () => {
    await expect(
      requireClaims(makeRequest('Bearer some-token'))
    ).rejects.toThrow(ConfigurationError);
  });
});

// ─── ApiClient integration (no _setVerifyJwt stub) ────────────────────────────
// Exercises the real verifyJwt path to confirm ApiClient is constructed with the
// resolved config and verifyAccessToken is called with { accessToken }.

describe('ApiClient integration — real verifyJwt path', () => {
  beforeEach(() => {
    process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
    process.env['AUTH0_AUDIENCE'] = 'https://api.example.com';
    mockVerifyAccessToken.mockResolvedValue(CLAIMS);
  });

  afterEach(() => {
    delete process.env['AUTH0_DOMAIN'];
    delete process.env['AUTH0_AUDIENCE'];
    _resetApiClient();
    vi.mocked(ApiClient).mockClear();
    mockVerifyAccessToken.mockReset();
  });

  it('constructs ApiClient with resolved domain and audience, calls verifyAccessToken({ accessToken })', async () => {
    const result = await getClaims(makeRequest('Bearer real-token'));

    expect(ApiClient).toHaveBeenCalledOnce();
    expect(ApiClient).toHaveBeenCalledWith({
      domain: 'test.auth0.com',
      audience: 'https://api.example.com'
    });
    expect(mockVerifyAccessToken).toHaveBeenCalledOnce();
    expect(mockVerifyAccessToken).toHaveBeenCalledWith({
      accessToken: 'real-token'
    });
    expect(result).toEqual(CLAIMS);
  });
});
