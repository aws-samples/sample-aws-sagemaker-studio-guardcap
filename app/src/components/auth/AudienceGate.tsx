import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { usePathname, useRouter } from "@/lib/router";
import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { useConfig } from "@/components/branding/BootstrapProvider";
import type { WhoAmI } from "@/lib/api/types";
import { useWhoami } from "@/lib/data/useWhoami";
import { audienceOf, findRoute, type Audience } from "@/lib/nav";

/**
 * What the backend says this user is, for any component that needs to know.
 *
 * Null when /whoami has not answered or could not be reached. Consumers must
 * treat that as "not known", never as "no access" - the API is the authority on
 * every individual request, and this only decides what to show.
 */
const AudienceContext = createContext<WhoAmI | null>(null);

export function useWho(): WhoAmI | null {
  return useContext(AudienceContext);
}

/** The audience this user should be shown, defaulting to admin while unknown. */
export function audienceForWho(who: WhoAmI | null): Audience {
  return who?.landing === "STUDENT" ? "student" : "admin";
}

/**
 * Sends each signed-in user to the part of the console they belong in, using
 * GET /whoami.
 *
 * Replaces reading `cognito:groups` off the id token. That claim is absent under
 * ORGANIZATION mode - Identity Center holds the groups and they never reach the
 * JWT - so a student there landed on the admin dashboard and learned they were
 * not an admin from a 403. The backend now answers the question directly, in
 * both modes, from the groups it can actually see.
 *
 * It is a redirect and a message, not an authorization boundary: every route
 * remains gated server-side, and this gate failing open changes nothing except
 * which page a 403 arrives on.
 */
export default function AudienceGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { config } = useConfig();
  const { whoami, isLoading, error } = useWhoami(true);

  const onStudentRoute = audienceOf(findRoute(pathname)) === "student";
  // A student who followed a link into the admin console, or who signed in at
  // "/" because that is where the Cognito callback lands.
  const misrouted = whoami?.landing === "STUDENT" && !onStudentRoute;

  useEffect(() => {
    // replace, not push: the page they never should have seen is not somewhere
    // Back ought to return to.
    if (misrouted) router.replace("/me");
  }, [misrouted, router]);

  if (isLoading) {
    return (
      <Box textAlign="center" padding={{ top: "xxxl" }}>
        {/* nosemgrep: jsx-not-internationalized */}
        <StatusIndicator type="loading">Loading your account</StatusIndicator>
      </Box>
    );
  }

  // Failing open. /whoami being unreachable is a platform fault, not a statement
  // about this user, and the alternative - locking everyone out of a console
  // whose other endpoints may be answering fine - is worse. The nav renders as
  // admin, and any route they may not call answers 403 as it always did.
  if (error) return <AudienceContext.Provider value={null}>{children}</AudienceContext.Provider>;

  if (whoami?.landing === "NONE") {
    return <NoAccess supportEmail={config.supportEmail} />;
  }

  // Rendered as a spinner rather than as the wrong page for the one frame before
  // the effect above runs.
  if (misrouted) {
    return (
      <Box textAlign="center" padding={{ top: "xxxl" }}>
        {/* nosemgrep: jsx-not-internationalized */}
        <StatusIndicator type="loading">Opening your notebook page</StatusIndicator>
      </Box>
    );
  }

  return (
    <AudienceContext.Provider value={whoami}>{children}</AudienceContext.Provider>
  );
}

/**
 * A valid sign-in with no role: the account authenticated, but it is in neither
 * the admin nor the student group.
 *
 * A real and fairly common state - someone added to the pool or the directory but
 * not yet to a group - and it deserves saying out loud. The alternative, which is
 * what happened before, was an empty console whose every panel showed a
 * permissions error, and which looked like the platform was broken.
 */
function NoAccess({ supportEmail }: { supportEmail?: string | null }) {
  return (
    <Box padding={{ top: "xxxl" }} textAlign="center">
      <Box display="inline-block" textAlign="left">
        <Alert type="info" header="Your account has no access to this platform yet">
          <SpaceBetween size="s">
            {/* nosemgrep: jsx-not-internationalized */}
            <Box variant="p">
              You have signed in successfully, but this account is not enrolled as
              a student and is not an administrator, so there is nothing here for
              it to show. Nothing is wrong with your login.
            </Box>
            {/* nosemgrep: jsx-not-internationalized */}
            <Box variant="p" color="text-body-secondary">
              Ask whoever runs your lab to add you
              {supportEmail ? (
                <>
                  {" - "}
                  <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link>
                </>
              ) : null}
              .
            </Box>
          </SpaceBetween>
        </Alert>
      </Box>
    </Box>
  );
}
