export { Auth0Server } from './auth0-server.js';
export type {
  Auth0ServerConfig,
  ResolvedAuth0ServerConfig
} from './auth0-server.js';

export { ReactRouterCookieHandler } from './cookie-handler.js';
export type { StoreOptions } from './cookie-handler.js';

export {
  handleLogin,
  handleCallback,
  handleLogout,
  handleBackchannelLogout,
  handleAuth,
  stripIdTokenClaims
} from './handlers.js';
export type {
  HandleLoginOptions,
  HandleCallbackOptions,
  HandleLogoutOptions,
  HandleAuthOptions
} from './handlers.js';

export { rootAuthLoader } from './root-loader.js';

export {
  getSession,
  requireSession,
  getUser,
  requireUser,
  getAccessToken,
  updateSession,
  deleteSession,
  createApiClient
} from './utils.js';
export type { RequireSessionOptions, CreateApiClientOptions } from './utils.js';

export {
  auth0Middleware,
  defineRouteAuth,
  auth0SessionContext,
  auth0UserContext,
  auth0ClaimsContext,
  bearerTokenMiddleware,
  getClaimsFromContext,
  requireClaimsFromContext
} from './middleware.js';
export type { DefineRouteAuthOptions, RouteAuthHandle } from './middleware.js';

export { getClaims, requireClaims } from './api.js';
export type { RequireClaimsOptions } from './api.js';
