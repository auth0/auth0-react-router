import { describe, it, expect } from 'vitest';
import {
  Auth0Error,
  AuthenticationError,
  SessionExpiredError,
  MissingSessionError,
  TokenError,
  BearerTokenError,
  CallbackError,
  InsufficientScopeError,
  ConfigurationError
} from '../../src/errors/index.js';

describe('Auth0Error subclasses', () => {
  describe('AuthenticationError', () => {
    const err = new AuthenticationError('login failed');

    it('has the correct message', () => {
      expect(err.message).toBe('login failed');
    });

    it('has the correct code', () => {
      expect(err.code).toBe('authentication_error');
    });

    it('has the correct statusCode', () => {
      expect(err.statusCode).toBe(401);
    });

    it('is instanceof AuthenticationError', () => {
      expect(err instanceof AuthenticationError).toBe(true);
    });

    it('is instanceof Auth0Error', () => {
      expect(err instanceof Auth0Error).toBe(true);
    });

    it('is instanceof Error', () => {
      expect(err instanceof Error).toBe(true);
    });
  });

  describe('SessionExpiredError', () => {
    const err = new SessionExpiredError('session expired');

    it('has the correct code', () => expect(err.code).toBe('session_expired'));
    it('has the correct statusCode', () => expect(err.statusCode).toBe(401));
    it('is instanceof SessionExpiredError', () =>
      expect(err instanceof SessionExpiredError).toBe(true));
    it('is instanceof Auth0Error', () =>
      expect(err instanceof Auth0Error).toBe(true));
  });

  describe('MissingSessionError', () => {
    const err = new MissingSessionError('no session');

    it('has the correct code', () => expect(err.code).toBe('missing_session'));
    it('has the correct statusCode', () => expect(err.statusCode).toBe(401));
    it('is instanceof MissingSessionError', () =>
      expect(err instanceof MissingSessionError).toBe(true));
    it('is instanceof Auth0Error', () =>
      expect(err instanceof Auth0Error).toBe(true));
  });

  describe('TokenError', () => {
    const err = new TokenError('token refresh failed');

    it('has the correct code', () => expect(err.code).toBe('token_error'));
    it('has the correct statusCode', () => expect(err.statusCode).toBe(401));
    it('is instanceof TokenError', () =>
      expect(err instanceof TokenError).toBe(true));
    it('is instanceof Auth0Error', () =>
      expect(err instanceof Auth0Error).toBe(true));
  });

  describe('BearerTokenError', () => {
    const err = new BearerTokenError('invalid bearer token');

    it('has the correct code', () =>
      expect(err.code).toBe('bearer_token_error'));
    it('has the correct statusCode', () => expect(err.statusCode).toBe(401));
    it('is instanceof BearerTokenError', () =>
      expect(err instanceof BearerTokenError).toBe(true));
    it('is instanceof Auth0Error', () =>
      expect(err instanceof Auth0Error).toBe(true));
  });

  describe('CallbackError', () => {
    const err = new CallbackError('state mismatch');

    it('has the correct code', () => expect(err.code).toBe('callback_error'));
    it('has the correct statusCode', () => expect(err.statusCode).toBe(400));
    it('is instanceof CallbackError', () =>
      expect(err instanceof CallbackError).toBe(true));
    it('is instanceof Auth0Error', () =>
      expect(err instanceof Auth0Error).toBe(true));
  });

  describe('InsufficientScopeError', () => {
    const err = new InsufficientScopeError('missing required scope');

    it('has the correct code', () =>
      expect(err.code).toBe('insufficient_scope'));
    it('has the correct statusCode', () => expect(err.statusCode).toBe(403));
    it('is instanceof InsufficientScopeError', () =>
      expect(err instanceof InsufficientScopeError).toBe(true));
    it('is instanceof Auth0Error', () =>
      expect(err instanceof Auth0Error).toBe(true));
  });

  describe('ConfigurationError', () => {
    const err = new ConfigurationError('missing AUTH0_DOMAIN');

    it('has the correct code', () =>
      expect(err.code).toBe('configuration_error'));
    it('has the correct statusCode', () => expect(err.statusCode).toBe(500));
    it('is instanceof ConfigurationError', () =>
      expect(err instanceof ConfigurationError).toBe(true));
    it('is instanceof Auth0Error', () =>
      expect(err instanceof Auth0Error).toBe(true));
  });

  describe('cross-class instanceof', () => {
    it('SessionExpiredError is not instanceof AuthenticationError', () => {
      const err = new SessionExpiredError('expired');
      expect(err instanceof AuthenticationError).toBe(false);
    });

    it('ConfigurationError is not instanceof TokenError', () => {
      const err = new ConfigurationError('bad config');
      expect(err instanceof TokenError).toBe(false);
    });
  });
});
