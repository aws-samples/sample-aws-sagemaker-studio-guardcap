"use client";

import { listStudents } from "@/lib/api/students";
import type { Student } from "@/lib/api/types";
import { type PolledResult, usePolled } from "./usePolled";

/**
 * One shared cache key for the student list.
 *
 * The dashboard, the students table and the budget page all read it, and all
 * three get the same numbers from the same single request per interval.
 */
export const FLEET_KEY = "fleet/students";

// Module-level so the reference is stable across renders. A fresh `[]` per call
// would be a new object every time and defeat any downstream memoization.
const NO_STUDENTS: Student[] = [];

export interface UseFleetResult extends Omit<PolledResult<Student[]>, "data"> {
  students: Student[];
}

export function useFleet(): UseFleetResult {
  const { data, ...rest } = usePolled(FLEET_KEY, listStudents, NO_STUDENTS);
  return { students: data, ...rest };
}
