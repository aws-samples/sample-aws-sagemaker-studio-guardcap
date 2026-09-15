import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useState } from "react";
import type { AlarmEvent } from "@/lib/api/types";
import {
  alarmStatus,
  CLASS_POOL_ID,
  formatAlarmType,
  formatEnforcementAction,
  formatTimestamp,
  matchesEventSearch,
  sortEventsByTime,
} from "@/lib/alarms";
import { formatUsd } from "@/lib/students";

const PAGE_SIZE = 10;

export default function AlarmEventsTable({
  events,
  isLoading,
}: {
  events: AlarmEvent[];
  isLoading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(1);

  const matching = sortEventsByTime(events).filter((e) =>
    matchesEventSearch(e, query),
  );
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  // Clamped rather than trusted: a poll that shrinks the list - or a search that
  // narrows it - can leave pageIndex past the end, which would render an empty
  // table on what looks like a valid page.
  const safePage = Math.min(pageIndex, pageCount);
  const pageItems = matching.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const firstLoad = isLoading && events.length === 0;

  return (
    <Table<AlarmEvent>
      items={pageItems}
      loading={firstLoad}
      loadingText="Loading alarm events"
      variant="container"
      // The visible <Header> is an h2 that a screen reader reaches separately
      // from the grid, so without this the table itself announces as an unnamed
      // table. Every other string these controls need - the resize handles, the
      // pagination arrows below - comes from the I18nProvider in providers.tsx;
      // only the name of this particular table has to be given here.
      ariaLabels={{ tableLabel: "Budget alarm events" }}
      // eventId is the table's own partition key - a uuid4 the handler mints per
      // event - so it is the identity, and the student-plus-instant composite is
      // only the fallback for a row that predates it being returned. That
      // composite is not actually unique: the class-pool check and a student
      // breach can both fire inside one sweep, and two events for the same
      // student in the same second would have collided.
      trackBy={(event) =>
        event.eventId ??
        `${event.studentId ?? "?"}#${event.alarmTimestamp ?? "?"}`
      }
      stripedRows
      resizableColumns
      columnDefinitions={[
        {
          id: "student",
          header: "Student",
          isRowHeader: true,
          // CLASS_POOL is not a student: it is the sentinel the class-wide pool
          // check records its own events under, so this column would otherwise
          // show an id no student page can open. Guarded for absence too, because
          // the old code guarded it - the only evidence available that the
          // backend may omit it.
          cell: (event) =>
            event.studentId === CLASS_POOL_ID
              ? "Whole class"
              : (event.studentId ?? "—"),
          // Explicit widths on every column but the last. Left to distribute
          // evenly, the two humanized columns truncate to "Budget threshold
          // breach..." and "Apps stopped, creation d..." - and both are the
          // point of the row. The ids and timestamps are fixed-length, so the
          // slack belongs to the labels. Still resizable from here.
          width: 110,
        },
        {
          id: "alarmTime",
          header: "Alarm time",
          cell: (event) => formatTimestamp(event.alarmTimestamp),
          width: 200,
        },
        {
          id: "alarmType",
          header: "Alarm type",
          cell: (event) => formatAlarmType(event.alarmType),
          width: 250,
        },
        {
          id: "spendAtAlarm",
          header: "Spend at alarm",
          cell: (event) => (
            <Box fontSize="body-s">
              {/* tabular-nums aligns the decimal points down the column - see
                  the same note in StudentsTable. */}
              <span
                style={{
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {`${formatUsd(event.spendAtAlarmUsd)} / ${formatUsd(event.budgetUsd)}`}
              </span>
            </Box>
          ),
          width: 190,
        },
        {
          id: "enforcementAction",
          header: "Enforcement action",
          cell: (event) => formatEnforcementAction(event.enforcementAction),
          width: 260,
        },
        {
          id: "status",
          header: "Status",
          cell: (event) => {
            const { type, label } = alarmStatus(event.status);
            return <StatusIndicator type={type}>{label}</StatusIndicator>;
          },
        },
      ]}
      filter={
        <TextFilter
          filteringText={query}
          onChange={({ detail }) => {
            setQuery(detail.filteringText);
            // Back to page 1: staying on page 3 of a now-shorter result set
            // would show nothing and look like the search found nothing.
            setPageIndex(1);
          }}
          filteringPlaceholder="Find alarm events"
          filteringAriaLabel="Find alarm events"
          countText={query ? `${matching.length} matches` : ""}
        />
      }
      pagination={
        <Pagination
          currentPageIndex={safePage}
          pagesCount={pageCount}
          onChange={({ detail }) => setPageIndex(detail.currentPageIndex)}
        />
      }
      header={
        // nosemgrep: jsx-not-internationalized
        <Header
          variant="h2"
          counter={firstLoad ? undefined : `(${matching.length})`}
          description="Budget alarm events for the current billing period. A student with an enforcement action applied has had their SageMaker Studio apps stopped and new app creation denied."
        >
          Budget alarm events
        </Header>
      }
      empty={
        <Box
          textAlign="center"
          color="text-body-secondary"
          padding={{ vertical: "s" }}
        >
          {events.length === 0
            ? "No alarm events yet. Events appear here the first time a student crosses 80% or 100% of their budget."
            : `No events match "${query}".`}
        </Box>
      }
    />
  );
}
