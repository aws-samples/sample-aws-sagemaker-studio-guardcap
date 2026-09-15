# Deployment and operations

Deploy, run and tear down SageMaker GPU Guardian. Read
[SETUP.md](SETUP.md) first — it covers the prerequisites and every parameter,
and one of those decisions (`IdentityCenterInstanceType`) cannot be reversed
after the first deploy.

Examples use `us-east-1` and a stack named `gpu-guardian`. Set both once:

```bash
export AWS_REGION=us-east-1
export STACK=gpu-guardian
```

`gpu-guardian` is only this document's example. **Before running anything against
an existing deployment, confirm `$STACK` is the stack you mean** — set it to your
own name if it differs. Pointing an update at the wrong stack does not fail
cleanly: CloudFormation sees this template's named IAM roles, buckets and
functions already existing under a different stack and reports "attempting to
import some resources because they already exist … must have the DeletionPolicy
attribute set to 'Retain'", which reads like a template bug rather than a typo.

```bash
aws cloudformation describe-stacks --region "$AWS_REGION" \
  --query 'Stacks[?contains(StackName,`gpu`)].[StackName,StackStatus,CreationTime]' --output table
```

## Order of operations

```
0. Enable Identity Center, read its instance ARN / store ID / instance type
1. Deploy the platform stack
2. Upload the two S3 artifacts       <- the console does nothing until this is done
3. Build and upload the console
4. Bootstrap the first admin
5. (ORGANIZATION only) second SAML pass, and the domain application assignment
6. Add students from the console
```

Steps 2 and 3 are not optional extras. The platform template deliberately does
not carry the backend handler or the per-student template inside itself, so a
freshly deployed stack has a working API Gateway in front of a Lambda that
cannot find its own code.

## Step 1 — deploy the platform stack

