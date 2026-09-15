import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useRouter } from "@/lib/router";
import { useState } from "react";
import type { Student } from "@/lib/api/types";
import { studentDetailHref } from "@/lib/nav";
import {
  STUDENT_FILTERS,
  type StudentFilterId,
  filterStudents,
  formatPercent,
  formatStatus,
  formatUsd,
  percentUsed,
  statusIndicatorType,
  studentName,
} from "@/lib/students";
import StudentRowActions from "./StudentRowActions";
import { useStudentDialogs } from "./useStudentDialogs";

/**
 * Every provisioned student, filterable by status and searchable by text, with the
 * four per-student actions on each row and a link into each one's detail page.
 *
 * The 14-day sparkline column is deliberately absent for this round; the data
 * (`spendHistory`) is already in the payload, so it is a column to add rather than
 * a change to make.
 */
export default function StudentsTable({
  students,
  isLoading,
}: {
  students: Student[];
  isLoading: boolean;
}) {
  const [filterId, setFilterId] = useState<StudentFilterId>("all");
  const [query, setQuery] = useState("");
  const router = useRouter();
  const { onAction, busyFor, dialogs } = useStudentDialogs(students);

  const visible = filterStudents(students, filterId, query);
  const firstLoad = isLoading && students.length === 0;

  return (
    <>
    <Table<Student>
      items={visible}
      loading={firstLoad}
      loadingText="Loading students"
      variant="container"
      // Names the grid for a screen reader, which the visible h2 header does not
      // do. See the note in providers.tsx: the generic strings come from
      // I18nProvider, the table's own name has to be supplied per table.
      ariaLabels={{ tableLabel: "Students" }}
      // Keyed by id rather than index, so re-sorting or filtering cannot carry
      // one row's state onto another student.
      trackBy="studentId"
      stripedRows
      resizableColumns
      // Keeps the actions menu in the same place whatever the width: the table
      // scrolls horizontally at a narrow viewport, and a menu that scrolled out of
      // view would make the actions reachable only after finding them.
      stickyColumns={{ last: 1 }}
      columnDefinitions={[
        {
          id: "student",
          header: "Student",
          isRowHeader: true,
          cell: (student) => {
            const name = studentName(student);
            // The id is shown under the name rather than instead of it. Both
            // matter: the name is who the admin is talking about, the id is
            // what every AWS resource for that student is named after, so
            // hiding it would make the console unusable next to the console.
            //
            // Suppressed when it would repeat the line above it: studentName
            // already falls back to the id, and a row reading "s-002 / s-002"
            // spends two lines saying one thing.
            const secondary =
              student.studentEmail ??
              (name === student.studentId ? null : student.studentId);
            const href = studentDetailHref(student.studentId);
            return (
              <div>
                {/*
                  The name is the link, not a separate "View" action: it is what
                  the admin is already pointing at. `href` stays real so
                  middle-click and ctrl-click open a second tab, while the
                  onFollow routes it client-side - a full page load here would
                  discard the in-memory session and land on the sign-in screen.
                */}
                <Link
                  href={href}
                  fontSize="body-m"
                  onFollow={(event) => {
                    event.preventDefault();
                    router.push(href);
                  }}
                >
                  {name}
                </Link>
                {secondary !== null && (
                  <Box fontSize="body-s" color="text-body-secondary">
                    {secondary}
                  </Box>
                )}
              </div>
            );
          },
          sortingComparator: (a, b) =>
            studentName(a).localeCompare(studentName(b)),
        },
        {
          id: "instance",
          header: "Instance",
          cell: (student) => student.instanceType ?? "—",
          sortingComparator: (a, b) =>
            (a.instanceType ?? "").localeCompare(b.instanceType ?? ""),
        },
        {
          id: "usage",
          header: "Budget usage",
          cell: (student) => {
            // An em dash, not a 0% bar: a student with no percentage reported
            // yet has not spent nothing, it is not known what they have spent.
            if (student.percentUsed == null) return "—";
            const pct = percentUsed(student);
            // Over budget is shown as the figure, not as a bar. Cloudscape's
            // ProgressBar clamps its value to 100 and prints the clamped
            // number, so a student at 120% would render a full bar labelled
            // "100%" - identical to one who landed exactly on their limit, and
            // a quieter statement than the truth. A bar measures progress
            // towards a limit anyway; once the limit is passed there is no
            // progress left to show.
            if (pct > 100) {
              return (
                <StatusIndicator type="error">
                  {formatPercent(pct)}
                </StatusIndicator>
              );
            }
            return (
              <ProgressBar
                value={pct}
                // status is left at the default even for held students: passing
                // "error" replaces the bar with an icon, removing the very
                // information the column exists to show.
              />
            );
          },
          sortingComparator: (a, b) => percentUsed(a) - percentUsed(b),
        },
        {
          id: "spend",
          header: "Spend / budget",
          cell: (student) => (
            <Box fontSize="body-s">
              {/*
                tabular-nums, not a monospace font: it gives every digit the same
                advance width so the decimal points line up down the column and
                magnitudes can be compared at a glance, while keeping the
                Cloudscape typeface. (Box has no fontFamily prop - the old app
                passed one and it was silently dropped, so that column never
                actually aligned.)
              */}
              <span
                style={{
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {`${formatUsd(student.currentSpendUsd)} / ${formatUsd(
                  student.perStudentBudgetUsd,
                )}`}
              </span>
            </Box>
          ),
          sortingComparator: (a, b) =>
            percentUsed(a) - percentUsed(b) ||
            // Ties on percentage break on absolute spend, so two students both
            // at 0% still order predictably instead of arbitrarily.
            Number(a.currentSpendUsd ?? 0) - Number(b.currentSpendUsd ?? 0),
        },
        {
          id: "status",
          header: "Status",
          cell: (student) => (
            <StatusIndicator type={statusIndicatorType(student.status)}>
              {formatStatus(student.status)}
            </StatusIndicator>
          ),
          sortingComparator: (a, b) => a.status.localeCompare(b.status),
        },
        {
          id: "actions",
          header: "Actions",
          cell: (student) => (
            <StudentRowActions
              student={student}
              busy={busyFor(student.studentId)}
              onAction={onAction}
            />
          ),
          // Fixed and narrow: an icon-only trigger needs no more, and the space
          // is better spent on the columns carrying figures.
          width: 100,
          // Not sortable: there is nothing to order by.
          minWidth: 100,
        },
      ]}
      filter={
        <SpaceBetween direction="horizontal" size="s">
          <SegmentedControl
            selectedId={filterId}
            onChange={({ detail }) =>
              setFilterId(detail.selectedId as StudentFilterId)
            }
            options={STUDENT_FILTERS.map((f) => ({ id: f.id, text: f.text }))}
            label="Filter students by status"
          />
          <TextFilter
            filteringText={query}
            onChange={({ detail }) => setQuery(detail.filteringText)}
            filteringPlaceholder="Find a student"
            filteringAriaLabel="Find a student"
            // Reports against the segment, not the whole fleet, so the number
            // matches the rows actually on screen.
            countText={
              query ? `${visible.length} matches` : ""
            }
          />
        </SpaceBetween>
      }
      header={
        // No description: the page heading above already carries it, from the
        // route registry, and repeating it costs three lines at a narrow
        // viewport for no added information. The counter stays, because it is
        // the one thing here the page heading cannot know - it follows the
        // active segment and search, not the fleet size.
        <Header // nosemgrep: jsx-not-internationalized
          variant="h2"
          counter={firstLoad ? undefined : `(${visible.length})`}
        >
          Students
        </Header>
      }
      empty={
        <Box
          textAlign="center"
          color="text-body-secondary"
          padding={{ vertical: "s" }}
        >
          {/*
            Three distinct empty states. Collapsing them would leave the same
            blank table meaning "nothing provisioned", "your search found
            nothing" and "this segment is clear" - which need different actions.
          */}
          {students.length === 0
            ? "No students provisioned yet."
            : query
              ? `No students match "${query}".`
              : "No students in this category."}
        </Box>
      }
    />
      {dialogs}
    </>
  );
}
