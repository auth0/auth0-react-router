import { parse as parseCookies, serialize as serializeCookie } from 'cookie';
import type {
  CookieHandler,
  CookieSerializeOptions
} from '@auth0/auth0-server-js';

/**
 * Passed to every cookie operation so the handler knows which
 * request to read from and which response to write to.
 */
export interface StoreOptions {
  request: Request;
  response: Response;
}

/**
 * Teaches @auth0/auth0-server-js how to read and write cookies
 * the React Router way.
 *
 * Reading  → parse the Cookie header from the incoming Request
 * Writing  → append Set-Cookie headers to the outgoing Response
 *
 * Dev mode: when NODE_ENV=development and the request is on localhost
 * or 127.0.0.1, secure is forced to false so HTTPS is not required locally.
 */
export class ReactRouterCookieHandler implements CookieHandler<StoreOptions> {
  private isLocalhost(request: Request): boolean {
    try {
      const { hostname } = new URL(request.url);
      return hostname === 'localhost' || hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }

  private resolveSecure(
    request: Request,
    secure: boolean | undefined
  ): boolean | undefined {
    const isDev = process.env['NODE_ENV'] === 'development';
    return isDev && this.isLocalhost(request) ? false : secure;
  }

  getCookies(storeOptions?: StoreOptions): Record<string, string> {
    if (!storeOptions) return {};
    const cookieHeader = storeOptions.request.headers.get('Cookie') ?? '';
    const parsed = parseCookies(cookieHeader);
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    );
  }

  getCookie(name: string, storeOptions?: StoreOptions): string | undefined {
    if (!storeOptions) return undefined;
    return this.getCookies(storeOptions)[name];
  }

  setCookie(
    name: string,
    value: string,
    options?: CookieSerializeOptions,
    storeOptions?: StoreOptions
  ): void {
    if (!storeOptions) return;

    const secure = this.resolveSecure(storeOptions.request, options?.secure);

    const serialized = serializeCookie(name, value, {
      httpOnly: options?.httpOnly,
      secure,
      sameSite: options?.sameSite,
      path: options?.path ?? '/',
      maxAge: options?.maxAge,
      expires: options?.expires,
      domain: options?.domain
    });

    storeOptions.response.headers.append('Set-Cookie', serialized);
  }

  deleteCookie(
    name: string,
    storeOptions?: StoreOptions,
    options?: CookieSerializeOptions
  ): void {
    if (!storeOptions) return;

    const serialized = serializeCookie(name, '', {
      ...options,
      secure: this.resolveSecure(storeOptions.request, options?.secure),
      maxAge: 0,
      path: options?.path ?? '/'
    });

    storeOptions.response.headers.append('Set-Cookie', serialized);
  }
}
