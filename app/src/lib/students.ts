// Pure derivations over the student list. No React and no Cloudscape runtime
// import, so this is unit-testable and the same numbers back every view.

import type { StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import type { ApiNumber, Student, StudentStatus } from "./api/types";

/** A student at or above this share of their budget is treated as at risk. */
export const AT_RISK_PERCENT = 80;

/**
 * Coerces the API's loosely-typed numerics. `Number("")` is 0 and `Number(null)`
 * is 0, but `Number("abc")` and `Number(undefined)` are NaN, which would render
 * as "$NaN" and silently poison any total it was added to - so NaN is folded to
 * the fallback rather than passed on.
 */
export function toNumber(value: ApiNumber | undefined, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Trusts the server's `percentUsed` rather than recomputing spend/budget, so the
 * console and the alarm that enforces the hold agree on the number. A locally
 * derived percentage could differ by a rounding step and show a student as under
 * budget while the backend has already suspended them.
 */
export function percentUsed(student: Student): number {
  return toNumber(student.percentUsed);
}

/** Statuses that mean the environment is stopped by enforcement, not by choice. */
export function isHeld(student: Student): boolean {
  return student.status === "ON_HOLD" || student.status === "SUSPENDED";
}

/** Active and near the limit, or already stopped by enforcement. */
export function isAtRisk(student: Student): boolean {
  if (isHeld(student)) return true;
  return student.status === "ACTIVE" && percentUsed(student) >= AT_RISK_PERCENT;
}

/** At-risk students, worst first, so the top row is the one to act on. */
export function atRiskStudents(students: Student[]): Student[] {
  return students
    .filter(isAtRisk)
    .sort((a, b) => percentUsed(b) - percentUsed(a));
}

/** Ids for the status segments above the students table. */
export type StudentFilterId =
  | "all"
  | "active"
  | "near-budget"
  | "on-hold"
  | "provisioning";

export const STUDENT_FILTERS: ReadonlyArray<{
  id: StudentFilterId;
  text: string;
}> = [
  { id: "all", text: "All" },
  { id: "active", text: "Active" },
  { id: "near-budget", text: "Near budget" },
  { id: "on-hold", text: "On hold" },
  { id: "provisioning", text: "Provisioning" },
];

/**
 * The segments partition the fleet rather than overlapping: "Active" excludes
 * anyone at or above the threshold, because a student who is 90% spent is
 * actionable and would otherwise hide among the healthy ones. Every student
 * therefore appears under exactly one segment, and the counts add up to the
 * total - which they would not if "Active" meant "status === ACTIVE".
 */
export function matchesFilter(
  student: Student,
  filterId: StudentFilterId,
): boolean {
  switch (filterId) {
    case "active":
      return (
        student.status === "ACTIVE" && percentUsed(student) < AT_RISK_PERCENT
      );
    case "near-budget":
      return (
        student.status === "ACTIVE" && percentUsed(student) >= AT_RISK_PERCENT
      );
    case "on-hold":
      return isHeld(student);
    case "provisioning":
      return (
        student.status === "PROVISIONING" ||
        student.status === "DELETING" ||
        // The old app omitted this, so a student whose stack failed to build
        // appeared under no segment at all and was invisible unless you were on
        // "All" - the exact case an admin most needs to find.
        student.status === "PROVISION_FAILED"
      );
    case "all":
      return true;
  }
}

/**
 * Free-text match across the fields an admin would actually type: the id, either
 * name, the email, and the instance type. Names are included because the table
 * shows them, and searching for what is on screen has to work.
 */
export function matchesSearch(student: Student, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    student.studentId,
    student.givenName,
    student.familyName,
    studentName(student),
    student.studentEmail,
    student.instanceType,
  ].some((field) => field?.toLowerCase().includes(needle));
}

/** Segment, then text - so the count in the header reflects both. */
export function filterStudents(
  students: Student[],
  filterId: StudentFilterId,
  query: string,
): Student[] {
  return students.filter(
    (s) => matchesFilter(s, filterId) && matchesSearch(s, query),
  );
}

export interface FleetSummary {
  total: number;
  running: number;
  onHold: number;
  nearBudget: number;
  spendUsd: number;
  budgetUsd: number;
  /** Fleet spend as a share of fleet budget, or null when no budget is set. */
  spendPercent: number | null;
}

export function summarizeFleet(students: Student[]): FleetSummary {
  const spendUsd = students.reduce((sum, s) => sum + toNumber(s.currentSpendUsd), 0);
  const budgetUsd = students.reduce((sum, s) => sum + toNumber(s.perStudentBudgetUsd), 0);

  return {
    total: students.length,
    running: students.filter((s) => s.status === "ACTIVE").length,
    onHold: students.filter(isHeld).length,
    // Deliberately excludes held students: they are counted under "On hold", and
    // double-counting them would make the two figures overlap without saying so.
    nearBudget: students.filter(
      (s) => s.status === "ACTIVE" && percentUsed(s) >= AT_RISK_PERCENT,
    ).length,
    spendUsd,
    budgetUsd,
    // null rather than 0: "0% of no budget" reads as healthy when it is really
    // unknown, and the view renders the two cases differently.
    spendPercent: budgetUsd > 0 ? (spendUsd / budgetUsd) * 100 : null,
  };
}

const STATUS_INDICATOR: Record<StudentStatus, StatusIndicatorProps.Type> = {
  ACTIVE: "success",
  ON_HOLD: "warning",
  SUSPENDED: "stopped",
  PROVISIONING: "loading",
  DELETING: "loading",
  PROVISION_FAILED: "error",
};

/**
 * Falls back to "info" for a status the backend adds later, so an unrecognized
 * value still renders as a neutral badge instead of crashing the table.
 */
export function statusIndicatorType(
  status: StudentStatus,
): StatusIndicatorProps.Type {
  return STATUS_INDICATOR[status] ?? "info";
}

/** ACTIVE -> "Active", PROVISION_FAILED -> "Provision failed". */
export function formatStatus(status: string): string {
  const words = status.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * `onHoldKind` in words, including what will release the hold.
 *
 * The consequence is the whole reason the field exists, so it is stated rather
 * than left for the reader to remember: a BUDGET hold lifts itself when the month
 * rolls over, and the other two never do. An admin looking at a held student is
 * deciding whether to intervene, and "waits for the 1st" versus "waits for you"
 * is the answer they need.
 */
export function formatHoldKind(kind: string | null | undefined): string {
  switch (kind) {
    case "BUDGET":
      return "Budget cap - lifts at month rollover";
    case "MANUAL":
      return "Manually suspended - stays until resumed";
    case "DIRECTORY":
      return "Login deleted - stays until the login is restored";
    // "" is how the handler clears the field, and absent is a student who has
    // never been held. Neither is a hold, so neither gets a label.
    default:
      return "—";
  }
}

// Locale is pinned rather than left to the browser: the figures are USD from the
// platform's own rate card regardless of who is looking, and an unpinned locale
// would also risk a prerender/hydration mismatch if this ever renders outside the
// auth gate.
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(value: ApiNumber | undefined): string {
  return USD.format(toNumber(value));
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

/** Display name, falling back to the id, which is the only guaranteed field. */
export function studentName(student: Student): string {
  const full = [student.givenName, student.familyName].filter(Boolean).join(" ");
  return full || student.studentId;
}
