"use client";

import useSWR from "swr";
import { getWhoAmI } from "@/lib/api/whoami";
import type { WhoAmI } from "@/lib/api/types";

export const WHOAMI_KEY = "whoami";

export interface WhoAmIResult {
  whoami: WhoAmI | null;
  /** True until the first answer, either way. Routing must wait for it. */
  isLoading: boolean;
  /** The request failed. Treated as "role unknown", not as "no access". */
  error: unknown;
}

/**
 * Who the signed-in user is, according to the backend.
 *
 * Not `usePolled`, unlike the data hooks: group membership does not change while
 * someone is looking at a page, and the answer decides which page they are
 * looking at - re-fetching it every thirty seconds would risk moving them
 * mid-task if a transient failure came back as a different landing. Fetched once
 * per session, and `key: null` keeps it from being fetched before there is a
 * token to send.
 */
export function useWhoami(enabled: boolean): WhoAmIResult {
  const { data, error, isLoading } = useSWR(
    enabled ? WHOAMI_KEY : null,
    getWhoAmI,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      // One retry only. A student who cannot be classified should reach a page
      // that says so, rather than a spinner that never resolves.
      errorRetryCount: 1,
    },
  );

  return { whoami: data ?? null, isLoading, error };
}
