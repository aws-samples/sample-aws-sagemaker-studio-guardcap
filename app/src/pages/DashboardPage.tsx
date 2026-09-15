import SpaceBetween from "@cloudscape-design/components/space-between";
import DataAlert from "@/components/data/DataAlert";
import RefreshControl from "@/components/data/RefreshControl";
import FleetOverview from "@/components/dashboard/FleetOverview";
import StudentsAtRisk from "@/components/dashboard/StudentsAtRisk";
import PageLayout from "@/components/shell/PageLayout";
import { useFleet } from "@/lib/data/useFleet";

// No "Add student" button yet: PageLayout has the `actions` slot for it, but a
// primary button that does nothing is worse than an absent one. It arrives with
// the mutation step.
export default function DashboardPage() {
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
        <RefreshControl
          fetchedAt={fetchedAt}
          isRefreshing={isRefreshing}
          onRefresh={refresh}
        />
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
        <FleetOverview students={students} isLoading={isLoading} />
        <StudentsAtRisk students={students} isLoading={isLoading} />
      </SpaceBetween>
    </PageLayout>
  );
}