> **Updating an existing platform stack rather than creating one?** Read
> [SETUP.md — what you cannot change later](SETUP.md#what-you-cannot-change-later)
> first. The 2026-08-26 revision added `KmsKeyId` to the Studio domain, which is a
> **create-only** property. A change set will report `Replacement: True`, but the
> replacement cannot execute at all: CloudFormation creates before it deletes, so
> the new domain collides with the live one on `DomainName` and the update fails
> with `AlreadyExists` — then rolls back, leaving the DynamoDB tables on a CMK the
> backend role can no longer decrypt, because SSE changes do not roll back. Either
> tear down and redeploy, or comment the property out. Use
> `create-change-set --no-execute` and read the `Replacement` column before you
> execute anything:
>
> ```bash
> aws cloudformation create-change-set \
>   --stack-name "$STACK" --change-set-name pre-check \
>   --template-body "file://cloudformation/03-Sagemaker-Gpu-Platform-Base.yaml" \
>   --capabilities CAPABILITY_NAMED_IAM --region "$AWS_REGION"
> aws cloudformation describe-change-set \
>   --stack-name "$STACK" --change-set-name pre-check --region "$AWS_REGION" \
>   --query 'Changes[].ResourceChange.[LogicalResourceId,Action,Replacement]' --output table
> ```
>
> A first-time deploy is unaffected.

**The template must be staged in S3 first.** It is roughly 145 KB, and
CloudFormation caps a template passed inline — `--template-body` or
`aws cloudformation deploy --template-file` without `--s3-bucket` — at 51,200
bytes. Passing it directly fails with a `ValidationError` that quotes the whole
template back at you, which is not an obvious error message. Any bucket in the
region will do; CloudFormation's own `cf-templates-*` bucket already exists in
most accounts.

```bash
TEMPLATE_BUCKET=cf-templates-EXAMPLE-us-east-1   # any bucket you can write to

aws s3 cp cloudformation/03-Sagemaker-Gpu-Platform-Base.yaml \
  "s3://$TEMPLATE_BUCKET/gpu-guardian/03-Sagemaker-Gpu-Platform-Base.yaml" \
  --region "$AWS_REGION"

aws cloudformation create-stack \
  --stack-name "$STACK" \
  --template-url "https://$TEMPLATE_BUCKET.s3.$AWS_REGION.amazonaws.com/gpu-guardian/03-Sagemaker-Gpu-Platform-Base.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
      ParameterKey=IdentityCenterInstanceType,ParameterValue=ACCOUNT \
      ParameterKey=NotificationEmail,ParameterValue=lab-ops@example.com \
      ParameterKey=AdminNotificationEmail,ParameterValue=lab-ops@example.com \
      ParameterKey=ClassPoolCapUsd,ParameterValue=8000 \
      ParameterKey=SweepMinutes,ParameterValue=5 \
  --region "$AWS_REGION"
```

Only three parameters have no default and must always be supplied:
`IdentityCenterInstanceType`, `NotificationEmail` and `AdminNotificationEmail`.

For a repeat deploy, keep the parameter set in a JSON file and pass
`--parameters file://params.json`. Keep that file **outside the repository** — it
holds real email addresses and, if you set the `App*` branding parameters, your
institution's name.

Under `ORGANIZATION` add `IdentityCenterInstanceArn` and `IdentityStoreId`, and
leave `IdcSamlMetadataUrl` unset for now.

Allow 10–15 minutes; the Studio domain and the CloudFront distribution are the
slow parts. **Confirm the SNS subscription emails** when they arrive — until
someone clicks, every alert this platform can raise is discarded.

Then keep the outputs to hand:

```bash
aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
```

The ones you will use below: `TemplatesBucketName`, `ApiUrl`, `FrontendUrl`,
`FrontendBucketName`, `FrontendDistributionId`, `CognitoUserPoolId`,
`SignInUrl`, `AdminBackendFunctionArn`, `StudioDomainId`, `StudentGroupId`,
`SamlAcsUrl`, `SamlAudience`.

## Step 2 — upload the two S3 artifacts

Both go into `TemplatesBucket` at the keys the stack was deployed with. Read the
bucket and the keys from the stack rather than assuming the defaults, since
either key can be overridden at create time:

```bash
BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='TemplatesBucketName'].OutputValue" --output text)

BACKEND_KEY=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Parameters[?ParameterKey=='BackendScriptS3Key'].ParameterValue" --output text)

TEMPLATE_KEY=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Parameters[?ParameterKey=='StudentTemplateS3Key'].ParameterValue" --output text)
```

### The backend handler

The Lambda's inline code is a ~40-line loader, because CloudFormation caps
inline `ZipFile` at 4096 characters and the real handler is ~2400 lines. The
loader fetches this object from S3 on cold start and caches it in a module
global. So uploading the handler **is** a code deploy — no stack update needed.

Compile it locally first. A handler that will not import takes the whole API
down, and the loader has no way to fall back:

```bash
python3 -m py_compile scripts/01-admin-platform-api.py
aws s3 cp scripts/01-admin-platform-api.py "s3://$BUCKET/$BACKEND_KEY" --region "$AWS_REGION"
```

A warm container keeps the old module cached, so force a new execution
environment. Touching the description does that without changing behaviour, and
a later stack update simply overwrites it:

```bash
FUNCTION=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='AdminBackendFunctionArn'].OutputValue" --output text)

aws lambda update-function-configuration \
  --function-name "${FUNCTION##*:}" --region "$AWS_REGION" \
  --description "handler $(sha256sum scripts/01-admin-platform-api.py | cut -c1-12) uploaded $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Skip the cold start and you will spend a confusing few minutes watching a fix
you definitely uploaded fail to take effect.

### The per-student template

The stack already wrote this object's URL into
`/gpu-guardian-admin/template-s3-url` at create time, so putting the object at
the key is the whole bootstrap step:

```bash
aws cloudformation validate-template \
  --template-body "file://cloudformation/04-Sagemaker-Gpu-Student.yaml" --region "$AWS_REGION" >/dev/null
aws s3 cp cloudformation/04-Sagemaker-Gpu-Student.yaml "s3://$BUCKET/$TEMPLATE_KEY" --region "$AWS_REGION"

# Sanity check: the SSM parameter must end in the key you just uploaded.
aws ssm get-parameter --name /gpu-guardian-admin/template-s3-url \
  --region "$AWS_REGION" --query 'Parameter.Value' --output text
```

Re-upload this file after **any** edit to the student template. The console
reads it fresh on every provision, so there is no cache to bust — but equally,
an old object means every new student is created from the old template.

## Step 3 — build and upload the console

The console is a Vite + Cloudscape SPA in [app/](../app/). Exactly one
build-time variable matters:

```bash
API_URL=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)

