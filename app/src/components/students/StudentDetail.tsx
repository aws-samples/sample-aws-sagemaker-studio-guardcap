import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { useRouter } from "@/lib/router";
import type { ReactNode } from "react";
import DataAlert from "@/components/data/DataAlert";
import RefreshControl from "@/components/data/RefreshControl";
import PageLayout from "@/components/shell/PageLayout";
import { useSubCrumb } from "@/components/shell/SubCrumb";
import { formatTimestamp } from "@/lib/alarms";
import { ApiError, API_BASE_URL } from "@/lib/api/client";
import {
  stackConsoleUrl,
  studentRegion,
  studioDomainConsoleUrl,
} from "@/lib/aws";
import { useFleet } from "@/lib/data/useFleet";
import { useStudent } from "@/lib/data/useStudent";
import { studentDetailHref } from "@/lib/nav";
import {
  formatHoldKind,
  formatPercent,
  formatStatus,
  formatUsd,
  percentUsed,
  statusIndicatorType,
  studentName,
} from "@/lib/students";
import ArnValue from "./ArnValue";
import SpendHistoryTable from "./SpendHistoryTable";
import StudentRowActions from "./StudentRowActions";
import StudentSettingsForm from "./StudentSettingsForm";
import { useStudentDialogs } from "./useStudentDialogs";

/** Em dash for an unreported value: a blank cell reads as a rendering fault. */
function orDash(value: string | null | undefined): ReactNode {
  return value ? value : "—";
}

/**
 * Everything the API knows about one student, and every action that can be taken
 * on them.
 *
 * Reached from the table at `/students?student=<id>` rather than `/students/<id>`,
 * because a static export has to know every path at build time and student ids
 * only exist at runtime.
 */
