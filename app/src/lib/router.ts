import { useEffect, useMemo, useRef } from "react";
import {
  useLocation,
  useNavigate,
  useSearchParams as useLocationSearchParams,
} from "react-router-dom";

/**
 * The three navigation hooks this app uses, with the signatures it already
 * called them by.
 *
 * This exists so the migration off Next was a build change rather than a
 * refactor: every component that reached for `next/navigation` now imports from
 * here and is otherwise untouched. It is a small surface on purpose - if a call
 * site needs something react-router offers and this does not, import react-router
 * there directly rather than growing a second router API.
 */

/** Current path, no query string. Always starts with "/". */
export function usePathname(): string {
  return useLocation().pathname;
}

export interface Router {
  /** Navigate, leaving the current entry in history. */
  push: (href: string) => void;
  /** Navigate, replacing the current entry - Back skips it. */
  replace: (href: string) => void;
}

/**
 * Stable for the lifetime of the component, which is load-bearing rather than an
 * optimization: AuthProvider lists the router in an effect's dependencies, and an
 * identity that changed on navigation would re-run session initialization - and
 * with it the post-sign-in redirect - every time the user moved.
 *
 * react-router's `navigate` is documented as stable, so the ref is belt and
 * braces against that changing; it costs one indirection.
 */
export function useRouter(): Router {
  const navigate = useNavigate();
  const latest = useRef(navigate);

  useEffect(() => {
    latest.current = navigate;
  }, [navigate]);

  return useMemo(
    () => ({
      push: (href: string) => latest.current(href),
      replace: (href: string) => latest.current(href, { replace: true }),
    }),
    [],
  );
}

/**
 * Read-only view of the query string.
 *
 * Only the reader half of react-router's tuple is exposed, because that is all
 * any call site wants: the one parameter this app navigates by (`?student=`) is
 * set by pushing an href, not by mutating params in place.
 */
export function useSearchParams(): URLSearchParams {
  return useLocationSearchParams()[0];
}
