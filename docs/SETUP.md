# Setup

What must exist before you deploy, and what every parameter does. For the
commands themselves see [DEPLOYMENT.md](DEPLOYMENT.md); for what the money does
see [COSTING.md](COSTING.md); for how the pieces fit together see
[ARCHITECTURE.md](ARCHITECTURE.md).

## What you are setting up

A GPU notebook lab. Each student gets their own SageMaker Studio environment and
a hard dollar cap that is enforced without a human noticing they went over. You
deploy one platform stack; after that students are added from the admin console,
which creates one CloudFormation stack per student.

Two files, and they are not interchangeable:

| File | Deployed by | How often |
|---|---|---|
| `cloudformation/03-Sagemaker-Gpu-Platform-Base.yaml` | you, by hand | once |
| `cloudformation/04-Sagemaker-Gpu-Student.yaml` | the console, on your behalf | once per student |

You never launch 04 yourself in normal use. You do have to **upload** it, along
with the backend handler, before the console can do anything — see
[DEPLOYMENT.md](DEPLOYMENT.md).

## Prerequisites

### 1. An AWS account you are willing to give a Studio domain

The platform creates a VPC (`10.42.0.0/16`) and a SageMaker Studio domain in it.
Both are effectively permanent: `AuthMode` on the domain cannot be changed after
creation, and deleting the domain leaves EFS resources behind that have to be
cleaned up by hand. Do not point this at an account whose default VPC or Studio
domain you care about.

`us-east-1` throughout the examples. Nothing *pins* the region, but two things
depend on it. The rate table the meter prices usage from is published for
`us-east-1`, so spend figures in another region will be a few cents off the real
bill. More importantly, **the WAF in front of the admin console only exists in
us-east-1**: a WAFv2 web ACL with `Scope: CLOUDFRONT` cannot be created anywhere
else, so the template gates it on the region rather than making the whole stack
undeployable. Deploy elsewhere and the stack comes up with the console
unprotected and says nothing about it — check that the `FrontendWebAclArn` output
is not empty. Prefer `us-east-1` unless you have a reason not to.

### 2. IAM Identity Center, already enabled

The stack does not enable Identity Center and cannot. Enable it first, then read
two values off the console's **Settings** page:

- **Instance ARN** — `arn:aws:sso:::instance/ssoins-…`
- **Identity store ID** — `d-…`

And one fact that decides the whole shape of the deployment:

- **Instance type** — the Settings page reads either *Organization instance* or
  *Account instance*.

### 3. Know which identity mode you are in

This is the one decision you cannot walk back, because it sets `AuthMode` on the
Studio domain and `AuthMode` is immutable — changing it replaces the domain and
every UserProfile in it, which means every student's home directory.

| | `IdentityCenterInstanceType=ORGANIZATION` | `IdentityCenterInstanceType=ACCOUNT` |
|---|---|---|
| Studio `AuthMode` | `SSO` | `IAM` |
| Who is the identity source | Identity Center | Cognito |
| How admins sign in | IdC → SAML → Cognito → console | Cognito hosted UI directly |
| How students reach a notebook | the AWS access portal's Studio tile | the console mints a presigned URL |
| Extra resources | student group, admin group, permission set, account assignment, SAML app | none |
| Extra deploy steps | two-pass SAML (below), plus assigning the group to the domain's own IdC application | add your first admin to a Cognito group by hand |

There is no default for `IdentityCenterInstanceType` on purpose. Guessing wrong
fails the deploy part-way through creation, and the failure is not one you can
correct with a stack update.

If Identity Center is an **account** instance, there is no SAML path at all —
the account-instance API does not support creating a customer-managed SAML
application. Everyone, admins and students alike, signs in against Cognito, and
students never see an AWS console.

### 4. A notification address that exists

`NotificationEmail` and `AdminNotificationEmail` both create SNS subscriptions.
SNS sends a confirmation mail and delivers nothing until someone clicks it. If
you skip that, every alert this platform can raise is silently discarded.

`AdminNotificationEmail` is also rendered to unauthenticated callers via
`GET /init`, so use a team alias rather than a person's address.

