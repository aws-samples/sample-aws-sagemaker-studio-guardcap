/// <reference types="vite/client" />

/**
 * The build-time configuration, declared rather than left to inference.
 *
 * Vite types unknown `import.meta.env` keys as `any`, which would let a typo
 * compile and then read as undefined in the browser. Listing them here makes the
 * three that exist the only three that type-check.
 *
 * All optional: a deployment is expected to rely on GET /init instead, and these
 * are the fallbacks for when it cannot be reached. See lib/api/init.ts.
 */
interface ImportMetaEnv {
  /** Origin of the admin API. Empty means same-origin relative requests. */
  readonly NEXT_PUBLIC_API_BASE_URL?: string;
  readonly NEXT_PUBLIC_COGNITO_DOMAIN?: string;
  readonly NEXT_PUBLIC_COGNITO_CLIENT_ID?: string;
}
