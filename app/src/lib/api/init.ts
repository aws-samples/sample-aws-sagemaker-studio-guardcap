import { request } from "./client";
import type { InitConfig } from "./types";

/**
 * GET /init - the runtime bootstrap, and the reason this app ships no
 * deployment-specific build.
 *
 * Replaces the never-implemented /branding, and does more than rename it: the
 * response also carries the Cognito coordinates and the identity mode, so a
 * static export can be built once and pointed at any stack. Previously the pool
 * client id and hosted UI domain were NEXT_PUBLIC_ env vars baked into the
 * bundle at build time, which meant a rebuild per deployment and a bundle that
 * was wrong the moment the stack was recreated.
 *
 * It is the one unauthenticated route, which it has to be: it is what tells the
 * app where to send the user to authenticate.
 */
export const INIT_PATH = "/init";

/**
 * What the app looks like when /init cannot be reached.
 *
 * These are the backend's own defaults, restated: matching them means a
 * deployment that has not been branded looks identical whether or not the
 * request succeeded, so a failed /init is not visible as a different-looking
 * page. AWS's own name and marks, because that is what an unbranded deployment
 * of this platform is.
 */
export const DEFAULT_INIT: InitConfig = {
  appTitle: "AWS SageMaker GPU Guardian",
  appShortName: "GPU Guardian",
  // Empty, not a URL: "the deployment supplied no logo" is the signal each
  // consumer already answers with the AWS mark in the contrast its own
  // background needs - white on the dark top bar, dark on the sign-in page.
  // Naming one file here would hand the light theme a white logo on a white
  // page.
  logoUrl: "",
  // Local, not the awsstatic.com URL the backend defaults to. This is the last
  // resort - what renders when the deployment's own branding is absent, or
  // present but not embeddable, as with a host that sets
  // Cross-Origin-Resource-Policy - so it must not itself depend on a third-party
  // origin continuing to allow being embedded.
  faviconUrl: "/brand/favicon.ico",
  primaryColor: "#0972d3",
  institutionName: "Amazon Web Services",
  supportEmail: null,
  identityMode: null,
  auth: null,
};

/** Trimmed non-empty string, or null. Blank strings are absent values here. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Field by field, with the default behind each one.
 *
 * Not a cast: this response decides where the browser is sent to sign in, and a
 * deployment mid-update could serve a partial object. A missing appTitle must
 * fall back, not render "undefined" in the tab.
 */
function coerce(raw: unknown): InitConfig {
  if (typeof raw !== "object" || raw === null) return DEFAULT_INIT;
  const value = raw as Record<string, unknown>;
  const rawAuth = value.auth;
  const auth =
    typeof rawAuth === "object" && rawAuth !== null
      ? (rawAuth as Record<string, unknown>)
      : null;

  return {
    appTitle: str(value.appTitle) ?? DEFAULT_INIT.appTitle,
    appShortName: str(value.appShortName) ?? DEFAULT_INIT.appShortName,
    logoUrl: str(value.logoUrl) ?? DEFAULT_INIT.logoUrl,
    faviconUrl: str(value.faviconUrl) ?? DEFAULT_INIT.faviconUrl,
    primaryColor: str(value.primaryColor) ?? DEFAULT_INIT.primaryColor,
    institutionName: str(value.institutionName) ?? DEFAULT_INIT.institutionName,
    supportEmail: str(value.supportEmail),
    identityMode: str(value.identityMode),
    // Null rather than an empty object when absent, so callers can tell "the
    // deployment did not tell us" from "it told us there is no hosted UI" - the
    // first falls back to the build-time env vars, the second does not.
    auth: auth
      ? {
          userPoolId: str(auth.userPoolId),
          clientId: str(auth.clientId),
          hostedUiDomain: str(auth.hostedUiDomain),
          redirectUri: str(auth.redirectUri),
          adminGroup: str(auth.adminGroup),
          studentGroup: str(auth.studentGroup),
        }
      : null,
  };
}

/**
 * Anonymous by construction - it runs before there is a token to send.
 *
 * Never throws. A deployment whose /init is unreachable still has to render its
 * sign-in screen: the env-var fallback in lib/auth/cognito.ts can carry local
 * development, and an unbranded console is a far better failure than a blank
 * page. The cost of that choice is that a stack with no /init and no env vars
 * shows a sign-in button that cannot work, which is reported when it is pressed.
 */
export async function fetchInit(): Promise<InitConfig> {
  try {
    return coerce(await request<unknown>(INIT_PATH, { anonymous: true }));
  } catch {
    return DEFAULT_INIT;
  }
}
