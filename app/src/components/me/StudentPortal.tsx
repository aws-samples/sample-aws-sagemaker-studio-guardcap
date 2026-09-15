import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { useRouter } from "@/lib/router";
import DataAlert from "@/components/data/DataAlert";
import RefreshControl from "@/components/data/RefreshControl";
import PageLayout from "@/components/shell/PageLayout";
import SpendHistoryTable from "@/components/students/SpendHistoryTable";
import { ApiError } from "@/lib/api/client";
import type { MySummary } from "@/lib/api/types";
import { useMe, useMyUsage } from "@/lib/data/useMe";
import {
  formatPercent,
  formatStatus,
  formatUsd,
  statusIndicatorType,
  toNumber,
} from "@/lib/students";
import StudentUsagePanel from "./StudentUsagePanel";
import StudioAccessCard from "./StudioAccessCard";

/**
 * What a student sees about themselves: GET /me and GET /me/usage, plus the
 * button that opens their notebook.
 *
 * The whole page is read-only by construction - the student surface of the API is
 * three GETs, and neither the budget nor the hold can be changed from here. That
 * is the design, not a gap: raising your own cap is the one thing this platform
 * exists to prevent.
 *
 * Written for the student, not about them. The admin pages report on a fleet; this
 * one answers three questions its reader actually has - how much have I spent, am
 * I about to be cut off, and how do I get into my notebook.
 */
