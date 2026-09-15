import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import type { ReactNode } from "react";
import type { Student } from "@/lib/api/types";
import {
  AT_RISK_PERCENT,
  formatPercent,
  formatUsd,
  summarizeFleet,
} from "@/lib/students";

/**
 * A large primary figure with its qualifier on the line beneath.
 *
 * The qualifier was inline at first, which read well for "5  3 running" but broke
 * for the longer spend one: trailing a display-l figure, "67% of $575.00" wrapped
 * mid-phrase and split the percentage from the amount it referred to. Stacking is
 * uniform across all four metrics and cannot wrap into nonsense at any width.
 */
function Metric({ value, note }: { value: ReactNode; note?: ReactNode }) {
  return (
    <div>
      {/*
        heading-xl rather than display-l, and nowrap: at 480px KeyValuePairs drops
        to two columns, and at display-l size "$387.50" broke across lines as
        "$387.5" / "0" - which does not just look wrong, it reads as a different
        number. nowrap makes a figure overflow its cell rather than ever split,
        because a misread total is worse than a cramped one.
      */}
      <Box fontSize="heading-xl" fontWeight="bold">
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
 * Fleet totals as plain numbers. Charts are deliberately out of this first round;
 * the spend trend returns as a BarChart later, and nothing here depends on it.
 */
export default function FleetOverview({
  students,
  isLoading,
}: {
  students: Student[];
  isLoading: boolean;
}) {
  const summary = summarizeFleet(students);

  // Showing zeroes while the first request is still in flight would read as a
  // real, empty fleet. An em dash reads as "not known yet".
  const pending = isLoading && students.length === 0;
  const num = (value: number) => (pending ? "—" : String(value));

  return (
    // nosemgrep: jsx-not-internationalized
    <Container header={<Header variant="h2">Fleet overview</Header>}>
      <KeyValuePairs
        columns={4}
        items={[
          {
            label: "Students provisioned",
            value: (
              <Metric
                value={num(summary.total)}
                note={pending ? undefined : `${summary.running} running`}
              />
            ),
          },
          {
            label: "Fleet spend",
            value: (
              <Metric
                value={pending ? "—" : formatUsd(summary.spendUsd)}
                note={
                  pending
                    ? undefined
                    : // "of $0.00" would be meaningless, so when no budget is set
                      // the qualifier is dropped rather than shown as 0%.
                      summary.spendPercent === null
                      ? "no budget set"
                      : `${formatPercent(summary.spendPercent)} of ${formatUsd(summary.budgetUsd)}`
                }
              />
            ),
          },
          {
            label: `Near budget (≥ ${AT_RISK_PERCENT}%)`,
            value: <Metric value={num(summary.nearBudget)} />,
          },
          {
            label: "On hold",
            value: <Metric value={num(summary.onHold)} />,
          },
        ]}
      />
    </Container>
  );
}
