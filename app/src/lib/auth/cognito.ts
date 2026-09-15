// Cognito Hosted UI, Authorization Code + PKCE, no extra npm dependency.
// Cognito is purely the SAML-to-browser-session bridge here - IAM Identity
// Center is the actual login screen the person signing in sees.
//
// The id token is kept in memory only, never in localStorage or a cookie, to
// keep the XSS token-theft blast radius small. The cost is that a page refresh
// means signing in again, which is a deliberate trade.

import type { InitConfig } from "@/lib/api/types";
import {
  decodeJwtClaims,
  randomUrlSafeString,
  sha256Base64Url,
  toAuthUser,
  type AuthUser,
} from "./pkce";

// NEXT_PUBLIC_* is inlined at build time by Vite - see envPrefix in
// vite.config.ts, which keeps the prefix Next used - so these are baked into the
// bundle.
// They are now only the fallback: GET /init supplies the same two values at
// runtime, which is what lets one exported artifact serve any stack. They stay
// for local development against a stack whose /init is unreachable.
const ENV_COGNITO_DOMAIN = import.meta.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? "";
const ENV_CLIENT_ID = import.meta.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "";

let cognitoDomain = ENV_COGNITO_DOMAIN;
let clientId = ENV_CLIENT_ID;
/**
 * Which login screen the person should land on, and the reason this is
 * configurable rather than constant.
 *
 * ORGANIZATION - Identity Center is the login screen, so `identity_provider`
 *                skips Cognito's provider-chooser and goes straight to it.
 * ACCOUNT      - the Cognito hosted UI form *is* the login screen. Sending
 *                `identity_provider` there would redirect to a federated
 *                provider that does not exist on the pool, so it is omitted.
 *
 * Defaults to ORGANIZATION until /init answers, matching the previous
 * hardcoded behaviour for the deployment this console was written against.
 */
let identityMode: "ORGANIZATION" | "ACCOUNT" = "ORGANIZATION";

const SCOPE = "openid email profile";
const IDENTITY_CENTER_PROVIDER = "IdentityCenter";

/**
 * Applies the runtime configuration from GET /init. Called once, before the
 * first sign-in attempt - see BootstrapProvider, which gates the app on it.
 *
 * Each field falls back to its build-time value when /init did not supply it, so
 * a partial or failed response degrades to the previous behaviour rather than to
 * a broken sign-in.
 */
export function configureAuth(config: InitConfig): void {
  cognitoDomain = config.auth?.hostedUiDomain ?? ENV_COGNITO_DOMAIN;
  clientId = config.auth?.clientId ?? ENV_CLIENT_ID;
  identityMode = config.identityMode === "ACCOUNT" ? "ACCOUNT" : "ORGANIZATION";
}

const PKCE_STORAGE_KEY = "gpu_guardian_pkce";

/**
 * Must be read lazily. The original computed `window.location.origin + '/'` at
 * module scope, which throws during `next build` because the module is
 * evaluated while prerendering, where there is no window.
 *
 * Deliberately not taken from /init's `auth.redirectUri`, even though the stack
 * reports one: that value is the deployed CloudFront URL, and using it would
 * make local development redirect away from localhost mid-sign-in. The origin
 * the app is actually being served from is the only correct answer here, and it
 * has to match a callback URL registered on the pool either way.
 */
function redirectUri(): string {
  return `${window.location.origin}/`;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface Session {
  idToken: string;
  user: AuthUser;
  /** Epoch ms. In-memory only, so this is an upper bound on the tab's session. */
  expiresAt: number;
}

let session: Session | null = null;

/** Survives the redirect to Cognito and back; cleared as soon as it is used. */
interface PendingAuth {
  verifier: string;
  state: string;
  /** Path + query the person was trying to reach, restored after callback. */
  returnTo: string;
}

function storePendingAuth(pending: PendingAuth): void {
  // sessionStorage rather than localStorage: scoped to this tab, and cleared
  // when it closes. Wrapped because storage access throws outright when the
  // browser blocks it, rather than returning null.
  try {
    sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    throw new AuthError(
      "Browser storage is blocked, which sign-in needs to complete securely.",
    );
  }
}

function takePendingAuth(): PendingAuth | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PKCE_STORAGE_KEY);
    sessionStorage.removeItem(PKCE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { verifier, state, returnTo } = parsed as Record<string, unknown>;
    if (typeof verifier !== "string" || typeof state !== "string") return null;
    return {
      verifier,
      state,
      returnTo: typeof returnTo === "string" ? returnTo : "/",
    };
  } catch {
    return null;
  }
}

export function getIdToken(): string | null {
  if (!session) return null;
  // Handing an expired token to the API just produces a confusing 401, so
  // treat expiry as signed-out at the boundary.
  if (Date.now() >= session.expiresAt) return null;
  return session.idToken;
}

export function getCurrentUser(): AuthUser | null {
  return getIdToken() ? session?.user ?? null : null;
}

