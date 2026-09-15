import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useConfig } from "@/components/branding/BootstrapProvider";
import type { MySummary } from "@/lib/api/types";
import OpenNotebookButton from "./OpenNotebookButton";

/**
 * How the student gets into their notebook - which is a different question in each
 * identity mode, so this card is the one place the difference is explained.
 *
 * The mode comes from GET /init, which is authoritative and, being
 * unauthenticated, is finally readable by a student. It used to be guessed from
 * the id token's claims, because the only endpoint that reported it was
 * admin-gated: `cognito:groups` present meant ACCOUNT, an `identities` array
 * meant ORGANIZATION. That guess decided which of these two branches rendered, so
 * getting it wrong showed an ORGANIZATION student a button that could never
 * issue a link - the API refuses on an SSO domain - or an ACCOUNT student a
 * pointer to an access portal that does not exist for them.
 *
 * Both branches are read-only descriptions of a mechanism the backend owns. The
 * button is the only interactive element, and it is gated on the server-computed
 * `canOpenNotebook` rather than on anything decided here.
 */
export default function StudioAccessCard({
  summary,
  onRefresh,
}: {
  summary: MySummary;
  onRefresh: () => void;
}) {
  const { config } = useConfig();

  if (config.identityMode === "ORGANIZATION") {
    return (
      <Container
        header={
          // nosemgrep: jsx-not-internationalized
          <Header
            variant="h2"
            description="Your notebook opens from your AWS access portal, not from this page."
          >
            Opening SageMaker Studio
          </Header>
        }
      >
        <SpaceBetween size="s">
          {/* nosemgrep: jsx-not-internationalized */}
          <Box variant="p">
            Sign in to the AWS access portal and choose the{" "}
            {/* nosemgrep: jsx-not-internationalized */}
            <b>Amazon SageMaker Studio</b> tile. It takes you straight into your own
            environment - there is no separate password for Studio, and nothing to
            copy from here.
          </Box>
          {/*
            Guidance and no link, rather than a button that cannot work. The portal
            URL is per-Identity Center instance and the platform does not report
            it, so anything rendered here would be a guess - and sending a student
            to the wrong sign-in page looks like their account is broken. The shape
            is shown so they can recognise the link their lab gave them.
          */}
          <Box variant="p" color="text-body-secondary">{/* nosemgrep: jsx-not-internationalized */}
            Use the access portal link your lab gave you - it looks like
            <Box variant="code" display="inline">
              {" "}
              https://d-xxxxxxxxxx.awsapps.com/start
            </Box>
            {config.supportEmail ? (
              <>
                . If you do not have it, ask {config.supportEmail}.
              </>
            ) : (
              <>. If you do not have it, ask whoever runs your lab.</>
            )}
          </Box>
        </SpaceBetween>
      </Container>
    );
  }

  return (
    <Container
      header={
        // nosemgrep: jsx-not-internationalized
        <Header
          variant="h2"
          description="One click, no extra password: the link below signs you straight in as yourself."
          actions={<OpenNotebookButton summary={summary} onRefresh={onRefresh} />}
        >
          Opening SageMaker Studio
        </Header>
      }
    >
      <SpaceBetween size="s">
        {/* nosemgrep: jsx-not-internationalized */}
        <Box variant="p">
          The button issues a fresh sign-in link each time and takes you straight to
          {/* nosemgrep: jsx-not-internationalized */}
          it. Each link works <b>once</b> and only for about{" "}
          {/* nosemgrep: jsx-not-internationalized */}
          <b>five minutes</b>, so there is nothing worth bookmarking - come back
          here and click again whenever you want to get in.
        </Box>
        {/*
          Both figures are AWS's own defaults for CreatePresignedDomainUrl, which is
          what the platform calls without overriding either: ExpiresInSeconds
          defaults to 300 (and cannot exceed it), and the session it opens lasts
          SessionExpirationDurationInSeconds, default 12 hours. The API does not
          report either number, so if the Lambda ever starts passing them, they
          should come back on /me/studio-url and be read from there instead of being
          restated here.
        */}
        <Box variant="p" color="text-body-secondary">{/* nosemgrep: jsx-not-internationalized */}
          Once you are in, the session stays open for up to 12 hours. Closing the
          browser tab does not stop your notebook - and a notebook left running
          {/* nosemgrep: jsx-not-internationalized */}
          keeps spending your budget, so use <b>File &gt; Shut Down</b> in Studio
          when you are finished for the day.
        </Box>
      </SpaceBetween>
    </Container>
  );
}