export default function StudentDetail({ studentId }: { studentId: string }) {
  const router = useRouter();
  // The fleet list, read from the SWR cache this page shares with the table - so
  // arriving here from a row costs no extra request and shows figures on the first
  // frame instead of a spinner.
  const { students } = useFleet();
  const detail = useStudent(studentId);

  const fromList = students.find((s) => s.studentId === studentId) ?? null;
  // Whole object, never a field-by-field merge: mixing the two sources would put a
  // stale ARN next to fresh spend and there would be no way to tell which figure
  // came from when.
  const student = detail.data ?? fromList;

  useSubCrumb(
    student
      ? { text: studentName(student), href: studentDetailHref(studentId) }
      : null,
  );

  const { onAction, busyFor, actions, dialogs } = useStudentDialogs(
    student ? [student] : [],
    // The page exists to show this student. Once the teardown is accepted there is
    // nothing left here to look at, so it hands back to the list.
    { onTerminated: () => router.push("/students") },
  );

  // nosemgrep: jsx-not-internationalized
  const backToList = (
    <Button onClick={() => router.push("/students")}>Back to students</Button>
  );

  // A 404 is a different situation from a broken API: the id in the URL is wrong,
  // or the student has been torn down since the link was made. Handled before the
  // generic DataAlert, which would otherwise offer a Retry that cannot succeed.
  const notFound =
    detail.error instanceof ApiError &&
    detail.error.status === 404 &&
    fromList === null;

  if (notFound) {
    return (
      <PageLayout title="Student not found" description={null}>
        {/* nosemgrep: jsx-not-internationalized */}
        <Alert type="error" header="No such student" action={backToList}>
          The API has no student with the ID <b>{studentId}</b>. It may have been
          terminated, or the link may be out of date.
        </Alert>
      </PageLayout>
    );
  }

  if (student === null) {
    return (
      <PageLayout title="Student" description={null}>
        <SpaceBetween size="l">
          <DataAlert
            error={detail.error}
            isUnauthorized={detail.isUnauthorized}
            isForbidden={detail.isForbidden}
            isNetworkError={detail.isNetworkError}
            isRefreshing={detail.isRefreshing}
            onRefresh={detail.refresh}
          />
          {detail.error === null && (
            <Box textAlign="center" padding={{ vertical: "xxl" }}>
              <Spinner size="large" />
              {/* nosemgrep: jsx-not-internationalized */}
              <Box variant="p" color="text-body-secondary">
                Loading {studentId}
              </Box>
            </Box>
          )}
        </SpaceBetween>
      </PageLayout>
    );
  }

  const region = studentRegion(student, API_BASE_URL);
  const studioUrl = studioDomainConsoleUrl(region, student.domainId);
  const stackUrl = stackConsoleUrl(region, student.stackName);
  const pct = student.percentUsed == null ? null : percentUsed(student);

  return (
    <PageLayout
      title={studentName(student)}
      // The id under the name, for the same reason the table shows both: the name
      // is who this is, the id is what every AWS resource for them is named after.
      description={
        studentName(student) === student.studentId
          ? null
          : `Student ID ${student.studentId}`
      }
      actions={
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <RefreshControl
            fetchedAt={detail.fetchedAt}
            isRefreshing={detail.isRefreshing}
            onRefresh={detail.refresh}
          />
          <StudentRowActions
            student={student}
            busy={busyFor(student.studentId)}
            onAction={onAction}
            variant="header"
          />
        </SpaceBetween>
      }
    >
      <SpaceBetween size="l">
        <DataAlert
          error={detail.error}
          isUnauthorized={detail.isUnauthorized}
          isForbidden={detail.isForbidden}
          isNetworkError={detail.isNetworkError}
          isRefreshing={detail.isRefreshing}
          onRefresh={detail.refresh}
        />

        <Container
          // nosemgrep: jsx-not-internationalized
          header={<Header variant="h2">General information</Header>}
        >
          <KeyValuePairs
            columns={4}
            items={[
              {
                label: "Status",
                value: (
                  <StatusIndicator type={statusIndicatorType(student.status)}>
                    {formatStatus(student.status)}
                  </StatusIndicator>
                ),
              },
              { label: "Student ID", value: student.studentId },
              { label: "Email", value: orDash(student.studentEmail) },
              { label: "Instance type", value: orDash(student.instanceType) },
              {
                label: "Studio domain",
                value:
                  // Linked only when the region is known. See lib/aws.ts: a link
                  // into the wrong region shows an empty page and reads as
                  // "this resource is gone".
                  studioUrl && student.domainId ? (
                    <Link href={studioUrl} external target="_blank">
                      {student.domainId}
                    </Link>
                  ) : (
                    orDash(student.domainId)
                  ),
              },
              {
                label: "CloudFormation stack",
                value:
                  stackUrl && student.stackName ? (
                    <Link href={stackUrl} external target="_blank">
                      {student.stackName}
                    </Link>
                  ) : (
                    orDash(student.stackName)
                  ),
              },
              {
                label: "Execution role",
                value: (
                  <ArnValue
                    label="Execution role ARN"
                    value={student.executionRoleArn}
                  />
                ),
              },
              {
                label: "Deny policy",
                value: (
                  <ArnValue
                    label="Deny policy ARN"
                    value={student.denyPolicyArn}
                  />
                ),
              },
            ]}
          />
        </Container>

        {/* nosemgrep: jsx-not-internationalized */}
        <Container header={<Header variant="h2">Budget and spend</Header>}>
          <KeyValuePairs
            columns={4}
            items={[
              {
                label: "Current spend",
                value: formatUsd(student.currentSpendUsd),
              },
              { label: "Budget", value: formatUsd(student.perStudentBudgetUsd) },
              {
                label: "Used",
                value:
                  pct === null ? (
                    // Not a 0% bar: a student with no percentage reported has not
                    // spent nothing, it is not known what they have spent.
                    "—"
                  ) : pct > 100 ? (
                    // ProgressBar clamps to 100 AND prints the clamped number, so
                    // 120% would render as a full bar labelled "100%" - the same
                    // as landing exactly on the limit. The figure instead.
                    <StatusIndicator type="error">
                      {formatPercent(pct)}
                    </StatusIndicator>
                  ) : (
                    <ProgressBar variant="key-value" value={pct} />
                  ),
              },
              {
                label: "Notification email",
                value: orDash(student.notificationEmail),
              },
            ]}
          />
        </Container>

        <SpendHistoryTable spendHistory={student.spendHistory} />

        <Container
          header={
            // nosemgrep: jsx-not-internationalized
            <Header
              variant="h2"
              description="Sub-statuses reported by the underlying AWS resources. Useful while a student is provisioning, or when the overall status is not what you expect."
            >
              Enforcement and provisioning
            </Header>
          }
        >
          <KeyValuePairs
            columns={3}
            items={[
              { label: "Compute", value: orDash(student.computeStatus) },
              {
                label: "Provisioning",
                value: orDash(student.provisioningStatus),
              },
              {
                // "Login", not "IAM Identity Center": under ACCOUNT mode the
                // roster is the Cognito user pool and there is no Identity Center
                // instance at all, so the label has to name the thing that is true
                // in both modes. The value is the directory's own account flag and
                // says nothing about whether they ever signed in.
                label: "Login",
                value: orDash(student.directoryStatus),
              },
              {
                label: "Stop function",
                value: (
                  <ArnValue
                    label="Stop function ARN"
                    value={student.stopFunctionArn}
                  />
                ),
              },
              {
                // Replaces a "Budget alerts topic" row that was always empty -
                // the handler writes no SNS ARN onto a student record, and has
                // not since enforcement moved off AWS Budgets. This is the field
                // that matters in its place: it says what will lift the hold.
                label: "Hold type",
                value: formatHoldKind(student.onHoldKind),
              },
              {
                // The spend figures on this page are a copy of the ledger,
                // rewritten once per metering sweep. This is when that last
                // happened, which is the only way to tell a student who has
                // stopped spending from a sweep that has stopped running.
                label: "Metered at",
                value: formatTimestamp(student.usageUpdatedAt),
              },
            ]}
          />
        </Container>

        <StudentSettingsForm
          student={student}
          submitting={actions.busyId === student.studentId}
          onSave={(amountUsd, notificationEmail) =>
            void actions.saveSettings(student, amountUsd, notificationEmail)
          }
        />
      </SpaceBetween>
      {dialogs}
    </PageLayout>
  );
}
