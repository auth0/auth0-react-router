// Minimal ImportMeta augmentation for Vite's env variables used by SPA mode.
// This avoids a hard dependency on vite just for type checking.
interface ImportMetaEnv {
  readonly VITE_AUTH0_DOMAIN?: string;
  readonly VITE_AUTH0_CLIENT_ID?: string;
  readonly VITE_AUTH0_REDIRECT_URI?: string;
  readonly VITE_AUTH0_AUDIENCE?: string;
  readonly VITE_AUTH0_SCOPE?: string;
  readonly VITE_AUTH0_USE_REFRESH_TOKENS?: string;
  readonly VITE_AUTH0_USE_REFRESH_TOKENS_FALLBACK?: string;
  readonly VITE_AUTH0_CACHE_LOCATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
