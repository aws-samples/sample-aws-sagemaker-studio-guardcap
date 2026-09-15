"use client";

import useSWR from "swr";
import { ApiError } from "@/lib/api/client";

/**
 * Every polled endpoint refreshes on the same cadence, so a page reading two of
 * them cannot show figures from two different moments.
 */
export const REFRESH_INTERVAL_MS = 30_000;

/** Epoch ms is stored alongside the payload - see the note in usePolled. */
export interface Fetched<T> {
  value: T;
  fetchedAt: number;
}

export interface PolledResult<T> {
  data: T;
  /** Epoch ms the data was received, or null before the first success. */
  fetchedAt: number | null;
  error: Error | null;
  /** True only for the very first load, when there is nothing to show yet. */
  isLoading: boolean;
  /** True while a background or manual refresh runs over data already on screen. */
  isRefreshing: boolean;
  /** True when the failure was a 401: the session ended, the API did not break. */
  isUnauthorized: boolean;
  /**
   * True when the failure was a 403: the session is fine and this account is not
   * allowed to read this. Distinct from a 401 because signing in again cannot
   * help - the token is valid, its group membership is the problem. That is the
   * difference between a student who has landed on the admin console and an admin
   * whose session expired.
   */
  isForbidden: boolean;
  /** True when the request never completed, so there is no status code at all. */
  isNetworkError: boolean;
  refresh: () => void;
}

/**
 * Shared plumbing for a polled, cache-keyed endpoint.
 *
 * The old app polled each endpoint from every component that needed it, on
 * independent 30-second intervals - so two views of the same data could disagree,
 * and the API took one request per mounted component. A single SWR key per
 * endpoint means one request per interval however many components read it.
 *
 * @param fallback returned in place of `undefined` before the first load, so
 *   callers never have to handle an absent value. Must be a stable reference
 *   (a module-level constant), not a fresh literal, or every render produces a
 *   new object and anything memoizing on it re-runs forever.
 */
export function usePolled<T>(
  key: string,
  fetcher: () => Promise<T>,
  fallback: T,
): PolledResult<T> {
  const { data, error, isLoading, isValidating, mutate } = useSWR<
    Fetched<T>,
    Error
  >(
    key,
    // The timestamp is stored inside the cached value rather than in component
    // state so that every consumer reports the same "last updated" moment. Held
    // per component, two views of one cache could disagree about when it was
    // refreshed.
    async () => ({ value: await fetcher(), fetchedAt: Date.now() }),
    {
      refreshInterval: REFRESH_INTERVAL_MS,
      // Coming back to the tab after a while should not leave stale spend on
      // screen until the next tick of the interval.
      revalidateOnFocus: true,
    },
  );

  return {
    data: data?.value ?? fallback,
    fetchedAt: data?.fetchedAt ?? null,
    error: error ?? null,
    isLoading,
    // isValidating is also true during the first load; separating the two lets
    // the view show a skeleton once and a quiet spinner thereafter.
    isRefreshing: isValidating && !isLoading,
    isUnauthorized: error instanceof ApiError && error.status === 401,
    isForbidden: error instanceof ApiError && error.status === 403,
    // A request blocked before it was sent - a failed CORS preflight is the
    // common one - rejects as a TypeError with no status. Distinguished from an
    // ApiError because the two need different advice: there is no status code to
    // look up, so the view has to explain the cause instead of quoting one.
    isNetworkError: error != null && !(error instanceof ApiError),
    refresh: () => {
      // Fire and forget: the hook already surfaces both the pending and the
      // error state, so awaiting here would only produce an unhandled rejection.
      void mutate();
    },
  };
}
