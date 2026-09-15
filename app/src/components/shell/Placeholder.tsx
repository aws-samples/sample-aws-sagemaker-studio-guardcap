import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

/**
 * Stands in for a page whose content is a later step. Temporary by design: it
 * exists so the routes are real and the shell can be navigated and verified
 * now, and each use is deleted as that page is built. An empty page would look
 * like a load failure instead.
 */
export default function Placeholder({ children }: { children: string }) {
  return (
    <Container>
      <Box padding={{ vertical: "l" }} textAlign="center">
        <StatusIndicator type="pending">{children}</StatusIndicator>
      </Box>
    </Container>
  );
}