cat > app/.env.production.local <<ENV
# Generated from stack $STACK ($AWS_REGION). Edit the stack, not this file.
NEXT_PUBLIC_API_BASE_URL=$API_URL
ENV
```

`.env.production.local` rather than `.env.local`, because it outranks it for
`vite build` and so leaves any existing `.env.local` — pointing at some other
account's stack — untouched instead of silently repointing it.

Everything else the app needs (Cognito domain, client id, identity mode,
branding) is fetched at runtime from `GET /init`, which is why one built bundle
works against any deployment and why re-branding needs a stack update rather
than a rebuild.

```bash
( cd app && npm ci && npm run typecheck && npm run build )

FRONTEND_BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" --output text)
DISTRIBUTION=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendDistributionId'].OutputValue" --output text)

aws s3 sync app/dist/ "s3://$FRONTEND_BUCKET/" --delete --region "$AWS_REGION"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths '/*'
```

`--delete` is safe here and only here: the stack owns that bucket exclusively.
The invalidation is required, not tidy — CloudFront will otherwise keep serving
the previous `index.html` and its now-deleted asset hashes.

## Step 4 — bootstrap the first admin

Nothing in the stack creates a human. Under `ACCOUNT` mode Cognito is the
identity source, so make yourself an admin by hand:

```bash
POOL=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue" --output text)

aws cognito-idp admin-create-user \
  --user-pool-id "$POOL" --username you@example.com \
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
  --region "$AWS_REGION"

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$POOL" --username you@example.com \
  --group-name gpu-guardian-admins --region "$AWS_REGION"
```

Cognito emails a temporary password. Sign in at the `FrontendUrl` output.

Group membership is the *only* thing that makes someone an admin —
`gpu-guardian-admins` for the console, `gpu-guardian-students` for the student
portal. Under `ORGANIZATION` mode both come from Identity Center group
membership propagated through SAML instead, and you add people to the IdC groups
rather than to Cognito.

## Step 5 — `ORGANIZATION` mode only

Skip this entire section under `ACCOUNT` mode. There is no SAML application and
no access portal; students reach their notebooks through a presigned URL the
console mints for them.

### 5a. The second SAML pass

Read the two values the Identity Center application needs:

```bash
aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='SamlAcsUrl'||OutputKey=='SamlAudience'].[OutputKey,OutputValue]" \
  --output table
```

In the Identity Center console, create a customer-managed SAML 2.0 application
with that ACS URL and audience, assign the `SageMaker-GPU-Guardian-Admins` and
student groups to it, and copy its metadata URL. Then update the stack:

```bash
aws cloudformation deploy \
  --template-file cloudformation/03-Sagemaker-Gpu-Platform-Base.yaml \
  --stack-name "$STACK" --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides IdcSamlMetadataUrl=https://portal.sso.../metadata \
  --region "$AWS_REGION"
```

Naming a Cognito identity provider that does not exist gets you a flat "Login
option is not available" from the hosted UI, so do not set this before the
application exists.

### 5b. Assign the student group to the domain's own IdC application

Seeing the AWS account tile in the access portal is not the same as seeing the
Studio tile. The template's `AWS::SSO::Assignment` grants account access via the
permission set. Separately, **every `AuthMode: SSO` SageMaker domain registers
its own Identity Center application**, and a group must be assigned to *that*
application too or the Studio tile never appears.

There is no CloudFormation resource for this — AWS documents it as console/CLI
only — so it is a required manual step after every platform deploy:

```bash
DOMAIN_ID=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='StudioDomainId'].OutputValue" --output text)
GROUP_ID=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='StudentGroupId'].OutputValue" --output text)

APP_ARN=$(aws sagemaker describe-domain --domain-id "$DOMAIN_ID" --region "$AWS_REGION" \
  --query 'SingleSignOnApplicationArn' --output text)

