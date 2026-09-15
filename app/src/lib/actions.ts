// Which actions a student is eligible for, and why not when they are not.
//
// Pure and separate from the components for the same reason as lib/students.ts:
// this is the rule set that decides whether an admin can stop, restart, re-fund
// or tear down a real environment, and it is worth being able to test it without
// a browser.

import type { Student } from "./api/types";

export type StudentActionId =
  | "suspend"
  | "resume"
  | "edit-budget"
  | "terminate";

export interface StudentAction {
  id: StudentActionId;
  text: string;
  /**
   * Present only when the action is unavailable. Shown to the admin rather than
   * just greying the item out: "why can't I do this" is otherwise a support
   * question, and the answer is always knowable from the status.
   */
  disabledReason?: string;
}

/** Statuses where AWS is mid-operation and a second one would race it. */
function isTransitioning(student: Student): boolean {
  return student.status === "PROVISIONING" || student.status === "DELETING";
}

/**
 * Exactly one of suspend/resume is offered, never both.
 *
 * Showing both would make the admin work out the current state to know which one
 * applies - and "Resume" on a running student is the kind of item that gets
 * clicked by accident. Which one appears is derived from the status instead.
 */
function holdAction(student: Student): StudentAction {
  switch (student.status) {
    case "ACTIVE":
      return { id: "suspend", text: "Suspend" };
    case "ON_HOLD":
    case "SUSPENDED":
      return { id: "resume", text: "Resume" };
    case "PROVISIONING":
      return {
        id: "suspend",
        text: "Suspend",
        disabledReason:
          "This environment is still being built. There is nothing running to suspend yet.",
      };
    case "DELETING":
      return {
        id: "suspend",
        text: "Suspend",
        disabledReason: "This environment is being torn down.",
      };
    case "PROVISION_FAILED":
      return {
        id: "resume",
        text: "Resume",
        disabledReason:
          "This environment was never built successfully, so there is nothing to resume. Terminate it and provision again.",
      };
  }
}

export function availableActions(student: Student): StudentAction[] {
  return [
    holdAction(student),
    {
      id: "edit-budget",
      text: "Edit budget",
      // Deliberately allowed while ON_HOLD: raising the budget above current
      // spend is how an admin releases a student the budget alarm has held, so
      // disabling it there would remove the main reason for using it.
      disabledReason: isTransitioning(student)
        ? "The budget resources for this student are not in place yet."
        : student.status === "PROVISION_FAILED"
          ? "This environment was never built, so it has no budget to change."
          : undefined,
    },
    {
      id: "terminate",
      text: "Terminate",
      // Available for PROVISION_FAILED and PROVISIONING on purpose: tearing
      // down is the only way to clear a half-built or broken stack, and an admin
      // who cannot do that has to go to the CloudFormation console instead.
      disabledReason:
        student.status === "DELETING"
          ? "This environment is already being torn down."
          : undefined,
    },
  ];
}

/** True when at least one action can actually be taken on this student. */
export function hasAnyAction(student: Student): boolean {
  return availableActions(student).some((a) => a.disabledReason === undefined);
}

export interface BudgetValidation {
  /** Null when the value is usable. */
  error: string | null;
  /**
   * A caveat worth stating that is not a reason to block: set below what the
   * student has already spent and the hold applies again immediately.
   */
  warning: string | null;
  /** Parsed value, or null when it is not a usable number. */
  value: number | null;
}

/**
 * Validates a budget before it is sent, including the case the old console let
 * through: a new budget under the student's current spend. That is accepted by
 * the API and then immediately re-triggers the alarm, so the student is held
 * again seconds after the admin thought they had released them.
 */
export function validateBudget(
  input: string,
  currentSpendUsd: number,
): BudgetValidation {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { error: "Enter a budget.", warning: null, value: null };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { error: "Enter a number.", warning: null, value: null };
  }
  if (value <= 0) {
    return {
      error: "Enter an amount greater than 0.",
      warning: null,
      value: null,
    };
  }
  return {
    error: null,
    warning:
      value < currentSpendUsd
        ? "This is below the student's current spend, so the budget hold will be applied again straight away."
        : null,
    value,
  };
}
