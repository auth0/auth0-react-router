import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getClaims,
  requireClaims,
  _setVerifyJwt,
  _resetApiClient
} from '../../src/server/api.js';
import {
  BearerTokenError,
  ConfigurationError,
  InsufficientScopeError
} from '../../src/errors/index.js';
import { getInstance } from '../../src/server/utils.js';
import { ApiClient } from '@auth0/auth0-api-js';
import type { JWTClaims } from '../../src/types/index.js';

vi.mock('../../src/server/utils.js', () => ({
  getInstance: vi.fn(() => ({
    config: { domain: 'test.auth0.com', audience: 'https://api.example.com' }
  }))
}));

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

  it('throws BearerTokenError when no Authorization header', async () => {
    await expect(requireClaims(makeRequest())).rejects.toThrow(
      BearerTokenError
    );
    await expect(requireClaims(makeRequest())).rejects.toThrow(
      'No Bearer token found in Authorization header'
    );
  });

  it('throws BearerTokenError when Authorization is not Bearer format', async () => {
    await expect(
      requireClaims(makeRequest('Basic dXNlcjpwYXNz'))
    ).rejects.toThrow(BearerTokenError);
  });

  it('throws BearerTokenError when token fails verification', async () => {
    _setVerifyJwt(async () => {
      throw new Error('jwt expired');
    });
    await expect(
      requireClaims(makeRequest('Bearer bad-token'))
    ).rejects.toThrow(BearerTokenError);
  });

  it('BearerTokenError carries the underlying error message', async () => {
    _setVerifyJwt(async () => {
      throw new Error('jwt expired');
    });
    await expect(
      requireClaims(makeRequest('Bearer bad-token'))
    ).rejects.toThrow('jwt expired');
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

  it('throws InsufficientScopeError when token is missing one scope', async () => {
    await expect(
      requireClaims(makeRequest('Bearer valid-token'), {
        scope: ['read:users', 'delete:posts']
      })
    ).rejects.toThrow(InsufficientScopeError);
    await expect(
      requireClaims(makeRequest('Bearer valid-token'), {
        scope: ['read:users', 'delete:posts']
      })
    ).rejects.toThrow('Required scope(s): read:users, delete:posts');
  });

  it('throws InsufficientScopeError when token has no scope claim', async () => {
    const claimsNoScope: JWTClaims = { ...CLAIMS, scope: undefined };
    _setVerifyJwt(async () => claimsNoScope);
    await expect(
      requireClaims(makeRequest('Bearer valid-token'), { scope: 'read:users' })
    ).rejects.toThrow(InsufficientScopeError);
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

// ─── audience guard (no _setVerifyJwt stub) ───────────────────────────────────

describe('audience guard — missing AUTH0_AUDIENCE', () => {
  beforeEach(() => {
    vi.mocked(getInstance).mockReturnValue({
      config: { domain: 'test.auth0.com', audience: undefined }
    } as ReturnType<typeof getInstance>);
  });

  afterEach(() => {
    vi.mocked(getInstance).mockReturnValue({
      config: { domain: 'test.auth0.com', audience: 'https://api.example.com' }
    } as ReturnType<typeof getInstance>);
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
    mockVerifyAccessToken.mockResolvedValue(CLAIMS);
  });

  afterEach(() => {
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