aws sso-admin create-application-assignment \
  --application-arn "$APP_ARN" \
  --principal-id "$GROUP_ID" --principal-type GROUP \
  --region "$AWS_REGION"
```

Once per platform deploy, not once per student — it is the *group* that is
assigned, so new students only need group membership.

## Step 6 — add students

From the console: **Students → Add student**. That single action creates a
CloudFormation stack from the uploaded template, under the deploy role the
platform published, and writes the student's row into the students table. The
`stack_status_sync` job polls every 5 minutes and moves the row from
`PROVISIONING` to `ACTIVE` or `PROVISION_FAILED`.

Under `ORGANIZATION` mode the student must already exist in Identity Center and
their `StudentId` must match their IdC username, or the UserProfile is created
pointing at nobody.

To launch a student stack by hand for debugging, both domain values must come
from the platform stack and `DomainAuthMode` must match, or the UserProfile is
rejected:

```bash
aws cloudformation deploy \
  --template-file cloudformation/04-Sagemaker-Gpu-Student.yaml \
  --stack-name "gpu-guardian-student-demo-01" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      ExistingDomainId="$DOMAIN_ID" \
      DomainAuthMode=IAM \
      StudentId=demo-01 \
      InstanceType=ml.t3.medium \
      PerStudentBudgetUsd=80 \
      NotificationEmail=lab-ops@example.com \
  --region "$AWS_REGION"
```

A stack created this way has no row in the students table, so it is **not
metered and not capped**. Delete it when you are done debugging.

## Day-2 operations

### Changing a cap

`PUT /students/{studentId}/budget`, from the console. The enforced figure lives
in the students table, not in the student's stack, so a cap change takes effect
at the next sweep with no stack update. The stack's `PerStudentBudgetUsd`
parameter records only what the student was created with.

### Suspending and resuming

`POST /students/{studentId}/suspend` attaches the deny policy and stops the
student's running apps immediately, exactly as a budget breach does. Resume
detaches it. Files are untouched either way — the hold blocks new apps and stops
running ones; it does not delete anything.

### Why a held student comes back on the 1st

The monthly reset is structural, not scheduled. Spend is read from a
`PERIOD#<YYYY-MM>` ledger row, so on the 1st that row simply does not exist yet
and everyone is at zero. The hourly `period_rollover` job exists only to
*detach* deny policies left over from last month, and only where the hold was a
budget hold — an admin's manual suspension survives the month boundary, which is
the point of distinguishing the two.

### Checking the meter is actually running

The cap fails **silent**, not closed. If `usage_sync` stops, notebooks keep
running and nothing stops them. So this is the check worth having a habit about:

```bash
# The rule must be ENABLED.
aws events describe-rule --name gpu-guardian-admin-usage-sync --region "$AWS_REGION" \
  --query '[State,ScheduleExpression]' --output text

# Recent invocations, and whether any failed.
aws cloudwatch get-metric-statistics --namespace AWS/Lambda \
  --metric-name Errors --dimensions Name=FunctionName,Value=gpu-guardian-admin-backend \
  --start-time "$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 3600 --statistics Sum --region "$AWS_REGION" --output table
```

Three alarms already watch this and publish to `AdminAlertsTopic`:
`-backend-errors` (any error in 5 minutes, and `TreatMissingData: breaching`, so
silence is also an alarm), `-backend-throttles`, and `-backend-duration` at
90 s — 75% of the 120 s timeout, which is the early warning that the sweep is
outgrowing its window.

### Logs

| Log group | Retention | What is in it |
|---|---|---|
| `/gpu-guardian/consumption` | 365 days | Metering and enforcement decisions |
| `/aws/lambda/gpu-guardian-admin-backend` | 90 days | Handler output, including tracebacks |
| `/gpu-guardian/api-access` | 365 days | API access log, with `jwtSub` per request (no email — see ARCHITECTURE §10) |

All three are `RetainExceptOnCreate` — deleting the stack does not delete the
audit trail.

