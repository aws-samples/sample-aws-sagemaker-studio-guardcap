// Shapes returned by the admin API.
//
// PROVENANCE: the admin Lambda handler itself - the single-function dispatcher
// that serves every route here. Where a field is written by exactly one place in
// that handler, the note on it says which, because that is the only thing that
// decides whether it can be absent.
//
// Optionality follows what the handler writes, not what it declares: DynamoDB
// has no schema, so a field only exists on a record once some code path has put
// it there. Everything api_add_student writes at creation time is present from
// the start; everything job_stack_status_sync or job_usage_sync adds later is
// absent until that job has run, which is why the spend fields are optional even
// on a healthy ACTIVE student.
//
// Monetary values arrive as DynamoDB Decimals, which the handler's own
// DecimalEncoder serializes as JSON numbers - so ApiNumber's string arm is
// tolerance, not an observed shape.

/** Lifecycle of a student's provisioned environment. */
export type StudentStatus =
  | "ACTIVE"
  | "ON_HOLD"
  | "SUSPENDED"
  | "PROVISIONING"
  | "DELETING"
  | "PROVISION_FAILED";

/**
 * Monetary and percentage fields are typed to admit strings as well as numbers.
 * The handler's DecimalEncoder emits numbers, so that is what arrives - but the
 * old console ran every one of these through `Number(x || 0)` and so never
 * depended on it, and `toNumber` in lib/students.ts keeps the same tolerance.
 */
export type ApiNumber = number | string | null;

export interface SpendPoint {
  /** ISO date, one point per day. */
  date: string;
  spend: ApiNumber;
}

export interface Student {
  studentId: string;
  status: StudentStatus;

  givenName?: string | null;
  familyName?: string | null;
  studentEmail?: string | null;
  notificationEmail?: string | null;

  instanceType?: string | null;
  /** SageMaker Studio domain, used to build a deep link to the console. */
  domainId?: string | null;
  /** CloudFormation stack backing this student's environment. */
  stackName?: string | null;

  /**
   * Absent until job_usage_sync has metered this student at least once. The
   * figure is the platform's own: it samples running notebooks and prices them
   * off a rate card, rather than reading AWS Budgets, which reported roughly
   * three times a day and so let an $80 cap enforce nearer $90.
   */
  currentSpendUsd?: ApiNumber;
  perStudentBudgetUsd?: ApiNumber;
  /** Server-computed spend/budget ratio. Not recomputed locally - see percentUsed(). */
  percentUsed?: ApiNumber;
  /** Up to 14 daily points. Empty until the usage sync job has run. */
  spendHistory?: SpendPoint[] | null;

  /**
   * Why the environment is held, written by whichever path held it - a budget
   * breach, a manual suspend, or a login deleted outside the console. The only
   * field that explains a status, so it is what the student is shown.
   */
  onHoldReason?: string | null;

  /** Sub-statuses shown on the detail page; free-form strings from AWS APIs. */
  computeStatus?: string | null;
  provisioningStatus?: string | null;
  /**
   * The directory's own account flag, and NOT a sign-in signal - neither service
   * has one. Under ORGANIZATION mode this is Identity Center's ENABLED/DISABLED;
   * under ACCOUNT mode it is Cognito's UserStatus, where FORCE_CHANGE_PASSWORD is
   * the normal state until the student first opens their invitation email. The
   * handler also writes its own "DELETED" here when a login has vanished from the
   * directory, which is a suspension worth reading as such.
   *
   * Named `identityCenterStatus` here until the handler was available. Nothing
   * ever wrote that key, so the detail page showed an em dash for every student.
   */
  directoryStatus?: string | null;

  /**
   * Why the environment is held, as an enum rather than prose: BUDGET, MANUAL or
   * DIRECTORY. It decides what lifts the hold - only a BUDGET hold clears itself
   * at month rollover, because a manual suspension and a deleted login are
   * decisions about a person that a calendar page turning says nothing about.
   * Empty string when nothing holds them, which is how the handler clears it.
   */
  onHoldKind?: "BUDGET" | "MANUAL" | "DIRECTORY" | "" | null;

  /** The three enforcement handles, written together at CREATE_COMPLETE. */
  executionRoleArn?: string | null;
  denyPolicyArn?: string | null;
  stopFunctionArn?: string | null;

  /** Billing period the spend figures above cover, `YYYY-MM`. */
  usagePeriod?: string | null;
  /**
   * When the metering sweep last wrote those figures. The one honest answer to
   * "is this number current", since the spend on this record is a denormalised
   * copy of the ledger refreshed once per sweep.
   */
  usageUpdatedAt?: string | null;
}

/**
 * Body of POST /students.
 *
 * PROVENANCE: this one is not inferred - it is the exact payload the old console
 * sent (reference_old/frontend/src/AddStudentModal.jsx), which is the only
 * evidence of what the endpoint accepts. Notably it does NOT include a domain id:
 * the Venue design asks the admin to paste one, but the backend takes the Studio
 * domain from the platform stack itself, so a field for it would be a question
 * with no effect on the result.
 */
