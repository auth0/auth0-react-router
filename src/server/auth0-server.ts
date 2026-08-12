import {
  ServerClient,
  CookieTransactionStore,
  StatelessStateStore
} from '@auth0/auth0-server-js';
import { ConfigurationError } from '../errors/index.js';
import { ReactRouterCookieHandler } from './cookie-handler.js';
import type { StoreOptions } from './cookie-handler.js';

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Options passed to new Auth0Server().
 * Every field is optional — missing values fall back to environment variables.
 */
export interface Auth0ServerConfig {
  domain?: string; // AUTH0_DOMAIN
  clientId?: string; // AUTH0_CLIENT_ID
  clientSecret?: string; // AUTH0_CLIENT_SECRET
  secret?: string; // AUTH0_SESSION_SECRET — used to encrypt session cookies
  appBaseUrl?: string; // AUTH0_APP_BASE_URL
  audience?: string; // AUTH0_AUDIENCE (optional)
  scope?: string; // AUTH0_SCOPE (optional, default: openid profile email)
}

/**
 * Config with all required values resolved and defaults applied.
 * Guaranteed to be complete — Auth0Server only holds this after validation.
 */
export interface ResolvedAuth0ServerConfig {
  domain: string;
  clientId: string;
  clientSecret: string;
  secret: string;
  appBaseUrl: string;
  audience?: string;
  scope: string;
}

// ─── Config resolution ────────────────────────────────────────────────────────

const REQUIRED_FIELDS: Array<{
  key: keyof ResolvedAuth0ServerConfig;
  envVar: string;
  hint: string;
}> = [
  {
    key: 'domain',
    envVar: 'AUTH0_DOMAIN',
    hint: 'Auth0 Dashboard → Applications → [your app] → Settings → Domain'
  },
  {
    key: 'clientId',
    envVar: 'AUTH0_CLIENT_ID',
    hint: 'Auth0 Dashboard → Applications → [your app] → Settings → Client ID'
  },
  {
    key: 'clientSecret',
    envVar: 'AUTH0_CLIENT_SECRET',
    hint: 'Auth0 Dashboard → Applications → [your app] → Settings → Client Secret'
  },
  {
    key: 'secret',
    envVar: 'AUTH0_SESSION_SECRET',
    hint: 'A 32+ character random string. Generate one with: openssl rand -hex 32'
  },
  {
    key: 'appBaseUrl',
    envVar: 'AUTH0_APP_BASE_URL',
    hint: 'The base URL of your app, e.g. https://example.com or http://localhost:3000'
  }
];

function resolveConfig(
  options: Auth0ServerConfig = {}
): ResolvedAuth0ServerConfig {
  const resolved = {
    domain: options.domain ?? process.env['AUTH0_DOMAIN'],
    clientId: options.clientId ?? process.env['AUTH0_CLIENT_ID'],
    clientSecret: options.clientSecret ?? process.env['AUTH0_CLIENT_SECRET'],
    secret: options.secret ?? process.env['AUTH0_SESSION_SECRET'],
    appBaseUrl: options.appBaseUrl ?? process.env['AUTH0_APP_BASE_URL'],
    audience: options.audience ?? process.env['AUTH0_AUDIENCE'],
    scope: options.scope ?? process.env['AUTH0_SCOPE'] ?? 'openid profile email'
  };

  // Collect all missing required fields at once
  const missing = REQUIRED_FIELDS.filter(({ key }) => !resolved[key]);

  if (missing.length > 0) {
    const lines = missing.map(
      ({ envVar, hint }) => `  ${envVar}\n    → ${hint}`
    );
    throw new ConfigurationError(
      `Missing required Auth0 configuration:\n\n${lines.join('\n\n')}\n\n` +
        `Set these as environment variables or pass them to new Auth0Server({ ... }).`
    );
  }

  return resolved as ResolvedAuth0ServerConfig;
}

// ─── Auth0Server ──────────────────────────────────────────────────────────────

/**
 * The main entry point for the Auth0 React Router SDK (server side).
 *
 * Create once when your app starts — not on every request.
 * The constructor makes zero network calls. OIDC discovery is deferred
 * to the first auth operation.
 *
 * @example
 * // auth0.server.ts
 * export const auth0 = new Auth0Server();
 */
// The default identifier used by ServerClient for the state store.
// Pinned explicitly so session utilities can reference the same key.
const STATE_IDENTIFIER = '__a0_session';

export class Auth0Server {
  readonly serverClient: ServerClient<StoreOptions>;
  readonly stateStore: StatelessStateStore<StoreOptions>;
  readonly stateIdentifier = STATE_IDENTIFIER;
  readonly config: ResolvedAuth0ServerConfig;

  constructor(options: Auth0ServerConfig = {}) {
    // Resolve and validate config — throws ConfigurationError if anything is missing
    this.config = resolveConfig(options);

    // One shared cookie handler — both stores use the same instance
    const cookieHandler = new ReactRouterCookieHandler();

    // Holds temporary login state (PKCE, nonce, state) during the login flow
    const transactionStore = new CookieTransactionStore<StoreOptions>(
      { secret: this.config.secret },
      cookieHandler
    );

    // Holds the encrypted session (user + tokens) for the duration of the session
    this.stateStore = new StatelessStateStore<StoreOptions>(
      { secret: this.config.secret },
      cookieHandler
    );

    // Callback URL — Auth0 redirects here after the user authenticates
    const callbackUrl = new URL(
      '/auth/callback',
      this.config.appBaseUrl
    ).toString();

    // ServerClient is stateless — no network calls happen here
    this.serverClient = new ServerClient<StoreOptions>({
      domain: this.config.domain,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      authorizationParams: {
        redirect_uri: callbackUrl,
        scope: this.config.scope,
        ...(this.config.audience ? { audience: this.config.audience } : {})
      },
      transactionStore,
      stateStore: this.stateStore,
      stateIdentifier: STATE_IDENTIFIER
    });
  }
}