Access logs are not in CloudWatch. They land in
`s3://gpu-guardian-admin-logs-<account-id>/` under four prefixes —
`s3-access-logs/templates/`, `s3-access-logs/frontend/`, `s3-access-logs/logs/`
and `cloudfront/` — and expire after 90 days. Both kinds of delivery are
best-effort and lag by minutes to hours, so an empty prefix shortly after a
request is expected, not a fault. Unlike the log groups, this bucket **is**
deleted with the stack.

### Updating the backend

Re-upload and force a cold start, exactly as in step 2. No stack update. Roll
back by re-uploading the previous file the same way; the description field
records which SHA is live.

## Teardown

Order matters, and there is a manual tail CloudFormation cannot do for you.

### 1. Delete every student stack first

Terminate each student from the console, which deletes their stack, or delete
the stacks directly. SageMaker refuses to delete a domain that still has
UserProfiles attached, and the platform stack owns the domain.

The per-student stacks contain a cleanup custom resource that stops apps, waits
for them to reach `Deleted`, deletes Spaces and waits again. That is why a
student delete takes a few minutes rather than seconds — and why it succeeds at
all. Without it, `DeleteStack` lands in `DELETE_FAILED` for any student who ever
opened a notebook.

### 2. Clean up what the Studio domain leaves behind

**Required on every teardown**, not occasional. There is no CloudFormation
property that changes this:

- Deleting the domain always leaves its home EFS filesystem and mount-target ENI
  behind. `RetentionPolicy` is a raw `DeleteDomain` API parameter, not a
  CloudFormation resource property — setting it in the template fails early
  validation.
- SageMaker also creates two security groups through its own API
  (`security-group-for-inbound-nfs-*` / `-outbound-nfs-*`). CloudFormation never
  created them, so it never deletes them.

All of them silently block the subnet and the VPC from deleting: `delete-stack`
sits in `DELETE_IN_PROGRESS` and eventually fails with `DependencyViolation`.

```bash
VPC_ID=$(aws cloudformation describe-stack-resource --stack-name "$STACK" \
  --logical-resource-id Vpc --region "$AWS_REGION" \
  --query 'StackResourceDetail.PhysicalResourceId' --output text)
SUBNET_ID=$(aws cloudformation describe-stack-resource --stack-name "$STACK" \
  --logical-resource-id PublicSubnet --region "$AWS_REGION" \
  --query 'StackResourceDetail.PhysicalResourceId' --output text)

# 1. Delete the domain's leftover EFS mount target, then its filesystem. Both
#    ids are discoverable from the ENI's own description.
ENI_DESC=$(aws ec2 describe-network-interfaces --region "$AWS_REGION" \
  --filters "Name=subnet-id,Values=$SUBNET_ID" "Name=interface-type,Values=efs" \
  --query 'NetworkInterfaces[0].Description' --output text)
if [ "$ENI_DESC" != "None" ]; then
  FS_ID=$(echo "$ENI_DESC" | grep -oE 'fs-[0-9a-f]+')
  MT_ID=$(echo "$ENI_DESC" | grep -oE 'fsmt-[0-9a-f]+')
  aws efs delete-mount-target --mount-target-id "$MT_ID" --region "$AWS_REGION"
  while aws efs describe-mount-targets --file-system-id "$FS_ID" --region "$AWS_REGION" 2>/dev/null | grep -q "$MT_ID"; do
    sleep 5
  done
  aws efs delete-file-system --file-system-id "$FS_ID" --region "$AWS_REGION"
fi

# 2. Revoke the two auto-created NFS security groups' rules before deleting
#    them: they reference each other, so neither deletes until both are cleared.
for SG in $(aws ec2 describe-security-groups --region "$AWS_REGION" \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=security-group-for-*-nfs-*" \
    --query 'SecurityGroups[].GroupId' --output text); do
  INGRESS=$(aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$SG" \
    --query 'SecurityGroups[0].IpPermissions' --output json)
  [ "$INGRESS" != "[]" ] && aws ec2 revoke-security-group-ingress --region "$AWS_REGION" \
    --group-id "$SG" --ip-permissions "$INGRESS"
  EGRESS=$(aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$SG" \
    --query 'SecurityGroups[0].IpPermissionsEgress' --output json)
  [ "$EGRESS" != "[]" ] && aws ec2 revoke-security-group-egress --region "$AWS_REGION" \
    --group-id "$SG" --ip-permissions "$EGRESS"
done
for SG in $(aws ec2 describe-security-groups --region "$AWS_REGION" \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=security-group-for-*-nfs-*" \
    --query 'SecurityGroups[].GroupId' --output text); do
  aws ec2 delete-security-group --region "$AWS_REGION" --group-id "$SG"
done
```