### 5. Local tooling

`aws` CLI v2, `python3` (the backend handler is compiled locally before upload),
and `node` with `npm` (the console is a Vite build). `cfn-lint` is optional but
both templates are kept clean against it.

## Parameters — platform stack

### Identity Center

| Parameter | Default | Notes |
|---|---|---|
| `IdentityCenterInstanceType` | *none* | `ORGANIZATION` or `ACCOUNT`. See above. No default is deliberate. |
| `IdentityCenterInstanceArn` | `''` | Required under `ORGANIZATION`, ignored under `ACCOUNT`. |
| `IdentityStoreId` | `''` | Required under `ORGANIZATION`, ignored under `ACCOUNT`. |
| `IdcSamlMetadataUrl` | `''` | **Leave empty on the first deploy.** Under `ORGANIZATION` this is the second pass — see below. |

#### The two-pass SAML step (`ORGANIZATION` only)

The SAML federation is circular: Cognito needs the Identity Center
application's metadata, and the Identity Center application needs Cognito's ACS
URL and audience. There is no way to express that in one deploy, so it is two:

1. Deploy with `IdcSamlMetadataUrl=''`. The stack comes up and the Cognito
   hosted UI shows its own username/password form. Note the `SamlAcsUrl` and
   `SamlAudience` outputs.
2. Create a customer-managed SAML application in Identity Center using those two
   values, assign the admin and student groups to it, and copy its metadata URL.
3. Update the stack with `IdcSamlMetadataUrl` set. Sign-in now redirects to
   Identity Center.

Between step 1 and step 3 the console is deployed but nobody can sign in as an
admin, so do not treat pass one as a finished deployment.

### Class-wide cost

| Parameter | Default | Notes |
|---|---|---|
| `ClassPoolCapUsd` | `8000` | Monthly, **notify-only**, across the whole class. It emails; it does not block anybody. `0` disables it. |
| `NotificationEmail` | *none* | Where the class-pool and anomaly notices go. |
| `EnableCostAnomalyMonitor` | `false` | Leave it `false` unless you have checked. See below. |

`EnableCostAnomalyMonitor` defaults to `false` because AWS permits only **one**
`SERVICE`-dimension Cost Anomaly Monitor per account, and creating a second one
fails the whole stack with `AlreadyExists`. Check before enabling:

```bash
aws ce get-anomaly-monitors --query 'AnomalyMonitors[?MonitorDimension==`SERVICE`].MonitorName'
```

Only the class pool is notify-only by design. The per-student cap *does* block,
and that asymmetry is intentional: auto-remediating one student has a blast
radius of one student, whereas locking a whole class out when the shared pool
runs dry is a decision an operator should make deliberately.

### Admin console

| Parameter | Default | Notes |
|---|---|---|
| `AdminNotificationEmail` | *none* | Backend alarms, dead letters, and the support address shown by `GET /init`. Use a team alias. |
| `BackendScriptS3Key` | `scripts/01-admin-platform-api.py` | Where the backend expects to find its own handler in `TemplatesBucket`. |
| `StudentTemplateS3Key` | `templates/04-Sagemaker-Gpu-Student.yaml` | Where the console expects to find the per-student template. |
| `SweepMinutes` | `5` | Metering interval, and therefore the enforcement lag. Min `2`, max `60`. |

`SweepMinutes` has a floor of 2 rather than 1 because EventBridge requires the
singular form `rate(1 minute)` and the template builds `rate(${SweepMinutes}
minutes)`. Lowering it tightens the cap and raises the cost of the sweep itself;
[COSTING.md](COSTING.md) §4.3 has the numbers, and the sweep's own duration —
not its frequency — is what limits how many students this scales to.

### Branding

`AppTitle`, `AppShortName`, `AppLogoUrl`, `AppFaviconUrl`, `AppPrimaryColor`,
`AppInstitutionName`, `AppSupportEmail` — all default to `''`, all served
unauthenticated by `GET /init`, all safe to change with a stack update and no
rebuild. The console fetches them at runtime, so one built bundle works against
any deployment. Empty means "unbranded", which renders as AWS's own name and
marks rather than as a broken page.

