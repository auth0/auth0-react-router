# Changelog

## [v1.0.0-beta.2](https://github.com/auth0/auth0-react-router/tree/v1.0.0-beta.2) (2026-08-30)
[Full Changelog](https://github.com/auth0/auth0-react-router/compare/v1.0.0-beta.1...v1.0.0-beta.2)

**Added**
- feat: add sessionStore option to enable back channel logout [\#36](https://github.com/auth0/auth0-react-router/pull/36) ([yogeshchoudhary147](https://github.com/yogeshchoudhary147))

**Fixed**
- fix: harden returnTo validation against control character open redirect [\#35](https://github.com/auth0/auth0-react-router/pull/35) ([yogeshchoudhary147](https://github.com/yogeshchoudhary147))
- fix: normalize roles claim to array before check [\#34](https://github.com/auth0/auth0-react-router/pull/34) ([yogeshchoudhary147](https://github.com/yogeshchoudhary147))

## [1.0.0-beta.1] - 2026-08-24

### Fixed

- `Auth0Provider` no longer crashes on first render when the package is installed from npm and Vite externalizes it. The CJS build replaces `import.meta` with `{}`, making `import.meta.env` undefined — optional chaining (`import.meta.env?.`) prevents the `TypeError`.

## [1.0.0-beta.0] - 2026-08-24

Initial beta release of `@auth0/auth0-react-router` — an Auth0 authentication SDK for [React Router v7](https://reactrouter.com/) framework mode applications.

> APIs may change before the stable GA release.

### Added

- Server-side authentication with encrypted JWE session cookies (`handleLogin`, `handleCallback`, `handleLogout`, `handleAuth`, `handleBackchannelLogout`)
- Session and token helpers for loaders and actions: `getSession`, `requireSession`, `getUser`, `requireUser`, `getAccessToken`, `updateSession`, `deleteSession`, `createApiClient`
- `rootAuthLoader` for exposing the browser-safe session to the client via React Router's root loader
- Route protection middleware: `auth0Middleware`, `defineRouteAuth` with role-based access control (requires React Router >= 7.9.0)
- API resource server support: `bearerTokenMiddleware`, `getClaims`, `requireClaims`
- React hooks and UI components: `useAuth0`, `useUser`, `useSession`, `SignedIn`, `SignedOut`, `AuthLoading`, `Auth0ErrorBoundary`, `RequireAuth`, `RequireRole`, `LoginButton`, `LogoutButton`, `withAuthenticationRequired`
- `stripIdTokenClaims` utility for removing sensitive claims before forwarding tokens
- Typed error classes: `Auth0Error`, `AuthenticationError`, `SessionExpiredError`, `MissingSessionError`, `TokenError`, `BearerTokenError`, `CallbackError`, `InsufficientScopeError`, `ConfigurationError`
- Optional SPA mode backed by `@auth0/auth0-spa-js`
- Testing utilities: `Auth0ProviderMock`, `WithAuth`, and mock factories (`createMockUser`, `createMockSession`, `createMockTokenSet`, `createMockAuth0Context`, `createMockLoader`, `createMockBearerRequest`)
- Six tree-shakeable entry points keeping server code out of the client bundle: `/client`, `/server`, `/errors`, `/types`, `/testing`
