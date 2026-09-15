import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import Table from "@cloudscape-design/components/table";
import type { SpendPoint } from "@/lib/api/types";
import { formatUsd, toNumber } from "@/lib/students";

/**
 * Daily spend as a table of figures.
 *
 * A table and not the line chart the Venue design shows, because the user asked
 * for numbers first and charts later - and for a fortnight of daily spend a table
 * is not obviously the worse choice: "which day did this jump" is answered by
 * reading a column, and the exact dollar amount is present rather than estimated
 * off an axis. The chart is an addition to this, not a replacement for it.
 */
export default function SpendHistoryTable({
  spendHistory,
}: {
  spendHistory: SpendPoint[] | null | undefined;
}) {
  const points = spendHistory ?? [];
  // Newest first: the question asked of this panel is nearly always "what is
  // happening now", and the answer should not be at the bottom of fourteen rows.
  // Copied before sorting - the array belongs to the SWR cache, and sorting in
  // place would mutate what every other reader of that cache sees.
  const rows = [...points].sort((a, b) => b.date.localeCompare(a.date));

  // Running total, computed oldest-first then read back per row, so each row can
  // say what the student had spent by the end of that day.
  const cumulative = new Map<string, number>();
  let total = 0;
  for (const point of [...rows].reverse()) {
    total += toNumber(point.spend);
    cumulative.set(point.date, total);
  }

  return (
    <Table<SpendPoint>
      items={rows}
      variant="container"
      trackBy="date"
      // Named because this table shares a page with the student's detail panels
      // and "table" alone would not say which of them a screen reader is in.
      ariaLabels={{ tableLabel: "Daily spend" }}
      header={
        // nosemgrep: jsx-not-internationalized
        <Header
          variant="h2"
          counter={rows.length === 0 ? undefined : `(${rows.length})`}
          description="One row per day, from the usage sync job. Newest first."
        >
          Daily spend
        </Header>
      }
      columnDefinitions={[
        {
          id: "date",
          header: "Date",
          isRowHeader: true,
          cell: (point) => point.date,
        },
        {
          id: "spend",
          header: "Spend",
          cell: (point) => (
            // tabular-nums so the decimal points line up down the column; see
            // the same note in StudentsTable.
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatUsd(point.spend)}
            </span>
          ),
        },
        {
          id: "cumulative",
          header: "Cumulative",
          cell: (point) => (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatUsd(cumulative.get(point.date) ?? 0)}
            </span>
          ),
        },
      ]}
      empty={
        <Box
          textAlign="center"
          color="text-body-secondary"
          padding={{ vertical: "s" }}
        >
          {/*
            The old console's wording, kept because it is right: an empty history
            is the normal state for a new student, not a fault, and the reason is
            worth stating so nobody goes looking for a broken panel.
          */}
          Not enough data yet. Spend accrues once the usage sync job has run at
          least twice.
        </Box>
      }
    />
  );
}
