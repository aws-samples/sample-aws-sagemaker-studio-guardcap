import Button from "@cloudscape-design/components/button";
import { useState } from "react";
import { useNotifications } from "@/components/notifications/NotificationProvider";
import { ApiError } from "@/lib/api/client";
import { getMyStudioUrl } from "@/lib/api/me";
import type { MySummary } from "@/lib/api/types";

/**
 * The shortcut into the student's own SageMaker Studio.
 *
 * Under ORGANIZATION mode a student would open Studio from their Identity Center
 * portal tile and never come here. This is for ACCOUNT mode, where the Identity
 * Center instance is a local one that cannot offer a tile at all, so the platform
 * mints a presigned domain URL instead - this button is that tile's replacement.
 */
export default function OpenNotebookButton({
  summary,
  onRefresh,
}: {
  summary: MySummary;
  /** Re-reads /me, so a refusal updates the status the page is showing. */
  onRefresh: () => void;
}) {
  const { notify } = useNotifications();
  const [opening, setOpening] = useState(false);

  // Server-computed, not derived from `status` here: the API decides whether the
  // link will be issued, and re-deriving the condition would let this button
  // disagree with the endpoint the moment the backend adds a reason to refuse.
  const canOpen = summary.canOpenNotebook === true;

  async function open() {
    setOpening(true);
    try {
      const { url } = await getMyStudioUrl();
      // Same tab, via assign: the URL is single-use and short-lived, so it is
      // navigated to immediately rather than stored or rendered as an href. A new
      // tab would also be the wrong choice mechanically - this runs after an
      // await, so window.open is no longer inside the click gesture and popup
      // blockers eat it.
      window.location.assign(url);
      // `opening` is deliberately left true. The browser is leaving the page; the
      // button must not flick back to "Open my notebook" while it does, inviting a
      // second click that burns a second single-use URL.
    } catch (error) {
      setOpening(false);
      if (error instanceof ApiError) {
        // 403 is the enforcement path: suspended, or over budget. The reason comes
        // from the API because only it knows which, and the status on screen is
        // stale by definition - the refusal is news.
        if (error.status === 403) {
          onRefresh();
          notify({
            type: "warning",
            header: "Your notebook is not available right now",
            content:
              error.detail ||
              "Access is currently suspended. See the status on this page.",
          });
          return;
        }
        if (error.status === 409) {
          onRefresh();
          notify({
            type: "info",
            header: "Your environment is still being set up",
            content:
              error.detail ||
              "This takes a few minutes. Try again shortly - the status on this page updates on its own.",
          });
          return;
        }
        if (error.status === 401) {
          notify({
            type: "error",
            header: "Your session has ended",
            content: "Sign in again, then reopen your notebook.",
          });
          return;
        }
        notify({
          type: "error",
          header: "Could not open your notebook",
          content: error.detail || `The platform returned ${error.status}.`,
        });
        return;
      }
      notify({
        type: "error",
        header: "Could not open your notebook",
        content:
          "The request did not reach the platform. Check your connection and try again.",
      });
    }
  }

  // nosemgrep: jsx-not-internationalized
  return (
    <Button
      variant="primary"
      // Disabled rather than hidden: a missing button reads as a broken page, and
      // the reason it cannot be used is stated in the alert above it.
      disabled={!canOpen}
      loading={opening}
      onClick={() => void open()}
      data-testid="open-notebook"
    >
      Open my notebook
    </Button>
  );
}
