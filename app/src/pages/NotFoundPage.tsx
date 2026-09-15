import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { audienceForWho, useWho } from "@/components/auth/AudienceGate";
import { useRouter } from "@/lib/router";
import { homeHrefFor } from "@/lib/nav";

/**
 * Any path the route table does not have.
 *
 * Deliberately not wrapped in PageLayout: that derives its heading from the route
 * registry, which falls back to the dashboard entry for an unknown path - so this
 * page would announce itself as "Dashboard".
 *
 * The way back follows the signed-in account rather than always pointing at "/",
 * which a student has no access to. The same reasoning as the top bar's home link.
 */
export default function NotFoundPage() {
  const router = useRouter();
  // Defaults to the admin dashboard while /whoami is still in flight, which is
  // audienceForWho's own documented behaviour for an unknown user.
  const homeHref = homeHrefFor(audienceForWho(useWho()));

  return (
    <Box padding={{ top: "xxl" }} textAlign="center">
      <SpaceBetween size="m" alignItems="center">
        {/* nosemgrep: jsx-not-internationalized */}
        <Header variant="h1">Page not found</Header>
        {/* nosemgrep: jsx-not-internationalized */}
        <Box variant="p" color="text-body-secondary">
          This console has no page at {window.location.pathname}.
        </Box>
        {/* nosemgrep: jsx-not-internationalized */}
        <Button variant="primary" onClick={() => router.push(homeHref)}>
          Go to {homeHref === "/me" ? "my notebook" : "the dashboard"}
        </Button>
      </SpaceBetween>
    </Box>
  );
}