export default function StudentPortal() {
  const router = useRouter();
  const me = useMe();
  const usage = useMyUsage();
  const summary = me.data;

  // 403 means the token is valid and this account is not in the student group -
  // signing in again cannot help, so this is handled before DataAlert, which would
  // offer a retry that must fail. The likeliest visitor is an admin: they are
  // deliberately not in the student group and have no Studio profile of their own,
  // so there is no "view as student" and the honest thing is to say so and point
  // them back at the console.
  if (me.isForbidden) {
    return (
      <PageLayout title="Not a student account" description={null}>
        {/* nosemgrep: jsx-not-internationalized */}
        <Alert
          type="info"
          header="This account is not enrolled as a student"
          // nosemgrep: jsx-not-internationalized
          action={<Button onClick={() => router.push("/")}>Open the console</Button>}
        >
          This page shows one student their own notebook and spend, and only
          accounts in the student group can see it. Admin accounts manage students
          from the console instead - they have no notebook environment of their own,
          so there is nothing for this page to show them.
        </Alert>
      </PageLayout>
    );
  }

  // 404 is a different problem and needs a different answer: the sign-in worked and
  // the account is in the student group, but no student record carries this email -
  // so nothing has been provisioned for them, or it was provisioned against another
  // address. Neither is something the student can fix themselves.
  const noRecord = me.error instanceof ApiError && me.error.status === 404;
  if (noRecord) {
    return (
      <PageLayout title="No environment yet" description={null}>
        {/* nosemgrep: jsx-not-internationalized */}
        <Alert type="warning" header="No notebook environment is set up for you">
          You have signed in successfully, but the platform has no student record
          for this email address. Ask whoever runs your lab to check that you have
          been added - and to check which address they used, since that is what
          this page matches on.
        </Alert>
      </PageLayout>
    );
  }

  if (summary === null) {
    return (
      <PageLayout description={null}>
        <SpaceBetween size="l">
          <DataAlert
            error={me.error}
            isUnauthorized={me.isUnauthorized}
            isForbidden={me.isForbidden}
            isNetworkError={me.isNetworkError}
            isRefreshing={me.isRefreshing}
            onRefresh={me.refresh}
          />
          {me.error === null && (
            <Box textAlign="center" padding={{ vertical: "xxl" }}>
              <Spinner size="large" />
            </Box>
          )}
        </SpaceBetween>
      </PageLayout>
    );
  }

  const spend = toNumber(summary.currentSpendUsd);
  const budget = toNumber(summary.perStudentBudgetUsd);
  const pct = summary.percentUsed == null ? null : toNumber(summary.percentUsed);
  // Server-computed now, and read rather than re-derived: the API floors it at
  // zero and computes it against the same ledger row the cap is enforced from, so
  // recomputing here would only create a second answer that could disagree.
  // Falls back to the local subtraction for a deployment that predates the field.
  const remaining =
    summary.remainingUsd != null
      ? toNumber(summary.remainingUsd)
      : budget > 0
        ? Math.max(0, budget - spend)
        : null;
  // The figure a student can act on. Dollars answer "how much is left"; hours
  // answer "can I finish this tonight", which is the question actually being
  // asked in front of a notebook.
  const hoursLeft =
    summary.hoursRemaining == null ? null : toNumber(summary.hoursRemaining);

  function refreshAll() {
    me.refresh();
    usage.refresh();
  }

  return (
    <PageLayout
      actions={
        <RefreshControl
          fetchedAt={me.fetchedAt}
          isRefreshing={me.isRefreshing || usage.isRefreshing}
          onRefresh={refreshAll}
        />
      }
    >
      <SpaceBetween size="l">
        <DataAlert
          error={me.error}
          isUnauthorized={me.isUnauthorized}
          isForbidden={me.isForbidden}
          isNetworkError={me.isNetworkError}
          isRefreshing={me.isRefreshing}
          onRefresh={me.refresh}
        />

        <StatusExplanation summary={summary} />

        {/*
          First, above the figures: a student arriving here wants to get into their
          notebook, and the budget is what they check on the way past.
        */}
        <StudioAccessCard summary={summary} onRefresh={me.refresh} />

        <Container
          header={
            // nosemgrep: jsx-not-internationalized
            <Header variant="h2" description={budgetDescription(summary)}>
              Budget
            </Header>
          }
        >
          <KeyValuePairs
            columns={5}
            items={[
              { label: "Spent so far", value: formatUsd(spend) },
              {
                label: "Your budget",
                value: budget > 0 ? formatUsd(budget) : "—",
              },
              {
                label: "Left",
                value: remaining === null ? "—" : formatUsd(remaining),
              },
              {
                // Named for the machine they are on, because the conversion is
                // rate-specific: the same $40 is 28 hours on a t3.medium and 28
                // minutes of nothing like it on a g5.
                label: "Notebook hours left",
                value: hoursLeft === null ? "—" : formatHoursLeft(hoursLeft),
              },
              {
                label: "Used",
                value:
                  pct === null ? (
                    // Not a 0% bar: nothing reported does not mean nothing spent.
                    "—"
                  ) : pct > 100 ? (
                    // ProgressBar clamps at 100 and prints the clamped figure, so
                    // 130% would render identically to landing exactly on the
                    // limit. The real number instead - it is the whole point here.
                    <StatusIndicator type="error">
                      {formatPercent(pct)}
                    </StatusIndicator>
                  ) : (
                    <ProgressBar variant="key-value" value={pct} />
                  ),
              },
            ]}
          />
        </Container>

        {/* nosemgrep: jsx-not-internationalized */}
        <Container header={<Header variant="h2">Your environment</Header>}>
          <KeyValuePairs
            columns={4}
            items={[
              {
                label: "Status",
                value: (
                  <StatusIndicator type={statusIndicatorType(summary.status)}>
                    {formatStatus(summary.status)}
                  </StatusIndicator>
                ),
              },
              {
                // The cost lever the student controls. Named plainly, because
                // "compute status" does not tell anyone that leaving a notebook
                // running is what spends the money.
                label: "Notebook running",
                value: computeValue(summary.computeStatus),
              },
              {
                label: "Machine type",
                value: machineValue(summary),
              },
              { label: "Your student ID", value: summary.studentId },
            ]}
          />
        </Container>

        {/*
          Rendered only once /me/usage has answered, and its own failure is
          reported in place rather than escalated: the figures above are what
          decides whether this student can work today, and they come from /me.
        */}
        <DataAlert
          error={usage.error}
          isUnauthorized={usage.isUnauthorized}
          isForbidden={usage.isForbidden}
          isNetworkError={usage.isNetworkError}
          isRefreshing={usage.isRefreshing}
          onRefresh={usage.refresh}
        />
        {usage.data && <StudentUsagePanel usage={usage.data} />}

        <SpendHistoryTable
          spendHistory={usage.data?.spendHistory ?? summary.spendHistory}
        />
      </SpaceBetween>
    </PageLayout>
  );
}

/**
 * What the figures mean and how stale they can be, in the platform's own numbers.
 *
 * `enforcementLagMinutes` is the metering sweep interval, and it is read rather
 * than written into this sentence because it is a backend setting: this page used
 * to promise "every twenty minutes", which stopped being true when the sweep
 * moved to five and would silently lie again on the next change.
 */
