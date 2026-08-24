// ─── defineRouteHandle ────────────────────────────────────────────────────────
//
// This file is intentionally free of server imports so that bundlers can
// include it in the client bundle without pulling in any server-side code.
// React Router's splitRouteModules traces handle exports to this file and
// produces a near-empty client stub instead of a 145 kB server bundle.

/**
 * Options passed to defineRouteAuth / defineRouteHandle.
 */
export interface DefineRouteAuthOptions {
  /**
   * Required role(s). Throws InsufficientScopeError (403) if the authenticated
   * user does not hold all of the specified roles.
   */
  role?: string | string[];
  /**
   * The user claim that holds the roles array.
   * Defaults to 'https://auth0.com/claims/roles'.
   */
  rolesClaim?: string;
}

/**
 * The route handle shape written by defineRouteAuth / defineRouteHandle.
 * Readable in any component via useMatches() — useful for showing a lock icon
 * on protected routes or building breadcrumbs that are auth-aware.
 *
 * @example
 * const matches = useMatches();
 * const isProtected = matches.some(m => (m.handle as RouteAuthHandle)?.auth);
 */
export interface RouteAuthHandle {
  auth: DefineRouteAuthOptions;
}

/**
 * Returns the route handle metadata for a protected route.
 *
 * Import this instead of using defineRouteAuth().handle when your route file
 * exports both `handle` and `middleware`. Because this function has no server
 * imports, bundlers can include it in the client bundle without pulling in any
 * server-side code — keeping the client stub near-empty.
 *
 * @example
 * // app/routes/admin-layout.tsx
 * import { defineRouteHandle } from '@auth0/auth0-react-router/server';
 * import { defineRouteAuth }   from '@auth0/auth0-react-router/server';
 *
 * export const handle = defineRouteHandle({ role: 'admin' });
 * export const middleware = defineRouteAuth({ role: 'admin' }).middleware;
 */
export function defineRouteHandle(opts?: DefineRouteAuthOptions): RouteAuthHandle {
  return { auth: opts ?? {} };
}
