"use client";

import { getMySummary, getMyUsage } from "@/lib/api/me";
import type { MySummary, MyUsage } from "@/lib/api/types";
import { type PolledResult, usePolled } from "./usePolled";

/**
 * The signed-in student's own record.
 *
 * Its own cache key, not a lookup into the fleet list: a student cannot read
 * GET /students at all, so there is no list here to look into.
 */
export const ME_KEY = "me/summary";

/**
 * Polled on the same 30-second cadence as the admin pages. Worth polling rather
 * than reading once, for the case the whole page exists to cover: a student
 * watching their spend approach the cap, whose environment is held by the
 * enforcement job while they are looking at it.
 */
export function useMe(): PolledResult<MySummary | null> {
  return usePolled(ME_KEY, getMySummary, null);
}

/** Metering detail for the same student: GET /me/usage. */
export const MY_USAGE_KEY = "me/usage";

/**
 * A separate key from ME_KEY, on the same cadence.
 *
 * Two requests where one endpoint could have served both, and deliberately: the
 * session list is the part of this page that grows, and keeping it off the key
 * the header figures read means a slow or failed /me/usage cannot stop the
 * student seeing whether they are about to be cut off.
 */
export function useMyUsage(): PolledResult<MyUsage | null> {
  return usePolled(MY_USAGE_KEY, getMyUsage, null);
}
