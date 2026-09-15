import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useRouter, useSearchParams } from "@/lib/router";
import DataAlert from "@/components/data/DataAlert";
import RefreshControl from "@/components/data/RefreshControl";
import PageLayout from "@/components/shell/PageLayout";
import StudentDetail from "@/components/students/StudentDetail";
import StudentsTable from "@/components/students/StudentsTable";
import { useFleet } from "@/lib/data/useFleet";
import { STUDENT_PARAM } from "@/lib/nav";

/**
 * One route, two views: the fleet list, and one student's detail when
 * `?student=<id>` is present.
 *
 * Detail is a query parameter rather than a `/students/:id` route because the
 * breadcrumb, heading and nav highlight all come from the route registry in
 * lib/nav.ts, which is keyed by literal path - and because it is one fewer place
 * for a student id to be parsed.
 *
 * The Suspense boundary that used to wrap this is gone: it existed only because
 * Next's build-time prerender of a route calling useSearchParams demanded one.
 * The query string is available synchronously in the browser.
 */
export default function StudentsPage() {
  const studentId = useSearchParams().get(STUDENT_PARAM);
  // Keyed on the id so switching between two students remounts rather than
  // carrying the first one's form state - the settings form seeds from whichever
  // student it was mounted with.
  return studentId ? (
    <StudentDetail key={studentId} studentId={studentId} />
  ) : (
    <StudentsList />
  );
}

// Reads the same SWR key as the dashboard, so arriving here from the dashboard
// shows the numbers already on screen instead of a fresh spinner and a fresh
// request.
function StudentsList() {
  const router = useRouter();
  const {
    students,
    fetchedAt,
    error,
    isLoading,
    isRefreshing,
    isUnauthorized,
    isForbidden,
    isNetworkError,
    refresh,
  } = useFleet();

  return (
    <PageLayout
      actions={
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <RefreshControl
            fetchedAt={fetchedAt}
            isRefreshing={isRefreshing}
            onRefresh={refresh}
          />
          {/* nosemgrep: jsx-not-internationalized */}
          <Button
            variant="primary"
            onClick={() => router.push("/students/new")}
            data-testid="add-student"
          >
            Add student
          </Button>
        </SpaceBetween>
      }
    >
      <SpaceBetween size="l">
        <DataAlert
          error={error}
          isUnauthorized={isUnauthorized}
          isForbidden={isForbidden}
          isNetworkError={isNetworkError}
          isRefreshing={isRefreshing}
          onRefresh={refresh}
        />
        <StudentsTable students={students} isLoading={isLoading} />
      </SpaceBetween>
    </PageLayout>
  );
}
