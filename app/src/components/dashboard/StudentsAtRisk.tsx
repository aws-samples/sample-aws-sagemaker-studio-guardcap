import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import { useRouter } from "@/lib/router";
import type { Student } from "@/lib/api/types";
import {
  AT_RISK_PERCENT,
  atRiskStudents,
  formatPercent,
  formatStatus,
  formatUsd,
  percentUsed,
  statusIndicatorType,
  studentName,
} from "@/lib/students";

/**
 * The students an admin might have to act on, worst first. This is the whole
 * point of the dashboard: everyone else needs no attention, so they are not here.
 */
export default function StudentsAtRisk({
  students,
  isLoading,
}: {
  students: Student[];
  isLoading: boolean;
}) {
  const router = useRouter();
  const atRisk = atRiskStudents(students);

  return (
    <Table<Student>
      items={atRisk}
      loading={isLoading && students.length === 0}
      loadingText="Loading students"
      variant="container"
      // Deliberately not just "Students": this table and StudentsTable both
      // render students, and the dashboard shows this one alongside
      // FleetOverview, so the name has to distinguish the two.
      ariaLabels={{ tableLabel: "Students at risk" }}
      // Every row is keyed by the id rather than by index, so a student moving up
      // the sort order as their spend rises does not carry another row's state.
      trackBy="studentId"
      columnDefinitions={[
        {
          id: "student",
          header: "Student",
          cell: (student) => studentName(student),
          isRowHeader: true,
        },
        {
          id: "usage",
          header: "Budget usage",
          cell: (student) => (
            <ProgressBar
              // Capped at 100 because ProgressBar cannot render an overrun, and
              // the real figure is still spelled out in additionalInfo.
              value={Math.min(100, percentUsed(student))}
              // Left at the default "in-progress" even for held students. Passing
              // status="error" replaces the bar with an error icon, so the one
              // person furthest over budget became the only one whose usage was
              // invisible. Being held is already carried by the Status column and
              // by the percentage in additionalInfo.
              additionalInfo={`${formatUsd(student.currentSpendUsd)} of ${formatUsd(
                student.perStudentBudgetUsd,
              )} (${formatPercent(percentUsed(student))})`}
            />
          ),
        },
        {
          id: "instance",
          header: "Instance type",
          cell: (student) => student.instanceType ?? "—",
        },
        {
          id: "status",
          header: "Status",
          cell: (student) => (
            <StatusIndicator type={statusIndicatorType(student.status)}>
              {formatStatus(student.status)}
            </StatusIndicator>
          ),
        },
      ]}
      header={
        // nosemgrep: jsx-not-internationalized
        <Header
          variant="h2"
          counter={isLoading && !students.length ? undefined : `(${atRisk.length})`}
          description={`Active students at or above ${AT_RISK_PERCENT}% of budget, plus anyone on hold or suspended.`}
          actions={
            // nosemgrep: jsx-not-internationalized
            <Button variant="normal" onClick={() => router.push("/students")}>
              View all students
            </Button>
          }
        >
          Students at risk
        </Header>
      }
      empty={
        <Box textAlign="center" color="text-body-secondary" padding={{ vertical: "s" }}>
          {/* Distinguishes a healthy fleet from an empty one - otherwise the same
              blank table would mean both "nothing to worry about" and "nothing
              provisioned", which need very different responses. */}
          {students.length === 0
            ? "No students provisioned yet."
            : "No students near budget right now."}
        </Box>
      }
    />
  );
}
