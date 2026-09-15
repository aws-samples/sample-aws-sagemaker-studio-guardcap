"use client";

import { useCallback, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { useNotifications } from "@/components/notifications/NotificationProvider";
import { ApiError } from "@/lib/api/client";
import { createStudent } from "@/lib/api/students";
import type { NewStudentInput } from "@/lib/api/types";
import { FLEET_KEY } from "./useFleet";

export interface CreateStudentResult {
  creating: boolean;
  /** Resolves true when the API accepted the request. */
  create: (input: NewStudentInput) => Promise<boolean>;
}

/**
 * POST /students, and the reporting around it.
 *
 * Separate from useStudentActions because this one has no student to be busy for
 * and nothing to invalidate per student - it invalidates the fleet, which is where
 * the new row will appear.
 */
export function useCreateStudent(): CreateStudentResult {
  const { mutate } = useSWRConfig();
  const { notify } = useNotifications();
  const [creating, setCreating] = useState(false);

  // The guard has to be a ref, not the creating state above. Two calls raised from the
  // same event - a button that both fires onClick and submits its form, or a genuine
  // double click - both run before React re-renders, so both see creating === false and
  // both POST. A ref is written synchronously and is visible to the second call
  // immediately. Kept here rather than only at the call site so no future caller can
  // reintroduce it by wiring a button differently.
  const inFlight = useRef(false);

  const create = useCallback(
    async (input: NewStudentInput): Promise<boolean> => {
      // Reports the first call's outcome, not a spurious failure: the duplicate is
      // discarded, so nothing is notified and the form waits on the real request.
      if (inFlight.current) return false;
      inFlight.current = true;
      setCreating(true);
      try {
        await createStudent(input);
        // Awaited, so the list already contains the new student by the time the
        // form navigates back to it. Returning first would land the admin on a
        // table that does not yet show what they just created.
        await mutate(FLEET_KEY);
        notify({
          type: "success",
          header: `Provisioning started for ${input.studentId}`,
          // Said explicitly because the row appears as PROVISIONING and stays
          // there for minutes: without this, that looks like a stuck request.
          content:
            "The environment is being built. It will show as Provisioning until the stack finishes, which usually takes several minutes.",
        });
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          notify({
            type: "error",
            header: "Your session has ended",
            content: "Sign in again, then retry. Nothing was created.",
          });
          return false;
        }
        notify({
          type: "error",
          header: `Could not create ${input.studentId}`,
          // The API's own message: a duplicate id, a template that will not
          // launch and a missing Identity Center group are all reported here and
          // only the backend knows which.
          content:
            error instanceof ApiError
              ? error.detail || `The API returned ${error.status}.`
              : "The request did not reach the API. Check your connection and try again.",
        });
        return false;
      } finally {
        inFlight.current = false;
        setCreating(false);
      }
    },
    [mutate, notify],
  );

  return { creating, create };
}
