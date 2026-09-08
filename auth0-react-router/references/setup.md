# Auth0 React Router — Setup Guide

## Auth0 Configuration

> **Agent instruction:**
>
> **Step 1 — Check for credentials.** If the user's prompt already contains an Auth0 domain, client ID, and client secret, use them directly. Skip to "Write `.env`" below without running the bootstrap script or asking any questions.
>
> **Step 2 — Offer setup choice** (only when credentials are missing):
> Use `AskUserQuestion`: "How would you like to configure Auth0 for this project?"
> - Option A: **Automatic setup (recommended)** — runs the bootstrap script
> - Option B: **Manual setup** — provide credentials manually
>
> **If Automatic Setup:**
>
> 1. Pre-flight checks:
>    ```bash
>    node --version          # must be 20+
>    auth0 --version         # must be installed
>    auth0 tenants list --csv --no-input   # must show an active tenant
>    ```
>    If any check fails, guide the user to install the missing tool or fall back to manual setup.
>
> 2. Run bootstrap:
>    ```bash
>    cd auth0-react-router/scripts && npm install && node bootstrap.mjs <path-to-project>
>    ```
>    The script will:
>    - Detect the React Router project (`package.json` + `react-router` dependency)
>    - Discover existing Auth0 apps and database connections
>    - Show a change plan (CREATE/SKIP) and confirm with the user
>    - Create a **Regular Web Application** in Auth0
>    - Enable the Username-Password-Authentication connection
>    - Write `.env` with `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SESSION_SECRET`
>    - Print a summary with the callback URL to register
>
> **If Manual Setup:**
>
> Ask the user for:
> - Auth0 Domain (e.g., `example.us.auth0.com`)
> - Client ID
> - Client Secret
>
> Then write `.env`:
> ```bash
> AUTH0_DOMAIN=example.us.auth0.com
> AUTH0_CLIENT_ID=<client-id>
> AUTH0_CLIENT_SECRET=<client-secret>
> AUTH0_SESSION_SECRET=<generate with: openssl rand -base64 32>
> ```

### Auth0 Dashboard — Required Settings

In the [Auth0 Dashboard](https://manage.auth0.com/), set the following on the application:

| Setting | Value |
|---------|-------|
| Application Type | **Regular Web Application** |
| Allowed Callback URLs | `http://localhost:5173/auth/callback` |
| Allowed Logout URLs | `http://localhost:5173` |
| Allowed Web Origins | `http://localhost:5173` |

For production, replace `http://localhost:5173` with your actual domain.

## Post-Setup Steps

After configuration:

1. **Verify middleware order** in `app/root.tsx`: `rootAuthLoader` must be the root loader.
2. **Verify `id: 'root'`** if using a custom route config (`app/routes.ts`):
   ```ts
   // app/routes.ts
   import { type RouteConfig, index, route } from '@react-router/dev/routes'
   export default [
     index('routes/_index.tsx'),
     route('auth/*', 'routes/auth.$.tsx'),
   ] satisfies RouteConfig
   ```
3. **Test login flow**: Start the dev server and navigate to `http://localhost:5173/auth/login`.
4. **Confirm cookie** is set after login (`DevTools → Application → Cookies`).

## SDK Installation

Install the SDK and its peer dependencies:

```bash
npm install @auth0/auth0-react-router
```

Required peer dependencies (install if not already present):

```bash
npm install react react-dom react-router
```

For SPA mode only (optional):

```bash
npm install @auth0/auth0-spa-js
```

Verify installation:

```bash
cat node_modules/@auth0/auth0-react-router/package.json | grep '"version"'
```

## Secret Management

### Development

Use a `.env` file at the project root. **Add `.env` to `.gitignore`** immediately:

```bash
echo ".env" >> .gitignore
```

Generate a strong session secret:

```bash
openssl rand -base64 32
```

Minimum `.env` for RWA mode:

```env
AUTH0_DOMAIN=example.us.auth0.com
AUTH0_CLIENT_ID=your_client_id
AUTH0_CLIENT_SECRET=your_client_secret
AUTH0_SESSION_SECRET=<32+ char random string>
```

Optional additions:

```env
AUTH0_AUDIENCE=https://api.example.com
AUTH0_SCOPE=openid profile email offline_access
AUTH0_APP_BASE_URL=http://localhost:5173
```

### Production

Set environment variables via your hosting platform (Vercel, Fly.io, Railway, etc.). Never commit secrets to source control.

**Rotating `AUTH0_SESSION_SECRET`:** Changing this value immediately invalidates all active session cookies. All users will be logged out. Plan rotations during low-traffic windows.

**Rotating `AUTH0_CLIENT_SECRET`:** Generate a new secret in the Auth0 Dashboard before updating the env var to avoid downtime.

## Verification

```bash
# 1. Build succeeds
npm run build

# 2. Dev server starts
npm run dev

# 3. Login redirects to Auth0
open http://localhost:5173/auth/login

# 4. After login, session cookie is set
# Check DevTools → Application → Cookies for an encrypted cookie

# 5. Logout clears the cookie
open http://localhost:5173/auth/logout
```

If the build fails with `TypeError: Cannot read properties of undefined (reading 'env')`, ensure you're on `@auth0/auth0-react-router@1.0.0-beta.1` or later and that `import.meta.env` is not accessed in a CJS context.
