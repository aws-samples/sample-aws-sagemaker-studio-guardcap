import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";

interface RefreshControlProps {
  /** Epoch ms of the last successful fetch, or null before the first one. */
  fetchedAt: number | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}

/**
 * "Updated <time>" plus a manual refresh button, for pages backed by polled data.
 *
 * The timestamp is what makes the 30-second auto-refresh trustworthy: without it
 * there is no way to tell live figures from figures frozen by a failed request.
 * Shown as an absolute wall-clock time rather than "20s ago" because a relative
 * label needs a per-second timer, and re-rendering the whole page every second to
 * animate one string is a poor trade.
 */
export default function RefreshControl({
  fetchedAt,
  isRefreshing,
  onRefresh,
}: RefreshControlProps) {
  return (
    <SpaceBetween direction="horizontal" size="xs" alignItems="center">
      <Box variant="small" color="text-body-secondary">
        {fetchedAt === null
          ? "Not yet loaded"
          : // Browser locale and timezone on purpose: unlike the USD figures,
            // this is the reader's own clock they are comparing against.
            `Updated ${new Date(fetchedAt).toLocaleTimeString()}`}
      </Box>
      <Button
        iconName="refresh"
        variant="icon"
        ariaLabel="Refresh data"
        // Disabling during a refresh both prevents a queue of redundant requests
        // and gives the click visible feedback, which an instant no-op would not.
        disabled={isRefreshing}
        loading={isRefreshing}
        onClick={onRefresh}
      />
    </SpaceBetween>
  );
}
