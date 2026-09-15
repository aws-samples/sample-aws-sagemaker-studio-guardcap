// Authorization Code + PKCE primitives, built on WebCrypto so there is no
// extra npm dependency. Kept free of navigation and storage side effects so
// each piece can be exercised on its own.

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToBytes(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** A base64url string with `byteLength` bytes of CSPRNG entropy behind it. */
export function randomUrlSafeString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** The S256 code challenge for a PKCE verifier. */
export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export interface AuthUser {
  sub: string;
  email: string | null;
  name: string | null;
  /** Every claim, for anything the UI needs that isn't broken out above. */
  claims: Record<string, unknown>;
}

export class JwtDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtDecodeError";
  }
}

/**
 * Reads the claims out of a JWT for display purposes ONLY.
 *
 * This does not verify the signature, so nothing here may be used to make an
 * authorization decision - the API validates the token on every request and is
 * the only place that decides what the caller may do. A tampered token gets a
 * friendlier username in our chrome and 401s from the backend.
 *
 * Decoding goes through TextDecoder rather than atob alone because atob yields
 * latin1: a name with any non-ASCII character comes out mojibake otherwise.
 */
export function decodeJwtClaims(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1];
  if (!payload) throw new JwtDecodeError("token has no payload segment");

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder().decode(base64UrlDecodeToBytes(payload)),
    );
  } catch (cause) {
    throw new JwtDecodeError(`token payload is not valid JSON: ${cause}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new JwtDecodeError("token payload is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function toAuthUser(claims: Record<string, unknown>): AuthUser {
  return {
    sub: optionalString(claims.sub) ?? "",
    email: optionalString(claims.email),
    // Identity Center populates these inconsistently depending on the SAML
    // attribute mapping, so fall back through the plausible ones.
    name:
      optionalString(claims.name) ??
      optionalString(claims.given_name) ??
      optionalString(claims["cognito:username"]),
    claims,
  };
}
