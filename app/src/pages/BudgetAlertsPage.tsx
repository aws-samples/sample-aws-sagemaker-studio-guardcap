import SpaceBetween from "@cloudscape-design/components/space-between";
import AlarmEventsTable from "@/components/budget/AlarmEventsTable";
import BudgetOverview from "@/components/budget/BudgetOverview";
import DataAlert from "@/components/data/DataAlert";
import RefreshControl from "@/components/data/RefreshControl";
import PageLayout from "@/components/shell/PageLayout";
import { useAlarmEvents } from "@/lib/data/useAlarmEvents";
import { useFleet } from "@/lib/data/useFleet";

/**
 * This is the one page that needs two endpoints: the totals come from the
 * student list (the same shared key the dashboard uses) and the event log from
 * /alarm-events.
 */
export default function BudgetAlertsPage() {
  const fleet = useFleet();
  const alarms = useAlarmEvents();

  // Either failure is reported, the session-ended case first: if the token has
  // expired both calls are failing for that one reason, and offering "Retry"
  // instead of "Sign in again" would send the admin round a loop that cannot
  // succeed.
  //
  // A 403 comes next for the same reason one step further on: if this account is
  // not an admin then both calls are refusing for that reason, and it is the only
  // failure worth reporting - "Retry" would never succeed for either.
  const failing = fleet.isUnauthorized
    ? fleet
    : alarms.isUnauthorized
      ? alarms
      : fleet.isForbidden
        ? fleet
        : alarms.isForbidden
          ? alarms
          : (fleet.error ? fleet : alarms);

  // The older of the two timestamps, because that is the true age of what is on
  // screen. Reporting the newer one would claim the page is fresher than its
  // stalest half. Null until both have loaded, so "Updated" never appears over a
  // half-empty page.
  const fetchedAt =
    fleet.fetchedAt !== null && alarms.fetchedAt !== null
      ? Math.min(fleet.fetchedAt, alarms.fetchedAt)
      : null;

  const isRefreshing = fleet.isRefreshing || alarms.isRefreshing;
  const refresh = () => {
    fleet.refresh();
    alarms.refresh();
  };

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
          error={failing.error}
          isUnauthorized={failing.isUnauthorized}
          isForbidden={failing.isForbidden}
          isNetworkError={failing.isNetworkError}
          isRefreshing={isRefreshing}
          onRefresh={refresh}
        />
        <BudgetOverview
          students={fleet.students}
          events={alarms.events}
          isLoading={fleet.isLoading}
        />
        <AlarmEventsTable
          events={alarms.events}
          isLoading={alarms.isLoading}
        />
      </SpaceBetween>
    </PageLayout>
  );
}
