import Box from "@cloudscape-design/components/box";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import SignInScreen from "./SignInScreen";

/**
 * The gate every page sits behind. Under a static export there is no server to
 * redirect an unauthenticated request, so the sign-in screen renders in place
 * at whatever route was requested - which is also why the intended path is
 * stashed before the Cognito redirect and restored on the way back.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { status, error, signIn, isSigningIn, dismissError } = useAuth();

  if (status === "loading") {
    return (
      <Box textAlign="center" padding={{ top: "xxxl" }}>
        {/* nosemgrep: jsx-not-internationalized */}
        <StatusIndicator type="loading">Signing in</StatusIndicator>
      </Box>
    );
  }

  if (status === "signed-in") return <>{children}</>;

  // "error" and "signed-out" share a screen: a failed sign-in still needs the
  // same button, and the alert carries the reason it failed.
  return (
    <SignInScreen
      onSignIn={signIn}
      isSigningIn={isSigningIn}
      error={error}
      onDismissError={dismissError}
    />
  );
}
