// The student-facing half of the API: three routes, all about the caller.
//
// Neither takes an identifier. The handler resolves the student from the `email`
// claim of the verified JWT and from nothing in the request, so there is no
// parameter here for a student to substitute another student's id into - which is
// exactly why these exist instead of letting a student call /students/{id}.
//
// Both are gated on membership of the student group, checked before the admin gate.
// An admin is deliberately NOT in that group and has no Studio user profile of
// their own, so an admin calling either of these gets a 403. There is no
// "view as student".

import { request } from "./client";
import type { MySummary, MyUsage, StudioUrl } from "./types";

/** The caller's own record, reduced to the fields a student may see. */
export async function getMySummary(): Promise<MySummary> {
  return request<MySummary>("/me");
}

/**
 * The caller's own metering detail for the current billing period: hours, spend
 * split by machine type, and one row per notebook session.
 *
 * A second request rather than more fields on /me, because it is a different
 * question - /me answers "am I about to be cut off", this answers "where did it
 * go" - and because the session list grows with the month while /me must stay
 * cheap enough to poll.
 */
export async function getMyUsage(): Promise<MyUsage> {
  return request<MyUsage>("/me/usage");
}

/**
 * A presigned SageMaker Studio URL for the caller's own user profile.
 *
 * Not polled and not prefetched: each call mints a fresh single-use URL, so it is
 * requested at the moment the student clicks and navigated to immediately. It also
 * refuses while they are suspended or over budget (403) and while their stack is
 * still building (409), so the failure is worth reporting rather than swallowing.
 */
export async function getMyStudioUrl(): Promise<StudioUrl> {
  return request<StudioUrl>("/me/studio-url");
}