## Parameters — per-student stack

The console fills all of these in for you. They matter when you are reading a
student's stack, or launching one by hand to debug.

| Parameter | Default | Notes |
|---|---|---|
| `ExistingDomainId` | *none* | The platform's `StudioDomainId` output. This template never creates a domain. |
| `DomainAuthMode` | *none* | `SSO` or `IAM`. **Must match the domain** — a UserProfile may carry `SingleSignOnUserIdentifier` only under `SSO`, and must not under `IAM`. |
| `StudentId` | `demo-student-01` | Also the suffix of every resource name for this student, and under `SSO` it must match their Identity Center username. |
| `InstanceType` | `ml.t3.medium` | `ml.t3.medium`, `ml.g4dn.xlarge`, `ml.g5.xlarge`, `ml.g6.xlarge`. This `AllowedValues` list **is** the tier control — there is no other check on what a student may ask for. |
| `PerStudentBudgetUsd` | `80` | Reference only. The enforced figure lives in the students table so a cap can be raised without a stack update. |
| `NotificationEmail` | *none* | Per-student notices. |
| `StorageKmsKeyArn` | `''` | `PlatformKey`'s ARN, from `/gpu-guardian-admin/storage-kms-key-arn`. Grants this student's execution role use of the key. **Empty means no notebook will start** — the grant is wrapped in a condition, so the stack still reaches `CREATE_COMPLETE` and the failure only appears when the student opens a Space. Must be the ARN; an alias does not match. See [DEPLOYMENT.md](DEPLOYMENT.md#notebooks-will-not-start). |

## What you cannot change later

Worth reading once before the first deploy, because each of these means a
rebuild rather than an update:

- **`IdentityCenterInstanceType`** — sets the domain's `AuthMode`, which is
  immutable. Replacing the domain destroys every student's home directory.
- **`KmsKeyId` on the Studio domain** — set from `PlatformKey`, and **create-only**
  rather than merely immutable. It was added to the template on 2026-08-26, so if
  your domain predates that revision the stack update does not just replace the
  domain, it **fails outright**: CloudFormation creates the replacement before
  deleting the original, so it collides with the live domain on `DomainName` and
  returns `AlreadyExists`. The rollback then leaves the three DynamoDB tables on a
  CMK the backend role cannot decrypt, because SSE changes do not roll back — a
  broken deployment, not a lost one. Run `aws cloudformation create-change-set
  --no-execute` and read the `Replacement` column before executing; it will say
  `True`, which here means "will fail". Your only options are to tear down and
  redeploy, or to comment the property out and accept `CKV_AWS_187`. A fresh
  deploy is unaffected.
- **`PlatformKey` itself** — deleting the key makes the three DynamoDB tables
  unreadable, their point-in-time restores useless, and the domain's home EFS
  unrecoverable. Its deletion window is set to 30 days so a mistake can be undone
  with `aws kms cancel-key-deletion`.
- **The VPC CIDR and subnet layout** — hard-coded, and the domain's EFS mount
  target lives in the subnet.
- **Per-student resource names** — `gpu-guardian-${StudentId}-exec-role`,
  `-deny-new-apps`, `-stop-app`. The console's IAM is scoped to these literal
  strings by `ArnLike` conditions across a stack boundary. Renaming any of them
  does not fail a deploy; it just stops enforcement working.

## What this does not protect against

Stated plainly so nobody discovers it during a billing cycle:

- The cap is **self-metered**, so it fails *silent*, not closed. If the
  `usage_sync` rule is disabled or the backend is broken, notebooks keep running
  and nothing stops them. This is what the three CloudWatch alarms on the
  backend exist to tell you about — subscribe to them and mean it.
- Enforcement is **minutes late** by construction: a student can overshoot their
  cap by up to `SweepMinutes` of runtime. On a `ml.g5.xlarge` that is cents, not
  dollars. See [COSTING.md](COSTING.md) §4.2.
- Only **notebook compute** is metered. Storage is not counted against a
  student's cap.
