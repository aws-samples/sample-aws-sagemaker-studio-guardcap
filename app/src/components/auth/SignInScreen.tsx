import {
  spaceScaledXl,
  spaceScaledXxxl,
} from "@cloudscape-design/design-tokens";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import BrandLogo from "@/components/branding/BrandLogo";
import { useConfig } from "@/components/branding/BootstrapProvider";
import SignInIllustration from "./SignInIllustration";

export interface SignInScreenProps {
  onSignIn: () => void;
  isSigningIn?: boolean;
  /** Message from a failed token exchange or a rejected callback. */
  error?: string | null;
  onDismissError?: () => void;
}

const MAX_CONTENT_WIDTH = 940;

export default function SignInScreen({
  onSignIn,
  isSigningIn = false,
  error = null,
  onDismissError,
}: SignInScreenProps) {
  const { config } = useConfig();
  // Both modes end at the same Cognito hosted UI, but what the person sees there
  // differs, and so should what this card promises them. Under ORGANIZATION mode
  // they are handed straight to their organization's login; under ACCOUNT mode
  // the hosted UI's own form is the login, using credentials this platform
  // issued. Reported by GET /init rather than guessed from token claims - there
  // is no token yet on this screen.
  const federated = config.identityMode !== "ACCOUNT";

  return (
    // Cloudscape has no page-centering primitive, so this small amount of
    // layout CSS is unavoidable. Spacing comes from design tokens rather than
    // magic numbers so it tracks the compact/comfortable density setting.
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingBlock: spaceScaledXxxl,
        paddingInline: spaceScaledXl,
        boxSizing: "border-box",
      }}
    >
      <div style={{ marginBlockEnd: spaceScaledXxxl }}>
        <BrandLogo height={44} />
      </div>

      <div style={{ width: "100%", maxWidth: MAX_CONTENT_WIDTH }}>
        {/* Stacks to one column below `xs`. Grid resolves breakpoints against
            its own measured width, not the viewport, so the key has to sit
            under MAX_CONTENT_WIDTH: Cloudscape's `m` is 1120px and would never
            match inside a 940px container. `xs` is 688px. */}
        <Grid
          gridDefinition={[
            { colspan: { default: 12, xs: 6 } },
            { colspan: { default: 12, xs: 6 } },
          ]}
        >
          <SpaceBetween size="l">
            {/* nosemgrep: jsx-not-internationalized */}
            <Box variant="h1" fontSize="display-l">
              Manage student GPU notebooks and spend in one place.
            </Box>
            {/* nosemgrep: jsx-not-internationalized */}
            <Box variant="p" color="text-body-secondary">
              Provision SageMaker Studio notebooks, track per-student AWS spend,
              and enforce budget holds automatically.{" "}
              {/* nosemgrep: jsx-not-internationalized */}
              <Link
                href="https://docs.aws.amazon.com/sagemaker/latest/dg/studio.html"
                external
              >
                Learn about SageMaker Studio
              </Link>
            </Box>
            <Box color="text-status-inactive" padding={{ top: "l" }}>
              <SignInIllustration />
            </Box>
          </SpaceBetween>

          <Container
            header={
              // nosemgrep: jsx-not-internationalized
              <Header
                variant="h2"
                description={
                  federated
                    ? `Access to ${config.appTitle} is managed by ${config.institutionName} through IAM Identity Center.`
                    : `Sign in with the ${config.appTitle} account ${config.institutionName} issued you.`
                }
              >
                Sign in
              </Header>
            }
          >
            <SpaceBetween size="l">
              {error && (
                <Alert
                  type="error"
                  header="Sign-in failed"
                  dismissible={Boolean(onDismissError)}
                  onDismiss={onDismissError}
                >
                  {error}
                </Alert>
              )}

              <Box variant="p" color="text-body-secondary">
                {federated
                  ? "You will be redirected to your organization's login page. No password is stored by this console."
                  : "You will be redirected to a secure sign-in page. No password is stored by this console."}
              </Box>

              <Button
                variant="primary"
                fullWidth
                loading={isSigningIn}
                loadingText="Redirecting to sign in"
                onClick={onSignIn}
                data-testid="signin-primary"
              >
                {federated ? "Sign in with IAM Identity Center" : "Sign in"}
              </Button>
            </SpaceBetween>
          </Container>
        </Grid>
      </div>
    </div>
  );
}
