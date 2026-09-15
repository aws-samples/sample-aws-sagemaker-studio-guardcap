import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import { useRouter } from "@/lib/router";
import { useAuth } from "@/components/auth/AuthProvider";

export interface DataAlertProps {
  error: Error | null;
  /** The failure was a 401, i.e. the session ended rather than the API breaking. */
  isUnauthorized: boolean;
  /**
   * The failure was a 403: the token is valid and this account is not permitted.
   * Optional, because a page that cannot be reached by the wrong audience has no
   * use for the branch.
   */
  isForbidden?: boolean;
  /** The request never completed, so there is no status code to report. */
  isNetworkError: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}

/**
 * The one banner every polled page shows when a fetch fails.
 *
 * Shared rather than copied per page because the failure modes need different
 * responses, and getting that wrong on one page is worse than not having the
 * banner at all: a 401 needs a sign-in button, a 403 must not offer a retry at
 * all, a network failure needs an explanation the status code cannot give, and
 * everything else needs a retry.
 *
 * Never dismissable. It clears itself when the next poll succeeds, and a
 * dismissed banner sitting over stale figures would leave the page looking live
 * when it is not.
 */
export default function DataAlert({
  error,
  isUnauthorized,
  isForbidden = false,
  isNetworkError,
  isRefreshing,
  onRefresh,
}: DataAlertProps) {
  const { signIn } = useAuth();
  const router = useRouter();
  if (!error) return null;

  if (isUnauthorized) {
    // nosemgrep: jsx-not-internationalized
    return (
      <Alert
        type="warning"
        header="Your session has ended"
        // nosemgrep: jsx-not-internationalized
        action={<Button onClick={signIn}>Sign in again</Button>}
      >
        Sign in again to keep using the console. Any figures on screen are from
        before the session ended.
      </Alert>
    );
  }

  // Before the network and generic branches, because both of those offer a Retry
  // and a 403 is not a transient failure: the sign-in worked, and the API has
  // decided this account may not have what the page is asking for. Retrying, or
  // signing in again with the same account, produces the same 403 forever.
  //
  // The likeliest cause is a student following an admin link, so the way out is
  // offered rather than just described - every admin route answers 403 to them, so
  // there is nothing on this page they can wait for.
  if (isForbidden) {
    // nosemgrep: jsx-not-internationalized
    return (
      <Alert
        type="warning"
        header="This account does not have access to this page"
        action={
          // nosemgrep: jsx-not-internationalized
          <Button onClick={() => router.push("/me")}>Open my notebook</Button>
        }
      >
        You are signed in, but this account is not an administrator of this
        platform, so it cannot see other people&apos;s students, budgets or spend.
        If you are a student here, your own notebook and spend are on your own
        page.
      </Alert>
    );
  }

  if (isNetworkError) {
    return (
      <Alert
        type="error"
        header="Could not reach the API"
        action={
          // nosemgrep: jsx-not-internationalized
          <Button onClick={onRefresh} loading={isRefreshing}>
            Retry
          </Button>
        }
      >
        {/*
          The browser reports a blocked request and a genuinely unreachable host
          identically, as a bare "Failed to fetch" with no status - so the cause
          has to be spelled out here or it looks like a bug in this page. The
          usual cause is the origin missing from the API's CORS allowlist, which
          makes the preflight fail before any status exists to report.
        */}
        The request did not complete, so the API returned no status code. The
        usual causes are this origin missing from the API&apos;s CORS allowlist,
        or the API being unreachable from this network.
      </Alert>
    );
  }

  return (
    <Alert
      type="error"
      header="Could not load the latest data"
      action={
        // nosemgrep: jsx-not-internationalized
        <Button onClick={onRefresh} loading={isRefreshing}>
          Retry
        </Button>
      }
    >
      {/*
        The raw message is shown rather than a generic apology because the
        audience is the admin who operates this platform, and the status code is
        the fastest route to the cause.
      */}
      {error.message}
    </Alert>
  );
}