export async function redirectToSignIn(): Promise<void> {
  if (!cognitoDomain || !clientId) {
    throw new AuthError(
      "Sign-in is not configured for this deployment: the platform did not report a Cognito hosted UI domain and client id, and none were built in.",
    );
  }

  const verifier = randomUrlSafeString(64);
  // `state` is absent from the original implementation. PKCE alone protects
  // against code interception but not against a cross-site forged callback,
  // so the flow needs an unguessable value echoed back and checked.
  const state = randomUrlSafeString(32);

  storePendingAuth({
    verifier,
    state,
    returnTo: window.location.pathname + window.location.search,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: SCOPE,
    code_challenge: await sha256Base64Url(verifier),
    code_challenge_method: "S256",
    state,
  });
  // Only under ORGANIZATION mode, where there is exactly one federated provider
  // and skipping the chooser is a kindness. Under ACCOUNT mode the pool has no
  // federated provider at all, and asking for one produces an error page instead
  // of the sign-in form.
  if (identityMode === "ORGANIZATION") {
    params.set("identity_provider", IDENTITY_CENTER_PROVIDER);
  }

  window.location.assign(`https://${cognitoDomain}/oauth2/authorize?${params}`);
}

export function signOut(): void {
  session = null;
  initPromise = null;
  try {
    sessionStorage.removeItem(PKCE_STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }

  const params = new URLSearchParams({
    client_id: clientId,
    logout_uri: redirectUri(),
  });
  window.location.assign(`https://${cognitoDomain}/logout?${params}`);
}

const OAUTH_PARAMS = ["code", "state", "error", "error_description"];

/**
 * Strips the OAuth parameters from the address bar, leaving the path alone.
 *
 * Path-preserving on purpose. Rewriting the path here with replaceState was a
 * bug: it changed the URL and `usePathname`, but the App Router never swapped
 * the rendered segment, so the shell showed the destination's heading, nav and
 * breadcrumbs around the previous page's content. Only the router can move the
 * tree, so the destination is handed to React via consumeReturnTo() instead.
 */
function clearOAuthParams(): void {
  const url = new URL(window.location.href);
  for (const param of OAUTH_PARAMS) url.searchParams.delete(param);
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

let pendingReturnTo: string | null = null;

/**
 * The path the person asked for before being sent to Identity Center, or null.
 * Read-once: the caller navigates there, and a second read must not bounce them
 * back after they have moved on.
 *
 * The original discarded deep links by resetting to `/` unconditionally. Cognito
 * can only call back to the single registered redirect_uri, so the intended
 * destination has to be carried in sessionStorage across the round trip.
 */
export function consumeReturnTo(): string | null {
  const value = pendingReturnTo;
  pendingReturnTo = null;
  return value;
}

/**
 * Only same-origin absolute paths are accepted. `//evil.example` also starts
 * with a slash but is protocol-relative, so it would navigate off-site - and
 * this value comes back out of sessionStorage, which is not a trusted source.
 */
function safeReturnTo(returnTo: string): string | null {
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return null;
  return returnTo;
}

async function exchangeCodeForTokens(
  code: string,
  verifier: string,
): Promise<{ id_token?: unknown; expires_in?: unknown }> {
  const res = await fetch(`https://${cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    // Cognito returns a JSON error body; surface it, since "invalid_grant"
    // versus "invalid_client" points at very different misconfigurations.
    const detail = await res.text().catch(() => "");
    throw new AuthError(`Token exchange failed (${res.status}): ${detail}`);
  }
  return res.json();
}

async function runInit(): Promise<Session | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    const description = url.searchParams.get("error_description");
    clearOAuthParams();
    throw new AuthError(description ? `${oauthError}: ${description}` : oauthError);
  }

  // No code in the URL means this is an ordinary page load, not a callback.
  if (!code) return session;

  const pending = takePendingAuth();
  if (!pending) {
    clearOAuthParams();
    throw new AuthError(
      "Sign-in could not be completed because this tab has no record of starting it. Please try again.",
    );
  }

  if (returnedState !== pending.state) {
    clearOAuthParams();
    throw new AuthError(
      "Sign-in was rejected because the callback did not match this tab's request.",
    );
  }

  const tokens = await exchangeCodeForTokens(code, pending.verifier);
  if (typeof tokens.id_token !== "string") {
    throw new AuthError("Token response did not include an id_token.");
  }

  const expiresInSeconds =
    typeof tokens.expires_in === "number" ? tokens.expires_in : 3600;

  session = {
    idToken: tokens.id_token,
    user: toAuthUser(decodeJwtClaims(tokens.id_token)),
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  clearOAuthParams();
  pendingReturnTo = safeReturnTo(pending.returnTo);
  return session;
}

let initPromise: Promise<Session | null> | null = null;

/**
 * Completes a redirect-back if there is one, and reports the session.
 * Returns null when there is nothing to do and no session, i.e. show sign-in.
 *
 * Memoized deliberately: an authorization code is single-use, and React runs
 * effects twice in development. Without this, the second call exchanges an
 * already-redeemed code and fails, so sign-in would appear broken in dev only.
 */
export function initSession(): Promise<Session | null> {
  initPromise ??= runInit();
  return initPromise;
}