export interface NewStudentInput {
  studentId: string;
  givenName: string;
  familyName: string;
  studentEmail: string;
  instanceType: string;
  perStudentBudgetUsd: number;
  /** Omitted entirely when blank - the backend falls back to the ops address. */
  notificationEmail?: string;
}

/**
 * The four the handler records. Widened with `string` because this is display
 * vocabulary, not a contract: an alarm type added to the backend must render as
 * itself rather than fail to typecheck here.
 */
export type AlarmType =
  | "BUDGET_THRESHOLD_BREACHED"
  | "THRESHOLD_80_APPROACHING"
  | "DIRECTORY_IDENTITY_DELETED"
  | "POOL_THRESHOLD_APPROACHING"
  | string;

export interface AlarmEvent {
  /** The table's partition key, a uuid4 per event. Row identity. */
  eventId?: string | null;
  /**
   * Guarded with `?.` in the old code, so it can apparently be absent. Also holds
   * the literal "CLASS_POOL" for the class-wide backstop's own events, which are
   * about the cohort and not about any one student - see CLASS_POOL_ID.
   */
  studentId?: string | null;
  alarmTimestamp?: string | null;
  alarmType?: AlarmType;
  spendAtAlarmUsd?: ApiNumber;
  budgetUsd?: ApiNumber;
  enforcementAction?: string | null;
  status?: string | null;
}

/**
 * Body of GET /me - what a student may see about themselves.
 *
 * A separate type from `Student` rather than `Partial<Student>`, because the
 * handler builds this response from an explicit allowlist: the underlying record
 * also carries the ARNs of their execution role, deny policy and stop function,
 * the admin's notification email and who created them, and none of that is in
 * here. Typing it as a narrowed Student would invite a component to read a field
 * the endpoint does not return.
 */
export interface MySummary {
  studentId: string;
  status: StudentStatus;

  givenName?: string | null;
  familyName?: string | null;
  studentEmail?: string | null;

  onHoldReason?: string | null;
  provisioningStatus?: string | null;
  computeStatus?: string | null;
  instanceType?: string | null;

  perStudentBudgetUsd?: ApiNumber;
  /** Read live from the usage ledger's PERIOD row, not from the student record. */
  currentSpendUsd?: ApiNumber;
  percentUsed?: ApiNumber;
  /** Budget minus spend, floored at zero by the handler. */
  remainingUsd?: ApiNumber;
  spendHistory?: SpendPoint[] | null;

  /** The month the figures above cover, `YYYY-MM`. Resets are implicit: a new month has no ledger row, so spend starts at zero. */
  billingPeriod?: string | null;
  /**
   * What is left, expressed in the unit the student actually spends: remaining
   * budget over the hourly rate of their machine type. Null when no rate is known.
   */
  hoursRemaining?: ApiNumber;
  /** The rate that division uses, from the handler's own us-east-1 rate card. */
  hourlyRateUsd?: ApiNumber;
  /**
   * How far behind the figures can be, in minutes - the metering sweep interval.
   * Reported rather than hardcoded here because it is a backend deployment
   * setting, and a page that promises "every 20 minutes" against a 5-minute
   * sweep is telling the student something false.
   */
  enforcementLagMinutes?: number | null;

  createdAt?: string | null;
  updatedAt?: string | null;

  /**
   * Whether GET /me/studio-url will actually issue a link. Computed server-side
   * from the same conditions that route enforces, so the button state cannot
   * drift from the answer - which it would if this page re-derived it from
   * `status` and the backend later added a reason to refuse.
   */
  canOpenNotebook?: boolean;
}

/**
 * Body of GET /me/studio-url.
 *
 * `url` is a presigned SageMaker domain URL: single-use and short-lived, so it is
 * navigated to immediately and never stored or rendered as an href.
 */
export interface StudioUrl {
  studentId: string;
  userProfileName: string;
  url: string;
}

/**
 * One JupyterLab sitting, as metered by the usage ledger.
 *
 * These are real now. The platform samples every running app on each sweep and
 * accrues wall-clock seconds against a ledger row per session, so a sitting is a
 * row rather than something inferred from daily totals.
 *
 * There is no `endedAt`: nothing observes the moment an app stops, only that it
 * was gone on the next sweep. `lastSampledAt` is the honest equivalent - the
 * latest instant the meter can vouch for - and it is what the table shows as
 * "counted up to" instead of an end time it would have to invent.
 */
export interface UsageSession {
  /** SageMaker app name, and the ledger's key within the session. */
  appName: string;
  appType?: string | null;
  instanceType?: string | null;
  /** The rate this session accrued at, captured when it was first seen. */
  hourlyRateUsd?: ApiNumber;
  /** First sweep that saw the app, ISO 8601. Not when the student clicked. */
  startedAt?: string | null;
  /** Latest sweep that saw it running. Metering stops here, so cost does too. */
  lastSampledAt?: string | null;
  hours?: ApiNumber;
  accruedUsd?: ApiNumber;
  /** ACTIVE while the app was up at the last sweep; CLOSED once it was gone. */
  status?: "ACTIVE" | "CLOSED" | string | null;
}

