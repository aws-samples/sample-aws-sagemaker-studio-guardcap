"use client";

import { useCallback, useState } from "react";
import { useSWRConfig } from "swr";
import { useNotifications } from "@/components/notifications/NotificationProvider";
import { ApiError } from "@/lib/api/client";
import {
  deleteStudent,
  resumeStudent,
  suspendStudent,
  updateBudget,
} from "@/lib/api/students";
import type { Student } from "@/lib/api/types";
import { formatUsd, studentName } from "@/lib/students";
import { ALARM_EVENTS_KEY } from "./useAlarmEvents";
import { FLEET_KEY } from "./useFleet";
import { studentKey } from "./useStudent";

/**
 * Runs the four write actions, reports the outcome, and re-reads the fleet.
 *
 * Every one of these changes real AWS resources for a real student, so nothing
 * here is optimistic: the row shows what the API last said, and the only way the
 * status changes on screen is a fresh read after the write returned. An optimistic
 * "Suspended" that the backend then failed to apply would be a lie about whether
 * a student can still spend money.
 */

/** The student id currently being acted on, or null. */
export type BusyId = string | null;

/**
 * Each action resolves true when the write succeeded. Callers use it to decide
 * whether to close their dialog: a failed action leaves the form open next to the
 * flash explaining why, rather than dismissing it over an unchanged table.
 */
export interface StudentActionsResult {
  busyId: BusyId;
  suspend: (student: Student) => Promise<boolean>;
  resume: (student: Student) => Promise<boolean>;
  terminate: (student: Student) => Promise<boolean>;
  setBudget: (student: Student, amountUsd: number) => Promise<boolean>;
  /** Budget and notification email together, from the detail page's form. */
  saveSettings: (
    student: Student,
    amountUsd: number,
    notificationEmail: string,
  ) => Promise<boolean>;
}

export function useStudentActions(): StudentActionsResult {
  const { mutate } = useSWRConfig();
  const { notify } = useNotifications();
  const [busyId, setBusyId] = useState<BusyId>(null);

  /**
   * One place for the parts every action shares: the busy lock, the re-read, and
   * turning a failure into something an admin can act on.
   */
  const run = useCallback(
    async (
      student: Student,
      call: () => Promise<void>,
      successHeader: string,
      failureHeader: string,
    ): Promise<boolean> => {
      setBusyId(student.studentId);
      try {
        await call();
        // Awaited, so the row is only re-enabled once it is showing the new
        // state. Returning earlier would leave the old status under a live
        // dropdown, inviting the admin to repeat an action that had worked.
        await mutate(FLEET_KEY);
        // The detail page reads its own per-student key, so it has to be
        // invalidated too or an action taken from that page would report success
        // above a panel still showing the old status.
        await mutate(studentKey(student.studentId));
        // The alarm-events table on the budget page is derived from the same
        // actions, so a suspend or a budget change can add a row to it.
        void mutate(ALARM_EVENTS_KEY);
        notify({ type: "success", header: successHeader });
        return true;
      } catch (error) {
        // A 401 here is the session expiring mid-action, not a rejected action.
        // Said plainly, because "Could not suspend" would send the admin looking
        // for a problem with the student.
        if (error instanceof ApiError && error.status === 401) {
          notify({
            type: "error",
            header: "Your session has ended",
            content: "Sign in again, then retry. Nothing was changed.",
          });
          return false;
        }
        notify({
          type: "error",
          header: failureHeader,
          // The API's own message, not a generic apology: these failures are
          // usually specific and actionable (a stack still updating, a budget
          // that does not exist yet) and only the backend knows which.
          content:
            error instanceof ApiError
              ? error.detail || `The API returned ${error.status}.`
              : "The request did not reach the API. Check your connection and try again.",
        });
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [mutate, notify],
  );

  const suspend = useCallback(
    (student: Student) =>
      run(
        student,
        () => suspendStudent(student.studentId),
        `Suspended ${studentName(student)}`,
        `Could not suspend ${studentName(student)}`,
      ),
    [run],
  );

  const resume = useCallback(
    (student: Student) =>
      run(
        student,
        () => resumeStudent(student.studentId),
        `Resumed ${studentName(student)}`,
        `Could not resume ${studentName(student)}`,
      ),
    [run],
  );

  const terminate = useCallback(
    (student: Student) =>
      run(
        student,
        () => deleteStudent(student.studentId),
        // "Termination started", not "Terminated": the DELETE returns as soon as
        // the teardown is accepted, and the CloudFormation stack takes minutes.
        // The row will sit at DELETING until it is genuinely gone.
        `Termination started for ${studentName(student)}`,
        `Could not terminate ${studentName(student)}`,
      ),
    [run],
  );

  const setBudget = useCallback(
    (student: Student, amountUsd: number) =>
      run(
        student,
        () => updateBudget(student.studentId, amountUsd),
        `Budget for ${studentName(student)} set to ${formatUsd(amountUsd)}`,
        `Could not update the budget for ${studentName(student)}`,
      ),
    [run],
  );

  const saveSettings = useCallback(
    (student: Student, amountUsd: number, notificationEmail: string) =>
      run(
        student,
        () => updateBudget(student.studentId, amountUsd, notificationEmail),
        `Saved changes for ${studentName(student)}`,
        `Could not save changes for ${studentName(student)}`,
      ),
    [run],
  );

  return { busyId, suspend, resume, terminate, setBudget, saveSettings };
}
