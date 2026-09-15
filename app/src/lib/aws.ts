// Console deep links for a student's real AWS resources.
//
// The old console hard-coded `const REGION = 'us-east-1'`, so every link it built
// was correct only for that one deployment and silently wrong for any other. The
// region is derivable from data the app already holds, so it is derived - and
// where it cannot be, the link is omitted rather than guessed at. A console link
// that opens the right page in the wrong region is worse than no link: it shows
// an empty stack list and reads as "this resource is gone".

import type { Student } from "./api/types";

/**
 * The region field of an ARN: `arn:partition:service:region:account:resource`.
 *
 * Returns null for a global service. IAM ARNs - execution roles and the deny
 * policy, which are the ARNs most visible on the detail page - have an EMPTY
 * region segment, because IAM is global. Treating that empty string as a region
 * would build `https://.console.aws.amazon.com/...`, so it is rejected here
 * rather than at each call site.
 */
export function regionFromArn(arn: string | null | undefined): string | null {
  if (!arn) return null;
  const parts = arn.split(":");
  // A well-formed ARN has at least 6 colon-separated fields.
  if (parts.length < 6 || parts[0] !== "arn") return null;
  const region = parts[3];
  return region === "" ? null : region;
}

/**
 * The region of an API Gateway invoke URL, e.g.
 * `https://abc123.execute-api.ap-southeast-1.amazonaws.com/prod`.
 *
 * The fallback, and a sound one: the admin API is deployed by the same SAM stack
 * that owns the student resources, so its region is theirs.
 */
export function regionFromApiUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\.execute-api\.([a-z0-9-]+)\.amazonaws\.com/.exec(url);
  return match?.[1] ?? null;
}

/**
 * Best available region for one student's resources.
 *
 * The stop-function ARN first, because it is the resource's own region and so
 * cannot be wrong. IAM ARNs are deliberately not consulted - see regionFromArn.
 * The API URL is the fallback for a student whose stack has not reported its
 * outputs yet, which is every student mid-provision.
 *
 * There used to be a second ARN in this chain, `budgetAlertsTopicArn`. It was a
 * leftover from the AWS Budgets design: the handler writes exactly three ARNs at
 * CREATE_COMPLETE - execution role, deny policy and stop function - and no SNS
 * topic is among them, so that link was always undefined and never narrowed
 * anything.
 */
export function studentRegion(
  student: Student,
  apiBaseUrl: string,
): string | null {
  return (
    regionFromArn(student.stopFunctionArn) ?? regionFromApiUrl(apiBaseUrl)
  );
}

/**
 * The CloudFormation stack detail page. `stackId` accepts a stack name, which is
 * all this app has.
 */
export function stackConsoleUrl(
  region: string | null,
  stackName: string | null | undefined,
): string | null {
  if (!region || !stackName) return null;
  return (
    `https://${region}.console.aws.amazon.com/cloudformation/home` +
    `?region=${region}#/stacks/stackinfo?stackId=${encodeURIComponent(stackName)}`
  );
}

/**
 * The SageMaker Studio DOMAIN page in the console - not the student's Studio
 * itself.
 *
 * A per-user Studio URL has to be presigned by the backend for that user, so an
 * admin following one would either be denied or, worse, land in their own
 * Studio and believe it was the student's. The domain page is the thing an admin
 * can actually act on: it lists the user profiles and their running apps.
 */
export function studioDomainConsoleUrl(
  region: string | null,
  domainId: string | null | undefined,
): string | null {
  if (!region || !domainId) return null;
  return (
    `https://${region}.console.aws.amazon.com/sagemaker/home` +
    `?region=${region}#/studio/${encodeURIComponent(domainId)}`
  );
}