/**
 * Body of GET /me/usage - the student's own metering detail.
 *
 * Overlaps GET /me on the budget figures deliberately: /me answers "am I about to
 * be cut off" in one request, and this answers "where did it go". Both read the
 * same ledger, so they agree.
 */
export interface MyUsage {
  studentId: string;
  /** `YYYY-MM`. */
  billingPeriod?: string | null;

  perStudentBudgetUsd?: ApiNumber;
  currentSpendUsd?: ApiNumber;
  percentUsed?: ApiNumber;
  remainingUsd?: ApiNumber;

  /** Metered hours this period, across every machine type. */
  totalHours?: ApiNumber;
  /**
   * Spend split by machine type, e.g. `{"ml.g5.xlarge": 24.1}`. A student on a
   * GPU instance who also leaves a t3.medium up wants to see which one is
   * costing them, and the total alone cannot say.
   */
  byInstanceType?: Record<string, ApiNumber> | null;

  sessions?: UsageSession[] | null;
  spendHistory?: SpendPoint[] | null;

  /**
   * What the cap does and does not count, in the backend's own words - notebook
   * compute only, not storage. Quoted rather than paraphrased, because if the
   * platform's coverage changes this sentence changes with it.
   */
  capCovers?: string | null;
  /** Date the hardcoded rate card was priced, `YYYY-MM-DD`. */
  ratesAsOf?: string | null;
}

/**
 * Body of GET /init - the one unauthenticated route, and the reason this app has
 * no build-time configuration.
 *
 * Everything a static export would otherwise need baked into its bundle arrives
 * here at runtime: what to call the product, what to show for it, and the Cognito
 * coordinates to sign in against. One artifact can then serve any deployment, and
 * rebranding does not mean rebuilding.
 *
 * Cached for five minutes by the handler, so treating it as immutable per page
 * load costs nothing.
 */
export interface InitConfig {
  appTitle: string;
  /** Short form, for the nav header where the full title will not fit. */
  appShortName: string;
  logoUrl: string;
  faviconUrl: string;
  /** Hex, applied as the accent colour. */
  primaryColor: string;
  institutionName: string;
  supportEmail?: string | null;

  /**
   * ORGANIZATION or ACCOUNT, and now available to a student - which is the point.
   * The same answer /platform-info gives an admin, on a route with no auth, so
   * the student page can stop guessing it from token claims.
   */
  identityMode?: "ORGANIZATION" | "ACCOUNT" | string | null;

  auth?: InitAuth | null;
}

export interface InitAuth {
  userPoolId?: string | null;
  clientId?: string | null;
  /** Hosted UI host, no scheme. Empty when the deployment has no hosted UI. */
  hostedUiDomain?: string | null;
  /** Where the hosted UI is allowed to send the code back to. */
  redirectUri?: string | null;
  adminGroup?: string | null;
  studentGroup?: string | null;
}

/**
 * Body of GET /whoami - which audience this token belongs to, decided by the
 * backend.
 *
 * Exists so the SPA stops inferring the answer. It previously read
 * `cognito:groups` off the id token, which is empty under ORGANIZATION mode where
 * groups live in Identity Center, and otherwise learned the answer from a 403.
 * Any valid token may call it, in either mode.
 */
export interface WhoAmI {
  email?: string | null;
  isAdmin: boolean;
  isStudent: boolean;
  /**
   * Where to land this user. Admin wins when they are in both groups, and NONE
   * means a valid sign-in with no role - a real state, and one worth saying out
   * loud rather than showing an empty console.
   */
  landing: "ADMIN" | "STUDENT" | "NONE" | string;
}

/**
 * Body of GET /platform-info. Admin-only. The identity fields duplicate what
 * /init serves anonymously; this route is where an admin sees the ids behind
 * them.
 */
export interface PlatformInfo {
  studioDomainId?: string | null;
  /** Null in ACCOUNT mode: these three exist only under ORGANIZATION. */
  studentGroupId?: string | null;
  identityStoreId?: string | null;
  identityCenterInstanceArn?: string | null;
  templateS3Url?: string | null;

  /**
   * ORGANIZATION or ACCOUNT, and the authoritative answer to which - the empty
   * Identity Center fields above are a symptom, not a signal.
   *
   * It decides whether a student opens Studio from an Identity Center portal tile
   * (ORGANIZATION, where the domain is AuthMode SSO) or from a presigned URL this
   * console asks for (ACCOUNT, where account instances cannot offer a tile).
   */
  identityMode?: "ORGANIZATION" | "ACCOUNT" | string | null;
  domainAuthMode?: "SSO" | "IAM" | string | null;
  rosterDirectory?: "IDENTITY_CENTER" | "COGNITO" | string | null;
  cognitoUserPoolId?: string | null;
  cognitoAdminGroup?: string | null;
  cognitoStudentGroup?: string | null;
}

/** GET /students wraps the array; the old client unwrapped it before returning. */
export interface StudentsResponse {
  students: Student[];
}

/** GET /alarm-events wraps the array under a different key than /students does. */
export interface AlarmEventsResponse {
  events: AlarmEvent[];
}
