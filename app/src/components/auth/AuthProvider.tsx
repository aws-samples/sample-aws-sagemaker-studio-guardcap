import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "@/lib/router";
import { useConfig } from "@/components/branding/BootstrapProvider";
import { setAuthToken } from "@/lib/api/client";
import {
  consumeReturnTo,
  getCurrentUser,
  initSession,
  redirectToSignIn,
  signOut,
} from "@/lib/auth/cognito";
import type { AuthUser } from "@/lib/auth/pkce";

export type AuthStatus = "loading" | "signed-out" | "signed-in" | "error";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  /** Starts the redirect to Identity Center. */
  signIn: () => void;
  signOut: () => void;
  /** True between the click and the browser actually leaving the page. */
  isSigningIn: boolean;
  dismissError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Please sign in again.";
/** setTimeout overflows past this and fires immediately. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // The Cognito coordinates arrive from GET /init, so nothing here may run
  // before it has settled: the token exchange posts to the hosted UI domain it
  // reports, and doing it against a stale default would fail on a deployment
  // that relies on runtime configuration.
  const { isReady } = useConfig();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    // `status` stays "loading" until then, which RequireAuth already renders as
    // a spinner. /init is one cached request, so the wait is not perceptible.
    if (!isReady) return;

    let active = true;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;

    function expire() {
      setAuthToken(null);
      setUser(null);
      setError(SESSION_EXPIRED_MESSAGE);
      setStatus("signed-out");
    }

    // initSession() is memoized in the service, so React's double-invoked
    // development effect cannot redeem the single-use code twice. The `active`
    // flag only guards against setting state after unmount.
    initSession()
      .then((session) => {
        if (!active) return;
        if (!session) {
          setAuthToken(null);
          setStatus("signed-out");
          return;
        }

        // Tokens are in memory only and never refreshed, so the session has a
        // hard end. Without this the UI would keep claiming to be signed in
        // while every API call 401s, which reads as the app being broken.
        const msRemaining = session.expiresAt - Date.now();
        if (msRemaining <= 0) {
          expire();
          return;
        }

        setAuthToken(session.idToken);
        setUser(session.user);
        setStatus("signed-in");

        // Cognito can only call back to the one registered redirect_uri, so a
        // deep link arrives here as "/" plus a stashed destination. It has to
        // go through the router: history.replaceState would move the address
        // bar without moving the rendered page.
        const returnTo = consumeReturnTo();
        if (returnTo && returnTo !== window.location.pathname + window.location.search) {
          // replace, not push: the callback URL is not somewhere Back should return to.
          router.replace(returnTo);
        }
        // Delays above 2^31-1 ms overflow and fire immediately, so clamp.
        expiryTimer = setTimeout(expire, Math.min(msRemaining, MAX_TIMEOUT_MS));
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setAuthToken(null);
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus("error");
      });

    return () => {
      active = false;
      if (expiryTimer) clearTimeout(expiryTimer);
    };
    // router is stable for the app's lifetime; initSession() is memoized, so
    // re-running this would be a no-op anyway. isReady only ever flips once.
  }, [router, isReady]);

  const signIn = useCallback(() => {
    setIsSigningIn(true);
    setError(null);
    // Navigating away is the success path, so this only settles on failure.
    redirectToSignIn().catch((cause: unknown) => {
      setIsSigningIn(false);
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    });
  }, []);

  const handleSignOut = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    signOut();
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
    // An error only ever arises from a failed sign-in attempt, so the honest
    // state behind the dismissed alert is signed-out.
    setStatus((current) => (current === "error" ? "signed-out" : current));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        error,
        signIn,
        signOut: handleSignOut,
        isSigningIn,
        dismissError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Re-exported so callers don't reach past the provider into the service. */
export { getCurrentUser };
