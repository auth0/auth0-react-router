/**
 * Base class for all Auth0 SDK errors.
 *
 * Every error exposes:
 *   message    — human-readable description
 *   code       — machine-readable string for programmatic handling
 *   statusCode — HTTP status code equivalent
 *
 * Object.setPrototypeOf fixes instanceof checks when extending
 * built-in classes like Error in TypeScript.
 */
export abstract class Auth0Error extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── 401 ──────────────────────────────────────────────────────────────────────

export class AuthenticationError extends Auth0Error {
  readonly code = 'authentication_error' as const;
  readonly statusCode = 401;
}

export class SessionExpiredError extends Auth0Error {
  readonly code = 'session_expired' as const;
  readonly statusCode = 401;
}

export class MissingSessionError extends Auth0Error {
  readonly code = 'missing_session' as const;
  readonly statusCode = 401;
}

export class TokenError extends Auth0Error {
  readonly code = 'token_error' as const;
  readonly statusCode = 401;
}

export class BearerTokenError extends Auth0Error {
  readonly code = 'bearer_token_error' as const;
  readonly statusCode = 401;
}

// ─── 400 ──────────────────────────────────────────────────────────────────────

export class CallbackError extends Auth0Error {
  readonly code = 'callback_error' as const;
  readonly statusCode = 400;
}

// ─── 403 ──────────────────────────────────────────────────────────────────────

export class InsufficientScopeError extends Auth0Error {
  readonly code = 'insufficient_scope' as const;
  readonly statusCode = 403;
}

// ─── 500 ──────────────────────────────────────────────────────────────────────

/**
 * Thrown when required SDK configuration is missing.
 * The message must be actionable — it should tell the developer
 * exactly which env var is missing and where to find the value.
 */
export class ConfigurationError extends Auth0Error {
  readonly code = 'configuration_error' as const;
  readonly statusCode = 500;
}
