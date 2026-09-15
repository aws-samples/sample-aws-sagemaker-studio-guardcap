"use client";

import { getStudent } from "@/lib/api/students";
import type { Student } from "@/lib/api/types";
import { type PolledResult, usePolled } from "./usePolled";

/**
 * One student, read from GET /students/{id}.
 *
 * A separate request from the fleet list, not a lookup into it, because the
 * detail-only fields - the resource ARNs, the compute and Identity Center
 * sub-statuses - are the ones the list has never been observed to carry. The
 * cached list is still put to use, as a fallback to render from while this
 * request is in flight: see StudentDetail.
 */
export function studentKey(studentId: string): string {
  return `fleet/students/${studentId}`;
}

export function useStudent(studentId: string): PolledResult<Student | null> {
  return usePolled(studentKey(studentId), () => getStudent(studentId), null);
}
