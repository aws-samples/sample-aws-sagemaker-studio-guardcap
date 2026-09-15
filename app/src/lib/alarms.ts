// Pure derivations over budget alarm events. Mirrors lib/students.ts: no React
// and no Cloudscape runtime import, so it is unit-testable in plain Node.

import type { StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import type { AlarmEvent, Student } from "./api/types";
import { AT_RISK_PERCENT, isHeld, percentUsed, toNumber } from "./students";

/**
 * The `studentId` the class-wide pool check files its events under.
 *
 * A sentinel, not an id: the pool backstop sums every student's spend against the
 * class cap and has no student to attribute the result to, so it records
 * "CLASS_POOL". Anything that treats studentId as a real student has to know.
 */
export const CLASS_POOL_ID = "CLASS_POOL";

/**
 * The alarms that revoked access, as opposed to the ones that only warned.
 *
 * Two of them, not one. The handler's other enforcing path is
 * DIRECTORY_IDENTITY_DELETED - a login that vanished from the directory, which
 * attaches the same deny policy and stops the same notebook, and differs only in
 * that no spending caused it. Counting solely the budget breach under-reported
 * every enforcement action taken for a reason other than money.
 */
export const ENFORCING_ALARMS: ReadonlySet<string> = new Set([
  "BUDGET_THRESHOLD_BREACHED",
  "DIRECTORY_IDENTITY_DELETED",
]);

/**
 * Every alarmType the handler writes. All four, verified against its own
 * AlarmEventStore.record call sites rather than inferred from what has been seen
 * in this deployment so far - the two class-pool and directory events are rare,
 * which is exactly why they were missing here and would have rendered as raw
 * SCREAMING_SNAKE in the one table an admin reads during an incident.
 */
const ALARM_TYPE_LABEL: Record<string, string> = {
  BUDGET_THRESHOLD_BREACHED: "Budget cap reached",
  THRESHOLD_80_APPROACHING: "80% of budget",
  DIRECTORY_IDENTITY_DELETED: "Login deleted outside the console",
  POOL_THRESHOLD_APPROACHING: "Class pool approaching its cap",
};

/**
 * Falls back to the raw value rather than to a placeholder: an alarm type the
 * backend adds later is still more useful spelled out than hidden behind a dash.
 */
export function formatAlarmType(alarmType: string | null | undefined): string {
  if (!alarmType) return "—";
  return ALARM_TYPE_LABEL[alarmType] ?? alarmType;
}

/**
 * What the platform actually did in response to the alarm.
 *
 * Passed through verbatim, because the handler already writes a sentence:
 * "Deny policy attached, Studio apps stopped", "Access revoked, Studio apps
 * stopped", "Notification sent". There was a lookup table here mapping
 * STOP_APPS_AND_DENY and NOTIFY_ONLY, which are enum values the handler has never
 * written - so every row fell through the table to the raw value anyway, and the
 * table's only effect was to suggest the backend spoke in enums here.
 */
export function formatEnforcementAction(
  action: string | null | undefined,
): string {
  if (!action) return "—";
  return action;
}

/**
 * The four statuses the handler records, and what each means for the student.
 *
 * BREACHED belongs to the class-pool alarm, which is notify-only: the pool is
 * over its cap and nothing was locked, so it is a warning colour rather than an
 * error one however alarming the word sounds. SUSPENDED is the directory path,
 * where access really is gone. There was a RESOLVED entry here that nothing ever
 * writes - alarm events are an append-only trail, so an event is never revised
 * after the fact.
 */
const EVENT_STATUS: Record<
  string,
  { type: StatusIndicatorProps.Type; label: string }
> = {
  ON_HOLD: { type: "error", label: "On hold" },
  SUSPENDED: { type: "error", label: "Suspended" },
  APPROACHING_LIMIT: { type: "warning", label: "Approaching limit" },
  BREACHED: { type: "warning", label: "Over cap, not enforced" },
};

export function alarmStatus(status: string | null | undefined): {
  type: StatusIndicatorProps.Type;
  label: string;
} {
  if (!status) return { type: "info", label: "Unknown" };
  return EVENT_STATUS[status] ?? { type: "info", label: status };
}

/**
 * Alarm timestamps rendered in the reader's own locale and timezone.
 *
 * Unlike the USD figures, which are pinned to en-US because they are the same
 * money for everyone, a timestamp is only useful measured against the clock on
 * the wall next to the person reading it. Returns the raw string unchanged if it
 * will not parse, so a malformed value from the backend is visible rather than
 * silently becoming "Invalid Date".
 */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

/** Newest first: the most recent breach is the one being acted on. */
export function sortEventsByTime(events: AlarmEvent[]): AlarmEvent[] {
  const time = (e: AlarmEvent) => {
    const t = e.alarmTimestamp ? Date.parse(e.alarmTimestamp) : NaN;
    // Unparseable and missing timestamps sort last rather than jumping to the
    // top, which is what NaN would otherwise do to the comparison.
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...events].sort((a, b) => time(b) - time(a));
}

export function matchesEventSearch(event: AlarmEvent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    event.studentId,
    event.alarmType,
    formatAlarmType(event.alarmType),
    event.enforcementAction,
    // Both forms of each humanized field, so the search matches whichever one
    // the admin has in front of them - the label on screen or the enum they
    // copied out of a log.
    formatEnforcementAction(event.enforcementAction),
    event.status,
  ].some((field) => field?.toLowerCase().includes(needle));
}

export interface BudgetSummary {
  budgetUsd: number;
  spendUsd: number;
  /** Spend as a share of allocated budget, or null when no budget is set. */
  utilizationPercent: number | null;
  /** Provisioned and billable, i.e. active or held - not still building. */
  activeStudents: number;
  onHold: number;
  overBudget: number;
  nearingThreshold: number;
  /** Alarm events that applied a hold, as opposed to warning about one. */
  enforcementActions: number;
}

/**
 * The platform-wide budget picture, from the two endpoints together.
 *
 * Spend and budget are summed from the student list rather than read from an
 * aggregate the API does not expose, so these totals are the same ones the
 * dashboard shows - they cannot drift apart.
 */
export function summarizeBudget(
  students: Student[],
  events: AlarmEvent[],
): BudgetSummary {
  const budgetUsd = students.reduce(
    (sum, s) => sum + toNumber(s.perStudentBudgetUsd),
    0,
  );
  const spendUsd = students.reduce(
    (sum, s) => sum + toNumber(s.currentSpendUsd),
    0,
  );

  return {
    budgetUsd,
    spendUsd,
    // null rather than 0, for the same reason as the fleet summary: "0% of no
    // budget" reads as healthy when it is really unknown.
    utilizationPercent: budgetUsd > 0 ? (spendUsd / budgetUsd) * 100 : null,
    // PROVISIONING and DELETING are excluded: they are not yet, or no longer,
    // accruing spend against a budget.
    activeStudents: students.filter(
      (s) => s.status === "ACTIVE" || isHeld(s),
    ).length,
    onHold: students.filter(isHeld).length,
    // Counts anyone at or over their limit whatever their status, because a held
    // student is still over budget - that is why they were held.
    overBudget: students.filter((s) => percentUsed(s) >= 100).length,
    nearingThreshold: students.filter(
      (s) => s.status === "ACTIVE" && percentUsed(s) >= AT_RISK_PERCENT,
    ).length,
    enforcementActions: events.filter(
      (e) => e.alarmType != null && ENFORCING_ALARMS.has(e.alarmType),
    ).length,
  };
}
