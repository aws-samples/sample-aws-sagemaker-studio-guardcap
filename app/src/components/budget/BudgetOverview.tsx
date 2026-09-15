import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import type { ReactNode } from "react";
import type { AlarmEvent, Student } from "@/lib/api/types";
import { summarizeBudget } from "@/lib/alarms";
import { AT_RISK_PERCENT, formatPercent, formatUsd } from "@/lib/students";

/** Matches the dashboard's Metric: a large figure, its qualifier beneath. */
function Metric({ value, note }: { value: ReactNode; note?: ReactNode }) {
  return (
    <div>
      <Box fontSize="heading-xl" fontWeight="bold">
        {/* nowrap for the same reason as the dashboard: a currency figure broken
            across lines reads as a different, smaller number. */}
        <span style={{ whiteSpace: "nowrap" }}>{value}</span>
      </Box>
      {note !== undefined && (
        <Box fontSize="body-s" color="text-body-secondary">
          {note}
        </Box>
      )}
    </div>
  );
}

/**
 * A count that is only worth attention when it is above zero.
 *
 * Rendered as a status indicator rather than a bare number so that "0 students
 * over budget" is visibly green and reassuring, while any non-zero value is
 * visibly not - the distinction an admin is scanning this page for.
 */
function Count({
  value,
  type,
  pending,
}: {
  value: number;
  type: StatusIndicatorProps.Type;
  pending: boolean;
}) {
  if (pending) return <Metric value="—" />;
  return (
    <StatusIndicator type={value > 0 ? type : "success"}>
      {value === 1 ? "1 student" : `${value} students`}
    </StatusIndicator>
  );
}

export default function BudgetOverview({
  students,
  events,
  isLoading,
}: {
  students: Student[];
  events: AlarmEvent[];
  isLoading: boolean;
}) {
  const summary = summarizeBudget(students, events);
  // Zeroes during the first request would read as a real, empty platform.
  const pending = isLoading && students.length === 0;

  return (
    <Container
      header={
        // nosemgrep: jsx-not-internationalized
        <Header
          variant="h2"
          description="Aggregate AWS spend and budget utilization across all provisioned students for the current billing period."
        >
          Platform budget overview
        </Header>
      }
    >
      <KeyValuePairs
        columns={4}
        items={[
          {
            label: "Total allocated budget",
            value: (
              <Metric value={pending ? "—" : formatUsd(summary.budgetUsd)} />
            ),
          },
          {
            label: "Total current spend",
            value: (
              // No percentage note here: the "Budget utilization" pair below
              // already states it, colour-coded, and the same figure appearing
              // twice in one grid reads as two different measures.
              <Metric value={pending ? "—" : formatUsd(summary.spendUsd)} />
            ),
          },
          {
            label: "Active students",
            value: (
              <Metric
                value={pending ? "—" : String(summary.activeStudents)}
                note={pending ? undefined : "accruing spend"}
              />
            ),
          },
          {
            label: "Enforcement actions",
            value: (
              <Metric
                value={pending ? "—" : String(summary.enforcementActions)}
                note={pending ? undefined : "this period"}
              />
            ),
          },
          {
            label: "Students over budget",
            value: (
              <Count value={summary.overBudget} type="error" pending={pending} />
            ),
          },
          {
            // Non-breaking space: at a narrow viewport the label wraps, and
            // breaking "≥ 80%" across two lines splits the comparison from the
            // number it applies to.
            label: `Nearing threshold (≥ ${AT_RISK_PERCENT}%)`,
            value: (
              <Count
                value={summary.nearingThreshold}
                type="warning"
                pending={pending}
              />
            ),
          },
          {
            label: "Students on hold",
            value: (
              <Count value={summary.onHold} type="error" pending={pending} />
            ),
          },
          {
            label: "Budget utilization",
            value: pending ? (
              <Metric value="—" />
            // nosemgrep: jsx-not-internationalized
            ) : summary.utilizationPercent === null ? (
              // Distinguished from 0%: no budget allocated is a setup problem,
              // not a healthy platform with no spend.
              <StatusIndicator type="info">
                No budget allocated
              </StatusIndicator>
            ) : (
              <StatusIndicator
                type={
                  summary.utilizationPercent >= 100
                    ? "error"
                    : summary.utilizationPercent >= AT_RISK_PERCENT
                      ? "warning"
                      : "success"
                }
              >
                {/*
                  "58% used", not "58% of total budget used": StatusIndicator
                  breaks its text mid-word rather than overflowing, so at 480px
                  the longer phrase rendered as "58% of total budg / et used".
                  The label above the value already says which budget, so the
                  words that wrapped were the ones adding nothing.
                */}
                {`${formatPercent(summary.utilizationPercent)} used`}
              </StatusIndicator>
            ),
          },
        ]}
      />
    </Container>
  );
}
