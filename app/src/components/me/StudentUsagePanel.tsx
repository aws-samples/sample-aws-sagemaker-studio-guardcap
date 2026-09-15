import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import type { MyUsage, UsageSession } from "@/lib/api/types";
import { formatUsd, toNumber } from "@/lib/students";

/**
 * Where the student's money went: hours by machine type, and one row per
 * notebook session.
 *
 * All of this is new, and it is new because the platform now meters its own
 * usage. Spend used to come from AWS Budgets, which reported a single total a few
 * times a day - so there was nothing to break down and no way to say which
 * sitting cost what. The usage sync job now samples every running app and accrues
 * against a per-session ledger row, and this panel is that ledger.
 */
export default function StudentUsagePanel({ usage }: { usage: MyUsage }) {
  const sessions = usage.sessions ?? [];
  // Newest first, and copied before sorting: the array belongs to the SWR cache,
  // and sorting in place would mutate what every other reader sees.
  const rows = [...sessions].sort((a, b) =>
    (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
  );

  const byType = Object.entries(usage.byInstanceType ?? {}).sort(
    (a, b) => toNumber(b[1]) - toNumber(a[1]),
  );

  return (
    <SpaceBetween size="l">
      <Container
        header={
          // nosemgrep: jsx-not-internationalized
          <Header
            variant="h2"
            description={
              usage.capCovers ??
              "Notebook compute hours only. Persistent storage is not counted."
            }
          >
            Where it went
          </Header>
        }
      >
        <SpaceBetween size="l">
          <KeyValuePairs
            columns={byType.length > 0 ? 4 : 2}
            items={[
              {
                label: "Notebook hours this month",
                value: formatHours(usage.totalHours),
              },
              {
                label: "Spent so far",
                value: formatUsd(usage.currentSpendUsd),
              },
              // One pair per machine type, largest first. A student on a GPU
              // instance who has also left a t3.medium running wants to know
              // which of the two is eating their budget, and the total cannot
              // say. Capped at two so the row does not wrap - the table below
              // has the rest, and a lab student has one or two types in practice.
              ...byType.slice(0, 2).map(([instanceType, spend]) => ({
                label: instanceType,
                value: formatUsd(spend),
              })),
            ]}
          />
          {/* nosemgrep: jsx-not-internationalized */}
          {usage.ratesAsOf ? (
            <Box variant="small" color="text-body-secondary">
              Costs are calculated from published us-east-1 notebook prices as of{" "}
              {usage.ratesAsOf}, not from your lab&apos;s AWS bill, so they can
              differ from it by a few cents.
            </Box>
          ) : null}
        </SpaceBetween>
      </Container>

      <Table<UsageSession>
        items={rows}
        variant="container"
        trackBy="appName"
        // This is the one table a student sees, and it is the figure their cap
        // is enforced on, so it is worth naming precisely.
        ariaLabels={{ tableLabel: "My sessions" }}
        header={
          // nosemgrep: jsx-not-internationalized
          <Header
            variant="h2"
            counter={rows.length === 0 ? undefined : `(${rows.length})`}
            description="Each notebook the platform has seen running this month, and what it has charged you for so far."
          >
            My sessions
          </Header>
        }
        columnDefinitions={[
          {
            id: "started",
            header: "Started",
            isRowHeader: true,
            cell: (session) => formatMoment(session.startedAt),
          },
          {
            id: "counted-to",
            header: "Counted up to",
            // Not "Ended", because nothing observes an app stopping - only that it
            // was gone by the next sweep. This is the last instant the meter can
            // vouch for, which is also the last instant the student was charged
            // for, so it is the honest column to show.
            cell: (session) => formatMoment(session.lastSampledAt),
          },
          {
            id: "hours",
            header: "Hours",
            cell: (session) => (
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatHours(session.hours)}
              </span>
            ),
          },
          {
            id: "instance",
            header: "Machine",
            cell: (session) => session.instanceType || "—",
          },
          {
            id: "rate",
            header: "Rate",
            cell: (session) =>
              session.hourlyRateUsd == null ? (
                "—"
              ) : (
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatUsd(session.hourlyRateUsd)}/h
                </span>
              ),
          },
          {
            id: "cost",
            header: "Cost",
            cell: (session) => (
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatUsd(session.accruedUsd)}
              </span>
            ),
          },
          {
            id: "status",
            header: "Status",
            cell: (session) =>
              // nosemgrep: jsx-not-internationalized
              session.status === "ACTIVE" ? (
                // The one row on this page worth acting on: an active session is
                // still spending. "in-progress" and not "success" for that reason.
                <StatusIndicator type="in-progress">
                  Running - still counting
                </StatusIndicator>
              // nosemgrep: jsx-not-internationalized
              ) : (
                <StatusIndicator type="stopped">Stopped</StatusIndicator>
              ),
          },
        ]}
        empty={
          // nosemgrep: jsx-not-internationalized
          <Box
            textAlign="center"
            color="text-body-secondary"
            padding={{ vertical: "s" }}
          >
            No notebook sessions yet this month. A session appears here within a few
            minutes of you opening a notebook.
          </Box>
        }
      />
    </SpaceBetween>
  );
}

/** One decimal place, and the unit spelled out: "3.4 h" reads as a duration. */
function formatHours(value: UsageSession["hours"]): string {
  if (value == null) return "—";
  const hours = toNumber(value);
  // Below six minutes, hours rounds to 0.0 and reads as "nothing", which is
  // wrong for a session that has only just started.
  if (hours > 0 && hours < 0.1) return "< 0.1 h";
  return `${hours.toFixed(1)} h`;
}

/**
 * Local time, and the date only when it is not today's - a list of sittings is
 * read as "when today", and repeating the date on every row buries the time it is
 * actually about.
 */
function formatMoment(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const time = at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const today = new Date();
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  if (sameDay) return time;
  return `${at.toLocaleDateString(undefined, { day: "2-digit", month: "short" })} ${time}`;
}
