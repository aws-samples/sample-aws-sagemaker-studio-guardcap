// The fleet endpoints. Every one of these talks to the live admin API, and the
// four writes at the bottom change real AWS resources for a real student.

import { request } from "./client";
import type {
  AlarmEvent,
  AlarmEventsResponse,
  NewStudentInput,
  PlatformInfo,
  Student,
  StudentsResponse,
} from "./types";

/**
 * The response is an object wrapping the array, so the unwrapping happens here
 * rather than in the components. `?? []` because a wrapper with the key missing
 * would otherwise put `undefined` into the SWR cache and make every consumer
 * defend against it.
 */
export async function listStudents(): Promise<Student[]> {
  const data = await request<StudentsResponse>("/students");
  return data?.students ?? [];
}

export async function getStudent(studentId: string): Promise<Student> {
  return request<Student>(`/students/${encodeURIComponent(studentId)}`);
}

/** Note the different wrapper key: `events`, not `alarmEvents`. */
export async function listAlarmEvents(): Promise<AlarmEvent[]> {
  const data = await request<AlarmEventsResponse>("/alarm-events");
  return data?.events ?? [];
}

export async function getPlatformInfo(): Promise<PlatformInfo> {
  return request<PlatformInfo>("/platform-info");
}

// ---------------------------------------------------------------------------
// Writes.
//
// All four return no useful body - the caller re-reads /students afterwards
// rather than trusting a response shape that was never specified. They are typed
// Promise<void> so no caller can start depending on one.
// ---------------------------------------------------------------------------

const studentPath = (studentId: string) =>
  `/students/${encodeURIComponent(studentId)}`;

/** Stops the student's SageMaker Studio apps and denies new ones. */
export async function suspendStudent(studentId: string): Promise<void> {
  await request<null>(`${studentPath(studentId)}/suspend`, { method: "POST" });
}

/** Lifts a suspension or a budget hold, letting the student start apps again. */
export async function resumeStudent(studentId: string): Promise<void> {
  await request<null>(`${studentPath(studentId)}/resume`, { method: "POST" });
}

/**
 * Tears down the student's entire environment: execution role, notebook profile,
 * budget and enforcement resources. Irreversible - see the confirmation the UI
 * puts in front of it.
 */
export async function deleteStudent(studentId: string): Promise<void> {
  await request<null>(studentPath(studentId), { method: "DELETE" });
}

/**
 * Sets the student's budget to an absolute amount, not a delta. Raising it above
 * their current spend is what releases a student the alarm has held.
 *
 * `notificationEmail` goes to the same endpoint - the old console called this
 * route twice under two names for exactly one PUT. Omitted from the body when not
 * passed, so a budget change from the table cannot blank out an email that the
 * table never showed the admin.
 */
export async function updateBudget(
  studentId: string,
  perStudentBudgetUsd: number,
  notificationEmail?: string,
): Promise<void> {
  await request<null>(`${studentPath(studentId)}/budget`, {
    method: "PUT",
    body:
      notificationEmail === undefined
        ? { perStudentBudgetUsd }
        : { perStudentBudgetUsd, notificationEmail },
  });
}

/**
 * Provisions a whole new student environment.
 *
 * One call does a great deal: it creates an IAM Identity Center identity if the
 * student has none, adds them to the student group, and launches the notebook
 * stack. It returns as soon as that is accepted, so the student appears in the
 * list as PROVISIONING and takes minutes to become ACTIVE.
 */
export async function createStudent(input: NewStudentInput): Promise<void> {
  await request<null>("/students", { method: "POST", body: input });
}
