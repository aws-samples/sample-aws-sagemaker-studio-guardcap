# Architecture

Reference for the two CloudFormation templates and the console that drives them.
Prerequisites and parameters: [SETUP.md](SETUP.md). Commands:
[DEPLOYMENT.md](DEPLOYMENT.md). Money: [COSTING.md](COSTING.md). Diagrams:
[diagrams/](diagrams/) (open the `.drawio` files at
[app.diagrams.net](https://app.diagrams.net)) — `-complete` mirrors the resource
inventory below, `-simple` is the one-page version for a non-technical audience.

## What this is

A GPU notebook lab where each student gets their own SageMaker Studio
environment and a hard dollar cap that is enforced automatically — no human has
to notice that a student went over budget and manually cut off their access.

## Deploy model: two templates, two roles

| | `03-Sagemaker-Gpu-Platform-Base.yaml` | `04-Sagemaker-Gpu-Student.yaml` |
|---|---|---|
| Deployed by | you, once | the console, once per student |
| Creates | VPC, Studio domain, identity, tables, backend, API, jobs, console hosting | one student's execution role, UserProfile, and enforcement resources |
| Deploy time | 10–15 min (domain and CloudFront are the slow parts) | 2–4 min |
| Knows about the other | publishes `StudioDomainId`, `StudentStackDeployRoleArn` | takes `ExistingDomainId`, `DomainAuthMode` |

The two stacks are wired together **by name, not by `Ref`** — they are separate
stacks, so there is nothing to reference. This matters more than it sounds:
see [Names are load-bearing](#names-are-load-bearing).

Onboarding N students is N stack creates, each issued by the console's backend
under `StudentStackDeployRole`. There is no fan-out limit in the design beyond
CloudFormation's own concurrency and the sweep's duration
([COSTING.md](COSTING.md) §4.3).

## How the cap is actually enforced

This is the part worth understanding before anything else, because it replaced an
AWS Budgets design and the trade it makes is real.

```
every SweepMinutes:  usage_sync
  ListApps across the domain
    -> for each running app, accrue elapsed time onto its SESSION# ledger row
    -> price it from a published us-east-1 rate table
    -> add to that student's PERIOD#<YYYY-MM> row
    -> if PERIOD total >= that student's budget:
         attach  gpu-guardian-${StudentId}-deny-new-apps  to their exec role
         invoke  gpu-guardian-${StudentId}-stop-app
         record ON_HOLD  -- only if BOTH of the above succeeded
```

Two layers, because they do different jobs:

- **Layer 1 — block future spend.** `DenyNewAppsPolicy` denies
  `sagemaker:CreateApp`, `CreateSpace` and `UpdateSpace`. No new compute can
  start. `Delete*` is deliberately absent, so a held student — and teardown —
  can still tidy up.
- **Layer 2 — stop the meter on compute already running.** Layer 1 cannot touch
  a notebook that is already up, and a running notebook is the whole cost.
  `StopStudioAppFunction` deletes the student's `InService` and `Pending` apps.

`ON_HOLD` is recorded only if enforcement actually succeeded. The stop function
therefore has **no** reserved concurrency and **no** dead-letter queue on
purpose: the caller checks the invoke result, and a silently-queued retry would
be worse than a visible failure, because it would let the platform record a hold
that never happened.

### Metering, precisely

`UsageLedgerTable` holds two kinds of row per student:

| Row | Key | Contents |
|---|---|---|
| Session | `SESSION#<domainId>|<appType>|<owner>|<appName>` | `lastSampledAt`, accrued hours and dollars. TTL after 120 days. |
| Period | `PERIOD#<YYYY-MM>` | Accrued total per instance type. No TTL. |

`lastSampledAt` is what makes the meter **idempotent**: a sweep that runs twice,
or overlaps itself, accrues from the last sample rather than from the session
start, so nobody is double-charged.

Nothing observes an app *stopping* — only that it was gone by the next sweep. So
the honest figure is "counted up to `lastSampledAt`", which is what the student
portal shows, rather than an "ended at" the platform cannot know.

### Monthly reset is structural, not scheduled

Spend is read from `PERIOD#<YYYY-MM>`. On the 1st that row does not exist yet, so
everyone is at zero without anything having to run. The hourly
`period_rollover` job exists only to **detach** deny policies left over from last
month, and only where the hold was a budget hold — an admin's manual suspension
deliberately survives the month boundary.

### The trade against AWS Budgets

The previous design used `AWS::Budgets::Budget` with a native `APPLY_IAM_POLICY`
action. What changed:

| | AWS Budgets | Self-metered |
|---|---|---|
| Cost | $3.04 / student / month | $0 |
| Enforcement lag | up to ~12 hours | `SweepMinutes` (default 5) |
| Runs even if our code is broken | **yes** | **no** |

Budget actions cost $0.10 per action-enabled budget-day — 84% of a student
stack's standing cost — to evaluate a cap against data refreshed roughly three
times a day, which in practice made an $80 ceiling behave like $89–97.

The cost that replaced it is the important one: **this cap fails silent, not
closed.** If `UsageSyncRule` is disabled or the backend is unhealthy, notebooks
keep running and nothing stops them. Budgets ran inside AWS whether or not our
code did. That is what the three backend alarms exist for, and why
`BackendErrorsAlarm` sets `TreatMissingData: breaching` — silence is also an
alarm. See [COSTING.md](COSTING.md) §4.1–4.2.

## Identity: two modes, one authorization path

`IdentityCenterInstanceType` selects the mode, and it sets the Studio domain's
`AuthMode`, which is **immutable**.

| | `ORGANIZATION` | `ACCOUNT` |
|---|---|---|
| Studio `AuthMode` | `SSO` | `IAM` |
| Identity source | Identity Center | Cognito |
| Cognito's role | a SAML-to-session bridge only | the identity source |
| Admin sign-in | IdC → SAML → Cognito → console | Cognito hosted UI |
| Student reaches a notebook via | the access portal's Studio tile | a presigned URL the backend mints |
| Group membership lives in | Identity Store groups, propagated by SAML | Cognito user pool groups |

What does *not* change: the same user pool, the same app client, and the same JWT
authorizer in both modes. Only the group claim distinguishes an admin from a
student, so the backend has one authorization path and reads which store to
consult from `IDENTITY_MODE`.

The `AWS::Cognito::UserPoolGroup` resources are created unconditionally for that
reason — belt-and-braces under `ORGANIZATION`, the only authorization signal
there is under `ACCOUNT`.

Under `SSO`, `StudentUserProfile` carries `SingleSignOnUserIdentifier` /
`SingleSignOnUserValue`; under `IAM` it must not. That is the `IsSsoDomain`
condition in the student template, and it is why `DomainAuthMode` must match the
domain it is attaching to.

## Platform stack inventory

The template is organised in numbered sections 0–14; this follows them.

### 0. Encryption

`PlatformKey` (a KMS CMK, rotation on, `PendingWindowInDays: 30`) and
`PlatformKeyAlias` (`alias/gpu-guardian`).

One key for everything in the stack a scanner asks for a CMK on: the Studio
domain's home EFS and all three DynamoDB tables. One rather than four because
nothing here needs cryptographic separation — the same admin can read all of it
through the console — and a key is ~$1/month each. It is numbered 0 because
sections 3 and 8 reference it.

Two consequences that are not obvious:

- **The key is load-bearing for recovery.** Schedule its deletion and the three
  tables become unreadable, every point-in-time restore of them useless, and the
  home EFS unrecoverable. Hence the 30-day window rather than the 7-day minimum.
- **A CMK is not transparent to the caller.** `AdminBackendFunctionRole` carries an
  `EncryptStateTables` statement for it. Without that, every roster and ledger read
  fails and **the cap stops metering** — a worse failure than the finding the key
  closes.
- **Every Studio execution role needs its own grant on the key, or no notebook
  starts.** Opening a Space makes SageMaker create an EBS volume encrypted with the
  domain's `KmsKeyId`; without permission the student sees `PermissionError: Unable to
  create EBS volume for Space … you don't have permissions to use the KMS key`. Both
  `gpu-guardian-domain-role` and every per-student `-exec-role` therefore carry
  `UseStorageEncryptionKey`: `kms:CreateGrant`, `Decrypt`, `DescribeKey`,
  `GenerateDataKey` and `GenerateDataKeyWithoutPlaintext` on the key ARN. See
  [DEPLOYMENT.md § Notebooks will not start](DEPLOYMENT.md#notebooks-will-not-start)
  for the three ways this is easy to get wrong.

`KmsKeyId` on `AWS::SageMaker::Domain` is **create-only**: adding it to a live domain
does not replace the domain, it fails the update outright — the replacement collides
with the original on `DomainName`. See
[Known trade-offs](#known-trade-offs) and
[SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) §2.

### 1. Networking

`Vpc` (`10.42.0.0/16`), `PublicSubnet` (`10.42.0.0/24`,
`MapPublicIpOnLaunch: false`), `InternetGateway`, `VpcGatewayAttachment`,
`PublicRouteTable`, `PublicRoute`, `PublicSubnetRouteTableAssociation`.

Sized for `AppNetworkAccessType: PublicInternetOnly`: no NAT gateway, no
interface endpoints, no private subnet. Notebook traffic egresses through the
IGW. The only ENI that ever lands in the subnet is the Studio domain's own EFS
mount target — verified against a live deployment.

The trade is explicit: this is the cheap topology, not the locked-down one. A
`VpcOnly` domain would need a private subnet, a NAT gateway and a set of
interface endpoints, and would change [COSTING.md](COSTING.md) §1 substantially.

### 2. Identity Center federation — `Condition: IsOrgInstance`

| Resource | Purpose |
|---|---|
| `StudentGroup` | `SageMaker-GPU-Guardian-Students`. Production membership comes from the institution's IdP sync, not from this template. |
| `AdminGroup` | `SageMaker-GPU-Guardian-Admins`. Assign this to the SAML application so only its members can sign in. |
| `StudentPermissionSet` | Grants `sagemaker:CreatePresignedDomainUrl` and `DescribeUserProfile` — nothing else. |
| `StudentAssignment` | Binds the permission set to the group, account-wide. |

None of these exist under `ACCOUNT`, which is why `CognitoAdminGroup` has to be
the authorization signal in both modes.

### 3. Notebook frontend

`DomainExecutionRole` + `DomainExecutionRolePolicy` (CloudWatch Logs only) and
`StudioDomain`, whose home EFS is encrypted under `PlatformKey` (§0).

`AWS::SageMaker::Domain` has no property for EFS retention. `RetentionPolicy` is
a raw `DeleteDomain` API parameter, not a CloudFormation resource property, and
setting it in the template fails early validation. Consequence: deleting the
domain always leaves the home EFS filesystem, its mount-target ENI, and two
SageMaker-created NFS security groups behind, all of which block subnet and VPC
deletion. The teardown cleanup in [DEPLOYMENT.md](DEPLOYMENT.md) is not optional.

### 4. Class pool and anomaly detection

`CostAnomalyMonitor` and `CostAnomalySubscription`, both
`Condition: CreateAnomalyMonitor`, plus the notify-only `ClassPoolCapUsd`
handling.

Neither blocks anybody. A per-student breach is safe to auto-remediate — blast
radius, one student — but auto-locking a whole class out when the shared pool
runs dry is a decision an operator should make with eyes open, not something that
fires unattended.

Gated off by default because AWS permits only one `SERVICE`-dimension anomaly
monitor per account; a second fails the whole stack with `AlreadyExists`.

### 5. Bootstrap config

Seven SSM parameters under `/gpu-guardian-admin/`: `existing-domain-id`,
`notification-email-default`, `template-s3-url`, `storage-kms-key-arn`, and —
`ORGANIZATION` only — `identity-center-instance-arn`, `identity-store-id`,
`student-group-id`.

All written with real in-stack values at create time, so there is no
placeholder-then-bootstrap-script two-step.

`storage-kms-key-arn` carries `PlatformKey`'s ARN to the per-student stack, where it
becomes the `StorageKmsKeyArn` parameter and grants that student's execution role use
of the key. It is the reason a student can open a notebook at all — see §0 — and it
must be the ARN, not the alias.

### 6. Provisioning

`TemplatesBucket` holds the two artifacts the template does not carry inside
itself. `TemplatesBucketPolicy` beside it grants nothing — its only statement
denies any request that did not arrive over TLS; read access is granted
identity-side. `StudentStackDeployRole` is the role the backend assumes to create
per-student stacks — the console never holds those permissions directly.

`LogsBucket` also lives here, because this is the first section that needs one. It
takes server access logs from both S3 buckets and standard logs from the CloudFront
distribution (§12), under three prefixes, and **logs to itself** under a fourth —
otherwise the access-logging finding would just move to the new bucket. That
self-reference is why the 90-day lifecycle rule on it is not optional, and why the
destination is written as a literal `!Sub` of its own name rather than a `!Ref`
(which CloudFormation reports as a circular dependency). `ObjectOwnership` has to
stay `BucketOwnerPreferred`: CloudFront grants itself delivery access by writing
the bucket ACL and has no policy equivalent.

### 7. Auth

`CognitoUserPool` (email as username), `CognitoUserPoolDomain`,
`CognitoAdminGroup` (`gpu-guardian-admins`, precedence 0), `CognitoStudentGroup`
(`gpu-guardian-students`, precedence 10), `CognitoUserPoolClient`, and
`CognitoSamlIdentityProvider` under `Condition: UseSamlFederation`
(= `HasSamlMetadata` **and** `IsOrgInstance`).

The pool sets `AdminCreateUserConfig: AllowAdminCreateUserOnly: true`, so
self-registration is off — Cognito's default leaves the public `SignUp` API open
on the hosted UI, and an account created that way lands in no group but still
holds a valid JWT. Every real user arrives through `AdminCreateUser` (ACCOUNT
mode) or SAML federation (ORGANIZATION mode).

Student group membership grants exactly one thing: `GET /me/studio-url`, which
returns a presigned URL for the caller's **own** UserProfile and nothing else.
Students never reach an admin route.

### 8. Alerting and state

`AdminAlertsTopic` + `AdminAlertsEmailSubscription`, and three DynamoDB tables —
all `PAY_PER_REQUEST`, with point-in-time recovery and `SSESpecification` under
`PlatformKey` (§0). `SSEType: KMS` is what makes that mean *customer-managed*;
omitting `KMSMasterKeyId` would silently select the `aws/dynamodb` managed key:

| Table | Keys | Notes |
|---|---|---|
| `gpu-guardian-admin-students` | HASH `studentId` | GSI `StatusIndex` on `status`, projection `ALL`. Holds the **enforced** budget, which is why a cap change needs no stack update. |
| `gpu-guardian-admin-alarm-events` | HASH `eventId` | The audit trail of enforcement decisions. |
| `gpu-guardian-admin-usage-ledger` | HASH `studentId`, RANGE `sk` | TTL on `expiresAt`, 120 days. The figure the cap is enforced from. |

### 9. Backend

`AdminBackendFunction` (`gpu-guardian-admin-backend`), python3.12, timeout 120 s,
memory 256 MB, `ReservedConcurrentExecutions: 10`, dead letters to
`AdminAlertsTopic`.

Its inline `ZipFile` is a ~40-line **loader only**. CloudFormation caps inline
code at 4096 characters and the real handler is ~2400 lines, so the loader
fetches `scripts/01-admin-platform-api.py` from `TemplatesBucket` on cold start
and caches it in a module global. Two consequences worth knowing:

- Re-uploading the handler **is** a code deploy — no stack update.
- A warm container keeps the old module, so a deploy needs a forced cold start.

### 10. HTTP API

`AdminHttpApi`, a JWT `AdminHttpApiAuthorizer` against the user pool, one Lambda
proxy integration, and 14 routes on a `$default` stage with `AutoDeploy: true`.

| Route | Access |
|---|---|
| `GET /init` | **unauthenticated** — branding and public sign-in coordinates only, `Cache-Control: public, max-age=300` |
| `GET /whoami` | authenticated, neither admin- nor student-gated |
| `GET /platform-info` | admin |
| `GET /students` | admin |
| `GET /students/{studentId}` | admin |
| `POST /students` | admin |
| `DELETE /students/{studentId}` | admin |
| `PUT /students/{studentId}/budget` | admin |
| `POST /students/{studentId}/suspend` | admin |
| `POST /students/{studentId}/resume` | admin |
| `GET /alarm-events` | admin |
| `GET /me` | student |
| `GET /me/usage` | student |
| `GET /me/studio-url` | student |

`GET /init` has to be unauthenticated: it is what tells the app where to send the
user to authenticate. It is also why one built bundle works against any
deployment, and why re-branding is a stack update rather than a rebuild.

The access log format is JSON and includes `jwtSub` and
`integrationErrorMessage`. Its `DestinationArn` is spelled out with `!Sub`
rather than `!GetAtt`, which would append `:*` and be rejected.

It does **not** include the email claim. It did until 2026-09-03, which put a real
address in every one of 365 days of request records; `sub` is the Cognito user id,
so it identifies the caller just as well and stays resolvable to a person through
`admin-get-user` or the students table without the log holding the identity itself.

### 11. Scheduled jobs

| Rule | Schedule | Payload |
|---|---|---|
| `gpu-guardian-admin-stack-status-sync` | `rate(5 minutes)` | `{"job": "stack_status_sync"}` |
| `gpu-guardian-admin-usage-sync` | `rate(${SweepMinutes} minutes)` | `{"job": "usage_sync"}` |
| `gpu-guardian-admin-period-rollover` | `rate(1 hour)` | `{"job": "period_rollover"}` |

`SweepMinutes` has `MinValue: 2` because EventBridge requires the singular
`rate(1 minute)` and the template builds the plural form.

### 12–13. Console hosting and bucket cleanup

`FrontendBucket` (private), `FrontendOriginAccessControl`,
`FrontendDistribution`, `FrontendBucketPolicy`. CloudFront serves `index.html`
for any path it cannot find, so every route is resolved in the browser.

`FrontendDistribution` also writes standard access logs to `LogsBucket` under the
`cloudfront/` prefix. `DistributionConfig.Logging.Bucket` takes the bucket's
*domain name*, and it has to be standard logging (legacy) rather than v2 — the
scanner rules do not look outside `DistributionConfig`.

`FrontendWebAcl` sits in front of it: three AWS managed rule groups
(`AmazonIpReputationList`, `CommonRuleSet`, `KnownBadInputsRuleSet`) and a
rate-based rule at 2,000 requests per IP per five minutes, `DefaultAction: Allow`,
logging to `aws-waf-logs-gpu-guardian-admin-frontend`. Two things constrain it.
**A `Scope: CLOUDFRONT` web ACL can only be created in us-east-1**, so the ACL, its
log group, its logging configuration and the `WebACLId` on the distribution are all
gated on an `InUsEast1` condition — deploy the platform stack outside us-east-1 and
the console has no WAF, silently. The `FrontendWebAclArn` output is empty in that
case. And **it is not the authorization boundary**: the API is reached directly, so
the WAF never sees a request that carries a token. It is defence in depth over
public static assets, at $9.02/month — the largest line in the control plane
([COSTING.md](COSTING.md) §1, [SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) §20).

`BucketCleanupFunction` and three custom resources empty all three buckets on
delete, so `DeleteStack` does not stop on a non-empty bucket. `LogsBucketCleanup`
is ordered to run **last**: emptying the other two is itself logged. The ordering
is expressed as `DependsOn: LogsBucketCleanup` on the *other two*, because
CloudFormation deletes a resource before the things it depends on.

### 14. Alarms

`BackendErrorsAlarm` (Errors, Sum, 300 s, threshold 0,
`TreatMissingData: breaching`, alarm **and** OK actions),
`BackendThrottlesAlarm` (Throttles, threshold 0), `BackendDurationAlarm`
(Duration, **Maximum**, 90 000 ms = 75% of the timeout, 2 evaluation periods).

These are the platform's first alarms, and they exist because the cap fails
silent. The duration alarm in particular is the early warning that the sweep is
outgrowing its window as the class grows.

## Per-student stack inventory

| Resource | Purpose |
|---|---|
| `StudentExecutionRole` (+ two policies) | The Studio execution role, and the target of every enforcement action. Per-student on purpose: it is what keeps a breach from touching anyone else. |
| `StudentUserProfile` | The notebook environment. `InstanceType`'s `AllowedValues` list **is** the tier control. |
| `DenyNewAppsPolicy` | Enforcement layer 1. Not attached by this stack. |
| `StopStudioAppFunction` (+ role, policy, log group) | Enforcement layer 2. |
| `StudentStudioCleanup` (+ function, role, log group) | `DependsOn: StudentUserProfile`. On delete: stop apps → wait for `Deleted` → delete Spaces → wait → respond. |

`DenyNewAppsPolicy` uses `Resource: '*'`. This is the one security-scanner
finding in the repo where complying would directly weaken the control: narrowing
it would leave a path by which a held student could start compute. It is marked
as such in the template.

Without `StudentStudioCleanup`, `DeleteStack` lands in `DELETE_FAILED` for any
student who ever opened a notebook.

`PerStudentBudgetUsd` on this stack is **reference only**. The enforced figure
lives in the students table so `PUT /students/{id}/budget` can change a cap
without a stack update.

## Names are load-bearing

The console's IAM is scoped by `ArnLike` conditions on
`AdminBackendFunctionRole` against these literal strings:

```
gpu-guardian-${StudentId}-exec-role
gpu-guardian-${StudentId}-deny-new-apps
gpu-guardian-${StudentId}-stop-app
```

Nothing is wired by `Ref`, because the two stacks are separate. Rename any of
them and enforcement stops targeting anything — **without failing a deploy and
without raising an error**. This is also why every `W28` (explicit resource name)
scanner suppression in the templates is load-bearing rather than cosmetic.

## The console

A Vite + Cloudscape SPA in [app/](../app/), served from S3 behind CloudFront.

- Reads exactly one build-time variable, `NEXT_PUBLIC_API_BASE_URL`. Everything
  else — Cognito coordinates, identity mode, branding — comes from `GET /init`
  at runtime.
- The student surface is three `GET`s. Neither a budget nor a hold can be changed
  from the student portal; that is the design, not a gap, since raising your own
  cap is the one thing this platform exists to prevent.
- Admin sign-in is group membership only. There is no "view as student" — admins
  have no Studio profile of their own, and the portal says so rather than
  offering a retry that must fail.

## Known trade-offs

Collected in one place, each stated where it costs something:

1. **The cap fails silent, not closed.** Self-metering is free and minutes-fast,
   but it stops working if `usage_sync` stops. Watch the alarms.
2. **Enforcement is `SweepMinutes` late.** A student can overshoot by up to one
   sweep of runtime. Cents on a `ml.g5.xlarge`.
3. **`PublicInternetOnly` in a public subnet.** The cheap topology. No NAT, no
   endpoints, no private subnet.
4. **`AuthMode` and `KmsKeyId` are fixed at create time.** Either one chosen wrongly
   means rebuilding the domain and destroying every student's home directory.
   `KmsKeyId` is the harsher of the two: applying the 2026-08-26 revision to an
   already-deployed domain does not replace it, it fails the update and leaves the
   DynamoDB tables stranded on an unusable CMK — read the `# STOP.` block above
   `StudioDomain` first.
5. **Teardown has a manual tail.** The domain's EFS leftovers block VPC deletion
   and CloudFormation cannot clean them up.
6. **Only notebook compute is metered.** Storage is not counted against a
   student's cap.
7. **The sweep's duration, not its frequency, is the scaling limit.** See
   [COSTING.md](COSTING.md) §4.3.
