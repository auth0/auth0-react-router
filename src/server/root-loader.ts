import type { BrowserSession } from '../types/index.js';
import { getSession, toBrowserSession } from './utils.js';

/**
 * Reads the current session and returns only the browser-safe portion.
 *
 * Returns { session: BrowserSession | null }. Only the user profile is included.
 * Access tokens, refresh tokens, and ID tokens never leave the server.
 *
 * Accepts an optional callback to merge your own loader data. The `session`
 * key always takes precedence and cannot be overwritten by the callback's
 * return value.
 *
 * @example
 * // app/root.tsx — no custom data
 * export const loader = ({ request }: LoaderFunctionArgs) =>
 *   rootAuthLoader(request);
 *
 * @example
 * // app/root.tsx — with custom data
 * export const loader = ({ request }: LoaderFunctionArgs) =>
 *   rootAuthLoader(request, async ({ session }) => ({
 *     featureFlags: await getFlags(session?.user.sub),
 *   }));
 */
export async function rootAuthLoader(
  request: Request,
  callback?: (data: {
    session: BrowserSession | null;
  }) => Promise<Record<string, unknown>>
): Promise<{ session: BrowserSession | null } & Record<string, unknown>> {
  const serverSession = await getSession(request);

  const authData = {
    session: serverSession ? toBrowserSession(serverSession) : null
  };

  if (!callback) return authData;

  const customData = await callback(authData);

  // Spread custom data first, then authData — session key always wins.
  return { ...customData, ...authData };
}