Read the `describe-*` output before running the deletes if this account holds
anything else — the filters are scoped to this stack's VPC and subnet, but a
misread `$STACK` would scope them to someone else's.

### 3. Delete the platform stack

```bash
aws cloudformation delete-stack --stack-name "$STACK" --region "$AWS_REGION"
aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$AWS_REGION"
```

If a delete is **already** stuck — `DELETE_IN_PROGRESS` for several minutes with
no new events, or `DELETE_FAILED` on `PublicSubnet` or `Vpc` — run the step 2
cleanup and call `delete-stack` again. CloudFormation resumes and finishes within
seconds once the ENI and the security groups are gone.

### What survives on purpose — and blocks the next deploy

The four platform log groups (`RetainExceptOnCreate` / `UpdateReplacePolicy:
Retain`), so the record of what was spent and who was cut off outlives the
platform. Student stacks leave a `…-studio-cleanup` group behind by the same rule.

**You must delete them before deploying again.** `DeletionPolicy` governs deletion
only — it does *not* let a later stack adopt a group that already exists, which
needs an explicit IMPORT change set. A plain `create-stack` into an account that
still has them fails before creating anything:

```
The following hook(s)/validation failed: [AWS::EarlyValidation::ResourceExistenceCheck]
```

Verified against a real account on 2026-08-26. Copy anything you need out first —
`/gpu-guardian/consumption` is the evidence behind every suspension — then:

```bash
for LG in $(aws logs describe-log-groups --region "$AWS_REGION" \
    --query 'logGroups[?contains(logGroupName,`gpu-guardian`)].logGroupName' --output text); do
  echo "deleting $LG"
  aws logs delete-log-group --log-group-name "$LG" --region "$AWS_REGION"
done
```

Read the list before running the loop; it matches on the name substring, not on
stack ownership.

### What does not, and is worth a thought first

- **`LogsBucket`** — the S3 and CloudFront access logs are deleted along with the
  buckets they describe. If those logs are evidence for anyone, change the bucket's
  `DeletionPolicy` to `Retain` and remove `LogsBucketCleanup` before tearing down.
- **`PlatformKey`** — CloudFormation *schedules* its deletion rather than deleting
  it, with a 30-day window. Within that window,
  `aws kms cancel-key-deletion --key-id alias/gpu-guardian` makes any surviving
  DynamoDB backup or EFS snapshot readable again. After it, they are permanently
  unreadable.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Every API call returns 500 | The backend handler is not in S3 at `BackendScriptS3Key`, or does not import. Check `/aws/lambda/gpu-guardian-admin-backend`. |
| Adding a student fails immediately | The per-student template is not at `StudentTemplateS3Key`, or the SSM URL points elsewhere. |
| A backend fix has no effect | Warm container, old module. Force a cold start. |
| "Login option is not available" | `IdcSamlMetadataUrl` names a provider the pool does not have, or the IdC application was never created. |
| Console loads unbranded and asks for a local password when you expected SSO | `GET /init` is unreachable, so the app fell back to its defaults. Check `ApiUrl` and the `NEXT_PUBLIC_API_BASE_URL` the bundle was built with. |
| A student sees the account tile but no Studio tile | Step 5b was skipped. |
| Student stack `DELETE_FAILED` | Apps or Spaces still present, and the cleanup resource failed. Delete the apps by hand, then retry. |
| Platform stack delete hangs on the subnet or VPC | The EFS/NFS leftovers. Run the step 2 cleanup. |
| Spend never updates | `usage_sync` is disabled or erroring. Nothing is capped while this is true. |
| Stack fails on `CostAnomalyMonitor` with `AlreadyExists` | The account already has a `SERVICE`-dimension monitor. Deploy with `EnableCostAnomalyMonitor=false`. |
| `PermissionError: Unable to create EBS volume for Space … permissions to use the KMS key` | The execution role has no usable grant on `PlatformKey`. See below. |
| A student you deleted can never be re-added — their stack dies on `StudentStudioCleanupLogGroup`, `"The specified log group already exists"` | A log group orphaned by a previous teardown. See below. |

