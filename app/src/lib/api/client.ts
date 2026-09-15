// Browser-side API client. There is no server of our own to proxy through, so
// this runs in the user's tab and the base URL is public by design - it is
// inlined into the bundle at build time.

// Exported because the console deep links on the student detail page derive the
// AWS region from it - see lib/aws.ts. Empty string when unset, which the callers
// there treat as "region unknown" and omit the link.
export const API_BASE_URL = import.meta.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// Set by the auth layer once a session exists. Branding is fetched before
// sign-in, so it must work with this still null.
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export class ApiError extends Error {
  /**
   * The API's own explanation, fit to show to a user.
   *
   * `message` keeps the full raw body for logs; this is the part worth putting in
   * front of a user. Empty when the body carried nothing usable - callers fall
   * back to quoting the status.
   */
  readonly detail: string;

  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    body: string,
  ) {
    super(`${method} ${path} failed: ${status} ${body}`);
    this.name = "ApiError";
    this.detail = extractDetail(body);
  }
}

/**
 * Pulls the human-readable reason out of a JSON error body, or falls back to the
 * raw text.
 *
 * `reason` first, then `error`, then `message`.
 *
 * `error` is the key the Lambda uses for every failure it raises itself -
 * `{"error": "Student s-014 not found"}`. `message` is API Gateway's own key,
 * which is what a 401 from the JWT authorizer or a 403 from a missing route
 * arrives as, before the function is ever invoked. Reading only `message`, as
 * this did, meant every reason the platform gave was discarded and the UI quoted
 * a bare status code instead.
 *
 * `reason` outranks both because exactly one route sends it, and it is the one
 * refusal a student is owed an explanation for: GET /me/studio-url answers a
 * suspension with `{error, status, reason}`, where `error` is the bare label
 * ("Notebook access is currently suspended") and `reason` is the hold text the
 * enforcement path wrote - which cap was hit, what it was, and that it resets
 * next month. Preferring `error` threw that away and told the student only that
 * they were suspended.
 */
function extractDetail(body: string): string {
  const trimmed = body.trim();
  if (trimmed === "") return "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object") {
      const { reason, error, message } = parsed as {
        reason?: unknown;
        error?: unknown;
        message?: unknown;
      };
      if (typeof reason === "string" && reason !== "") return reason;
      if (typeof error === "string" && error !== "") return error;
      return typeof message === "string" ? message : "";
    }
  } catch {
    // Not JSON. A plain-text body (an API Gateway 403, say) is still readable,
    // so it is passed through rather than discarded.
  }
  return trimmed;
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Skip the Authorization header even when a token exists. */
  anonymous?: boolean;
}

export async function request<T>(
  path: string,
  { body, anonymous, headers, ...init }: RequestOptions = {},
): Promise<T> {
  const method = init.method ?? "GET";
  const finalHeaders = new Headers(headers);
  if (body !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
  }
  if (authToken && !anonymous) {
    finalHeaders.set("Authorization", `Bearer ${authToken}`);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    throw new ApiError(res.status, method, path, await res.text());
  }
  // 204 has no body to parse.
  return res.status === 204 ? (null as T) : ((await res.json()) as T);
}