function budgetDescription(summary: MySummary): string {
  const lag = summary.enforcementLagMinutes;
  const period = summary.billingPeriod;
  const freshness =
    typeof lag === "number" && lag > 0
      ? `updated every ${lag} minutes, so it can be up to ${lag} minutes behind`
      : "updated periodically by the platform";
  // The period is worth stating: a student who spent to their cap last month and
  // finds a full allowance today should be able to see why.
  return period
    ? `Your notebook spend for ${period} - ${freshness}.`
    : `Your notebook spend this month - ${freshness}.`;
}

/** Hours, and minutes once there is less than an hour to go. */
function formatHoursLeft(hours: number): string {
  if (hours <= 0) return "None left";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toFixed(1)} h`;
}

/** The machine, with what it costs per hour when the platform reports a rate. */
function machineValue(summary: MySummary) {
  if (!summary.instanceType) return "—";
  if (summary.hourlyRateUsd == null) return summary.instanceType;
  return `${summary.instanceType} · ${formatUsd(summary.hourlyRateUsd)}/h`;
}

/**
 * Yes or no, with the cost consequence attached.
 *
 * "RUNNING" is reported when a JupyterLab app is up - including one left open in a
 * browser tab days ago, which is the single most common way a student burns their
 * whole budget without doing any work.
 */
function computeValue(computeStatus: string | null | undefined) {
  if (!computeStatus) return "—";
  if (computeStatus === "RUNNING") {
    // "in-progress", not "success": green would read as "all good", and a notebook
    // left running is the single thing on this page the student should feel
    // prompted to act on.
    return ( // nosemgrep: jsx-not-internationalized
      <StatusIndicator type="in-progress">
        Yes - it is costing money now
      </StatusIndicator>
    );
  }
  if (computeStatus === "STOPPED") {
    return <StatusIndicator type="stopped">No</StatusIndicator>;
  }
  return formatStatus(computeStatus);
}

/**
 * The banner that says what is happening, when what is happening is not "normal".
 *
 * Every branch quotes the platform's own reason where it has one. `onHoldReason` is
 * written by whichever path held the environment - a budget breach, an admin
 * suspending them by hand, or their login being deleted outside the console - and
 * only that string distinguishes the three. Paraphrasing it would tell a student
 * their budget ran out when in fact someone deleted their account.
 */
function StatusExplanation({ summary }: { summary: MySummary }) {
  const reason = summary.onHoldReason?.trim();

  if (summary.status === "ON_HOLD" || summary.status === "SUSPENDED") {
    return (
      <Alert type="warning" header="Your notebook is paused">
        <SpaceBetween size="s">
          <Box variant="p">
            {reason ||
              "Your environment has been paused, and new notebook sessions are blocked until it is resumed."}
          </Box>
          {/*
            Said explicitly because it is the first thing a student panics about,
            and because it is true: the hold attaches a deny policy and stops the
            running app. The stack, the volume and the files all survive.
          */}
          <Box variant="p" color="text-body-secondary">{/* nosemgrep: jsx-not-internationalized */}
            Your files are not deleted. Ask whoever runs your lab to raise your
            budget or resume your environment, and your notebook will open again.
          </Box>
        </SpaceBetween>
      </Alert>
    );
  }

  if (summary.status === "PROVISIONING") {
    // nosemgrep: jsx-not-internationalized
    return (
      <Alert type="info" header="Your environment is being set up">
        This takes a few minutes. This page checks again on its own, so there is
        nothing to do but wait - the button above turns on when your notebook is
        ready.
      </Alert>
    );
  }

  if (summary.status === "PROVISION_FAILED") {
    // nosemgrep: jsx-not-internationalized
    return (
      <Alert type="error" header="Your environment could not be set up">
        Something went wrong while creating your notebook, and it is not something
        you can retry from here. Ask whoever runs your lab to look at it - they can
        see why it failed.
      </Alert>
    );
  }

  if (summary.status === "DELETING") {
    // nosemgrep: jsx-not-internationalized
    return (
      <Alert type="info" header="Your environment is being removed">
        Your notebook and the files stored on it are being deleted. If this is
        unexpected, contact whoever runs your lab now rather than later.
      </Alert>
    );
  }

  // ACTIVE. No banner: a page that shouts when nothing is wrong trains its reader
  // to ignore it on the day something is.
  return null;
}