### Notebooks will not start

Opening a Space fails with `PermissionError: Unable to create EBS volume for Space …
because you don't have permissions to use the KMS key`. Three things make this harder
to diagnose than it looks, and all three have happened here:

1. **Read the principal from CloudTrail, not from the Space.** A Space created from a
   student's presigned URL reports `OwnerUserProfileName: null`, which invites the
   conclusion that it runs as the domain's default role. It does not — SageMaker acts
   as *that user profile's* execution role, the per-student one. Find the real
   principal in the failing `CreateGrant` event:

   ```bash
   aws cloudtrail lookup-events \
     --lookup-attributes AttributeKey=EventName,AttributeValue=CreateGrant \
     --max-results 10 \
     --query 'Events[].CloudTrailEvent' --output text \
     | python3 -c 'import sys,json; [print(json.loads(l).get("userIdentity",{}).get("arn"), json.loads(l).get("errorCode","")) for l in sys.stdin]'
   ```

   The domain default role is **not** a fallback that covers a student, so fixing it
   alone changes nothing.

2. **Do not add a condition to `kms:CreateGrant`.** `Bool:
   kms:GrantIsForAWSResource: true` reads like free hardening and instead denies Space
   creation: it is not satisfied on the `CreateGrant` SageMaker issues for the volume,
   so notebooks keep failing with this identical error while the policy reads as
   correct. `kms:ViaService` is not a substitute either — the call reaches KMS through
   both SageMaker and EC2. What bounds the unconditional grant is the trust policy:
   both roles are assumable only by `sagemaker.amazonaws.com`.

3. **An empty `StorageKmsKeyArn` fails silently.** The per-student statements are
   wrapped in `Condition: HasStorageKmsKey`, so if the backend does not pass the ARN
   the whole block disappears and the stack still reaches `CREATE_COMPLETE`. The
   student's Space is simply left in `Failed`. Check the parameter reached the stack:

   ```bash
   aws ssm get-parameter --name /gpu-guardian-admin/storage-kms-key-arn --query 'Parameter.Value' --output text
   aws iam get-role-policy --role-name gpu-guardian-<id>-exec-role \
     --policy-name MinimalStudioLogging \
     --query 'PolicyDocument.Statement[?Sid==`UseStorageEncryptionKey`]'
   ```

   Note the policy name is `MinimalStudioLogging`, not the logical id. The `Resource`
   must be the key **ARN** — an alias does not match. Students provisioned before this
   grant existed keep their old role and need a stack update to pick it up.

### A deleted student cannot be re-added

Their stack fails at `StudentStudioCleanupLogGroup` with `"The specified log group
already exists"`. This reads like leftover state from a botched teardown, but the
teardown creates it: with no dependency between them, CloudFormation deletes the log
group *while* the cleanup function is still running its custom-resource `Delete`, and
Lambda re-creates it implicitly on the next line it writes — leaving a group no stack
owns. It was never a `DeletionPolicy: Retain` problem.

Both function/log-group pairs declare that dependency. As of 2026-09-03 it comes from
the `Ref` in each function's `LoggingConfig` rather than an explicit `DependsOn` — the
two are equivalent to CloudFormation, which deletes in reverse dependency order either
way, and cfn-lint flags carrying both as `W3005`. So **do not remove `LoggingConfig` to
tidy the template**: it is what keeps the group's deletion after the function's, and the
symptom of losing it appears one teardown later, on a re-add.

For a student stranded by a teardown from before that fix, delete the orphan and retry:

```bash
aws logs delete-log-group --log-group-name /aws/lambda/gpu-guardian-<id>-studio-cleanup
aws logs delete-log-group --log-group-name /aws/lambda/gpu-guardian-<id>-stop-app
```
