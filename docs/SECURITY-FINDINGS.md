# Security Findings — Disposition

Every scanner finding raised against this repository, what happened to it, and
why. Six scans are on record; the raw exports are held outside this repository.
The dispositions themselves are inline in the templates, which is what makes them
checkable — see "Where the dispositions actually live" below.

**Headline:** the current state is **zero unsuppressed cfn_nag or checkov
findings** — every one is either fixed or carries an inline suppression with a
written reason. `semgrep` warnings in the console SPA are dispositioned in
[QUALITY-FINDINGS.md](QUALITY-FINDINGS.md). Scan 6 added a third IaC scanner,
**cfn-guard**, which reads no `Metadata` suppressions and so cannot be quieted from
inside the templates. All 26 of its findings are `LOW`. Six were fixed (§8); the
remaining 20 are accepted in §7, §15, and §16–§19, and will come back on every
cfn-guard run by design — the list to check them against is at the end of this file.

**Read the severity column carefully.** Scans 1–3 produced `0 CRITICAL`, `0 HIGH`,
`0 ERROR`. Scans 4 and 5 ran a different pipeline that reports every rule hit at
`HIGH` and — importantly — **does not read `Metadata` suppressions**, so most of
what they reported was resources already dispositioned here. A `HIGH` from that
pipeline is a rule id to look up in this file, not a severity assessment.

**Scan 5 changed the disposition of seven findings.** Faced with a report that
would never come back clean, the accepted-with-reason position on four rule
classes was revisited and they were fixed instead: `CKV_AWS_187` and
`CKV_AWS_119` ×3 (a customer-managed key, §2 and §11), `CKV_AWS_86` and
`CKV_AWS_18` ×2 (access logging, §9), and `CKV_AWS_111` (Identity Store scoping,
§3 — where the original reason turned out to be factually wrong). One finding,
`CKV_AWS_174`, remains accepted: it is not fixable without a custom domain (§15).
The KMS fix is not free — see §2 before deploying it to a live domain.

**Scan 6 changed the disposition of one class and fixed two content findings.**
`W41` / `S3_DEFAULT_ENCRYPTION_KMS` moved from accepted to fixed — an explicit
`BucketEncryption` block on all three buckets, and the three `W41` suppressions
deleted with it (§8). The two content findings were a caret-ranged `app/package.json`
and an unsourced percentage in `docs/cost-summary.html`, both fixed. Nothing else
in scan 6 was new.

## Scan history

| # | Date | Findings | Scanners | What it covered |
|---|---|---|---|---|
| 1 | 2026-08-25 | **230** | cfn_nag 86 W, checkov 59 W, semgrep 83 W + 2 I | Four templates, including `01-Sagemaker-Gpu-Platform.yaml` and `02-Sagemaker-Gpu-Admin.yaml`, both since deleted |
| 2 | 2026-08-26 | **88** | cfn_nag 3 W, semgrep 83 W + 2 I | After the remediation pass (commit `2f7363a`). Two templates. |
| 3 | 2026-08-26 | **85** | semgrep 83 W + 2 I | After the last three cfn_nag findings were suppressed. **Zero IaC findings.** |
| 4 | 2026-08-26 | **11** | checkov 9, cfn-guard 1, content rubric 1 — all reported `HIGH` | Platform template + documentation. Nine were already-suppressed resources re-reported because this pipeline ignores `Metadata` suppressions; the two real ones (§13, §14) are fixed. |
| 5 | 2026-08-26 | **9** | checkov 9 — all reported `HIGH` | Same pipeline, re-run after scan 4's fixes. The same nine suppressed resources, at line numbers shifted by scan 4's edits. Seven were re-dispositioned as fixed rather than accepted; `CKV_AWS_174` remains accepted (§15). |
| 6 | 2026-08-27 | **29** | cfn-guard 26 LOW, checkov 1 HIGH (suppressed, not counted against us), content rubric 2 MEDIUM | Holmes CSR rubric v3 + `HolmesContentSecurityReviewBaselinePolicy` v3 over 107 files — both templates, the backend, all of `docs/`, and the console SPA. First scan to run cfn-guard. Six of the 26 were fixed (§8); the other 20 are accepted in §7 and §15–§19. Both rubric findings fixed. Scan `bdf8587d-2947-471e-ae63-71b6cd234bfb`. |
| 7 | 2026-09-03 | **22** | cfn-guard 20 LOW, checkov 1 HIGH (suppressed), content rubric 1 MEDIUM | Same rubric and baseline, 102 files, after the WAF and the security advisor's fixes. The 20 LOWs are the same six classes as scan 6 (§7, §15–§19). The MEDIUM was new and real: the API access log format wrote the caller's email address into a group retained 365 days. Fixed — `jwtSub` only. Scan `7bddae74-1e7c-44e4-89b0-0ba6028884f7`. |
| 8 | 2026-09-03 | **22** | cfn-guard 20 LOW, checkov 1 HIGH (suppressed), content rubric 1 MEDIUM | Re-run after scan 7's fix. The email finding is gone; a different MEDIUM surfaced in its place, on the `kms:*`-to-root statement in `PlatformKey`'s key policy — a request for a comment explaining that the default root statement is a ceiling delegating to IAM, not a grant. Documented, no behaviour change. Scan `ac6af262-311c-4a79-afe5-021afa39968d`. |
| 9 | 2026-09-03 | **2** | semgrep 2 W | Probe scan `86821b8b-1ad8-4ea7-ae85-8f40fa183e19`, run by the security advisor. Both are `jsx-not-internationalized` — the residue of the 83 the caveat below predicted would fall to single digits. Accepted: the console is English-only by design. |

The 230 → 88 → 85 reduction across the first three scans is remediation plus the
deletion of the two superseded templates, not a severity reclassification. Scans 4
and 5 are not comparable to the others: a different ruleset, a different severity
convention, and no suppression awareness. Their counts did not fall between the two
runs precisely *because* the first pipeline reports suppressed findings — the fixes
that followed scan 5 are what will move it.

Local `checkov -d cloudformation` on the current templates: **0 failed, 21
skipped**. `cfn-lint` on both: two `W1030`s, both of which are the linter
comparing an empty parameter default against a pattern it only matches when the
parameter is set.

**The caveat that used to sit here is now settled.** Commit `dd2f794` added 77
`nosemgrep: jsx-not-internationalized` markers to the SPA *after* scan 3 was exported,
so no scan on record reflected it and the "85 → 8" figure was a prediction. Scan 9
measured it: **2**, both the same rule. Neither is suppressed, and where they are is not
in the Probe summary — ask for the file and line if they need dispositioning
individually. The rule itself is accepted for the whole SPA: the console ships one
English locale on purpose, there is no i18n framework in the dependency tree, and the
finding is informational rather than a security issue.

## Where the dispositions actually live

Unusually for a findings document, this file is not the primary record. Each
suppression sits inline on the resource it applies to, and the reason travels with
it, so a future editor sees it before deleting it:

- `Metadata: cfn_nag: rules_to_suppress:` with a `reason:` string, on each
  affected resource.
- `Metadata: checkov: skip:` with a `comment:` string, likewise.
- A **`SECURITY-SCANNER TRIAGE`** comment block above `Resources:` in each
  template, explaining the recurring classes once so the per-resource reasons can
  stay one line. Platform template: line 362. Per-student template: line 183.

If a reason here and a reason in a template disagree, the template wins — it is
the one a reviewer reads at the point of change.

## The suppressions, by class

Counted from the current templates: **43 cfn_nag** suppressions
(26 platform, 17 per-student) and **21 checkov** skips
(11 platform, 10 per-student), on 33 resources.
`checkov -d cloudformation` reports **165 passed, 0 failed, 21 skipped**. The
cfn_nag figure fell from 45 to 42 on 2026-08-27 when the three `W41` suppressions
were replaced by an explicit `BucketEncryption` block (§8), then rose to 43 when the
WAF landed (§20) and brought a `W84` on its log group with it. The checkov total is
unchanged across that change for the same reason: `CKV_AWS_68` was deleted and
`CKV_AWS_158` added.

### 1. `W28` — explicit resource names (14 suppressions)

**Disposition: accepted, and load-bearing. This is the one class where complying
would break the control the system exists to provide.**

Enforcement crosses a stack boundary by *name*, not by `Ref`. The admin backend's
role scopes its dangerous permissions with `ArnLike` conditions on literal
strings:

| Condition on | Literal pattern |
|---|---|
| `iam:PassRole` / role targeting | `arn:aws:iam::*:role/gpu-guardian-*-exec-role` |
| `iam:PolicyARN` on attach/detach | `arn:aws:iam::*:policy/gpu-guardian-*-deny-new-apps` |
| `lambda:InvokeFunction` | `function:gpu-guardian-*-stop-app` |

Each student is a *separate stack*, so there is no `Ref` available across the
boundary. Let CloudFormation generate those names and the backend can no longer
suspend anybody — and it fails silently, because nothing errors when an `ArnLike`
condition simply stops matching. See
[ADR-0003](adr/0003-cross-stack-wiring-by-name.md) and
[ARCHITECTURE.md](ARCHITECTURE.md#names-are-load-bearing).

Three `W28`s are a weaker case and say so in their own reason: the three
CloudWatch alarms are stateless, so replacement costs nothing — the name is kept
because it is the runbook's handle on them.

### 2. `W84` / `CKV_AWS_158` / `CKV_AWS_173` — "use a customer-managed KMS key"

**Disposition: split — the two storage rules are now fixed, the logging and
environment-variable rules remain accepted.**

**Fixed, 2026-08-26.** `CKV_AWS_119` (DynamoDB) and `CKV_AWS_187` (the Studio
domain's home EFS, previously §11) are closed by `PlatformKey` — a single
customer-managed key in the platform template's new **section 0**, with rotation
enabled and a 30-day deletion window. All three tables carry
`SSESpecification` with `SSEType: KMS`; the domain carries `KmsKeyId`.

Three things about that fix are worth knowing before deploying it:

1. **One key, not four.** The original objection was cost — a key is ~$1/month
   each — and one key answers it at $1.00 rather than $4.00. Nothing here needs
   cryptographic separation: the same admin can read all of it through the
   console. It does raise the control plane from $1.11/month to **$2.21/month**,
   which made a key the single largest line item in it until the WAF (§20) took
   that title ([COSTING.md](COSTING.md) §1).
2. **`KmsKeyId` on `AWS::SageMaker::Domain` is create-only, and adding it to a live
   domain does not work at all.** A change set reports `Replacement: True`, but the
   replacement cannot execute: CloudFormation creates before it deletes, so the new
   domain collides with the live one on `DomainName` and the update fails with
   `AlreadyExists`. This was confirmed against a real deployment on 2026-08-26. The
   rollback is worse than the failure — DynamoDB SSE changes do not roll back, so
   the tables keep the CMK while the key and the role's `kms:Decrypt` grant are
   rolled out of the stack, and every roster and ledger read starts failing. There
   is a `# STOP.` comment block above `StudioDomain` spelling this out. Same class
   of one-way door as `AuthMode`, but louder.
3. **The key is now load-bearing for recovery.** Scheduling its deletion makes the
   three tables unreadable, every point-in-time restore of them useless, and the
   home EFS unrecoverable. `PendingWindowInDays` is set to the 30-day maximum so a
   mistaken teardown has a month to be undone with `CancelKeyDeletion`.

A CMK is also not transparent to the caller: `AdminBackendFunctionRole` needed a
new `EncryptStateTables` statement (`kms:Encrypt`, `Decrypt`, `ReEncrypt*`,
`GenerateDataKey*`, `DescribeKey`, scoped by `kms:ViaService` to DynamoDB).
Without it every roster and ledger read fails and **the cap silently stops
metering** — which is a worse outcome than the finding it closes. Do not remove
that statement.

**Still accepted:** `W84` / `CKV_AWS_158` on CloudWatch log groups, and
`CKV_AWS_173` on Lambda environment variables. Both are already encrypted at
rest. What is stored is a student roster, per-student dollar totals, instance
types, a domain id, a student id — no credentials and nothing an admin holding the
console cannot already see.

Re-examined 2026-09-03 when the security advisor raised it again, because the
original reason had gone stale: it argued that CloudWatch Logs has no
AWS-managed-key option so compliance means owning a key purely to satisfy a
scanner — and `PlatformKey` now exists, so that objection no longer holds for the
four platform log groups. Two reasons survive, and they are narrower:

1. **The failure mode is bad and quiet.** `logs:AssociateKmsKey` requires a key
   policy granting `logs.<region>.amazonaws.com` — via `kms:EncryptionContext:aws:logs:arn`
   — and if that grant is wrong or later narrowed, CloudWatch **stops accepting
   log events** for the group. The backend keeps working; only its logs vanish.
   Since this cap [fails silent](ARCHITECTURE.md#how-the-cap-is-actually-enforced),
   the logs and alarms are the whole detection story, and encrypting them adds a
   way to lose exactly that.
2. **The per-student multiplier is real for the other two groups.** Those exist
   once per student, and their key grant would have to cross a stack boundary via
   `StorageKmsKeyArn` — the same parameter that, left empty, already silently
   stops notebooks starting ([SETUP.md](SETUP.md)). One more thing that fails at
   use time rather than deploy time.

So the disposition stands, but as a **considered trade rather than a cost
argument**: the log contents are low-sensitivity, and the risk of encrypting them
lands on the one signal that tells you enforcement has stopped. Encrypting the
four platform groups with `PlatformKey` is nonetheless the cheapest way to close
this if a policy requires it — it needs a key-policy statement for the Logs
service principal and `KmsKeyId` on each group, and it should be verified by
confirming events still arrive, not just that the stack deployed.

### 3. `W12` / `W11` — `Resource: '*'`

**Disposition: accepted, three statements, none narrowable. `CKV_AWS_111` is
fixed.**

**Fixed, 2026-08-26.** `ManageStudentIdcIdentities` on
`AdminBackendFunctionRole` — the only write-on-wildcard grant left in the
platform, covering `identitystore:CreateUser` and `DeleteUser` — was suppressed
on the belief that the Identity Store API supports no resource ARNs. That was
wrong. The Service Authorization Reference defines five resource types for it, and
the store itself is nameable, so the grant is now pinned to four ARNs:

| ARN | Note |
|---|---|
| `…:identitystore::${AccountId}:identitystore/${IdentityStoreId}` | Under `!If [IsOrgInstance, …]`. `IdentityStoreId` defaults to `''` in `ACCOUNT` mode, so the fallback is `identitystore/*` — an unguarded `!Sub` would emit a malformed ARN and IAM would reject the stack. |
| `…:identitystore:::user/*` | |
| `…:identitystore:::group/*` | |
| `…:identitystore:::membership/*` | |

The three wildcards are not reducible: every one of those eight actions requires
the `User`, `Group` or `GroupMembership` resource type alongside the store, the
ids are minted by IdC at call time, and `StudentGroup` exists only under
`Condition: IsOrgInstance` so its id cannot be named from a resource that has no
condition. What the scoping does buy is real — the grant can no longer reach an
identity store in another account, and can no longer reach any other service at
all. Note the parameter that does the work is **`IdentityStoreId`, not
`IdentityCenterInstanceArn`**; the instance ARN is an `sso:` ARN and is not a
resource type any `identitystore:` action accepts.

The three remaining wildcards, with `ManageStudentIdcIdentities` no longer among
them:

- **`DenyNewAppsPolicy`** — a `Deny`. The wildcard *is* the security property: it
  must cover every app, space and future ARN shape a breached student could reach
  for. Narrow it to named resources and a suspended student launches from the one
  you forgot. Marked in the template as the single finding where complying would
  directly weaken the cost control.
- **`sagemaker:ListApps` / `ListSpaces`** — support no resource-level ARNs at all.
  An AWS-side limitation, not a shortcut. They appear three times (the student's
  own Studio policy, the stop-app role, the cleanup role) and are read-only every
  time. The `DeleteApp`/`DeleteSpace` statements beside them are what confine each
  function to one student, scoped by profile ARN or `OwnerUserProfileArn`.
- **The backend's `ManageStudentStacks` statements** — CloudFormation stack
  operations against names not known until a student is added.

### 4. `W58` — "Lambda functions require permission to write CloudWatch Logs"

**Disposition: false positive, both per-student functions.** The grant exists, in
a separate `AWS::IAM::Policy` attached via `Roles:`. cfn_nag inspects only a
role's inline `Policies` block and cannot follow the association. The template
cites the exact line ranges. Do not add a duplicate grant to satisfy the scanner.

### 5. `W89` / `CKV_AWS_117` — "deploy the function inside a VPC"

**Disposition: accepted.** Every Lambda here calls only public AWS endpoints —
CloudFormation, DynamoDB, SageMaker, Logs, IAM/Identity Center, and the
CloudFormation response URL. There is nothing in the platform VPC to reach: the
Studio domain runs `AppNetworkAccessType: PublicInternetOnly`.

Raised again by the security advisor on 2026-09-03 as "Lambda functions should be
private", so the reasoning is worth stating at full length rather than as one line.

A VPC-attached Lambda is not reachable from the internet either way — an
unattached function has no inbound network path at all, only the invoke API, which
is IAM-controlled in both cases. What `VpcConfig` buys is control over *egress*.
So the question is what the egress actually needs to reach, and the answer is
awkward:

| Service the backend calls | Reachable privately? |
| --- | --- |
| DynamoDB, S3 | yes — **gateway** endpoints, no hourly charge |
| CloudFormation, SageMaker, Logs, STS, SNS, SSM, Cognito | yes — interface endpoints, **$7.30/month each per AZ** |
| **IAM** | **no** — IAM publishes no interface endpoint outside GovCloud |
| **Cost Explorer** (`ce`) | **no** — no interface endpoint |

IAM is the one that settles it. Attaching and detaching `DenyNewAppsPolicy` *is*
enforcement layer 1, so a backend that cannot reach `iam.amazonaws.com` cannot
enforce the cap. Private egress to IAM means a **NAT gateway: $32.85/month**
before data processing — three times the entire current control plane
([COSTING.md](COSTING.md) §1) — plus roughly $51/month of interface endpoints if
the rest go private too. Call it **$84/month to reduce the egress of four
functions that hold no secrets and reach nothing private**, against a control
plane that costs $11.23.

There is also a cost of *doing* it, not just a price: a VPC-attached function that
loses its route to IAM fails closed on new enforcement and, because this cap
[fails silent](ARCHITECTURE.md#how-the-cap-is-actually-enforced), the symptom is
students running uncapped rather than an error anyone sees. Adding a network
dependency to the enforcement path makes the failure mode worse, not better.

**If your policy mandates it anyway**, the shape is: a private subnet, a NAT
gateway, gateway endpoints for S3 and DynamoDB, interface endpoints for the rest,
and `VpcConfig` on `AdminBackendFunction` and the two per-student functions. Leave
`BucketCleanupFunction` out — it runs at teardown, after the VPC's own resources
may already be gone. None of this is in the template today.

### 6. `W92` / `CKV_AWS_115` — reserved concurrency

**Disposition: accepted, deliberately.** On the per-student stop-app function this
is a *correctness* decision, not an oversight: the caller checks the invoke result
and refuses to record a hold unless enforcement succeeded, so a silently-throttled
or queued retry is worse than a visible failure. Same reasoning for the
CloudFormation custom-resource function, where a throttle means a stack stuck in
`DELETE_IN_PROGRESS`. See [ADR-0006](adr/0006-two-enforcement-layers.md).

### 7. `CKV_AWS_116` / `LAMBDA_DLQ_CHECK` — dead-letter queue

**Disposition: fixed on the backend, accepted on the other three.** The backend
function got a dead-letter target in the remediation pass. The stop-app function
deliberately has none, for the reason in §6 — a dead-lettered stop is a student
still burning GPU hours while the ledger says `ON_HOLD`. cfn-guard raises the same
class against the two cleanup functions (`BucketCleanupFunction`,
`StudentStudioCleanupFunction`), and there a DLQ is not merely unhelpful but
inapplicable: both are CloudFormation **custom resources**, invoked with a
`ResponseURL` they must answer on every path. Failure has to be reported to
CloudFormation — a queued retry an hour later cannot unblock a stack that is
already wedged, which is why both functions catch everything and respond rather
than raise.

### 8. `W41` / `CKV_AWS_28` / `S3_DEFAULT_ENCRYPTION_KMS` — S3 default encryption

**Disposition: fixed, 2026-08-27** (previously accepted on the grounds that SSE-S3
has applied to every new object by default since January 2023, making an explicit
block a no-op — which is still true).

All three buckets now carry an explicit `BucketEncryption` block with
`SSEAlgorithm: AES256`, and the three `W41` suppressions were deleted rather than
kept. The change is behaviourally a no-op; what it buys is that the intent is
readable at the resource instead of only in a suppression reason, and that
cfn-guard — which reads no suppressions — stops raising it six times.

**`AES256`, not the CMK, on all three, for three different reasons.** `LogsBucket`
must not use SSE-KMS at all: CloudFront standard logging cannot deliver to a bucket
whose default encryption is a KMS key, and there is no policy that fixes it.
`FrontendBucket` is read by CloudFront through OAC, so a CMK would mean granting
the distribution `kms:Decrypt` to protect a public SPA bundle. `TemplatesBucket`
holds the per-student template, which is not sensitive and is already read only by
two named roles.

### 9. `W35` / `W10` / `CKV_AWS_18` / `CKV_AWS_86` — S3 and CloudFront access logging

**Disposition: fixed, 2026-08-26** (previously accepted on the grounds that the
only content served is a public SPA bundle and the request log that matters is
`AdminHttpApiAccessLogGroup`).

`LogsBucket` in the platform template's section 6 now receives all of it under
three prefixes: `s3-access-logs/templates/`, `s3-access-logs/frontend/`, and
`cloudfront/` for the distribution's standard logs. One bucket, not three — each
extra log bucket is another set of the same properties to keep correct and another
thing teardown has to empty. `LogsBucketCleanup` empties it, and it is ordered to
run **last** of the three cleanups, because emptying the other two is itself
logged.

Four details that are easy to get wrong and are commented in the template:

- **It logs to itself**, under `s3-access-logs/logs/`. A log bucket with no
  logging just moves `CKV_AWS_18` rather than closing it. The self-reference is
  spelled as a literal `!Sub` of its own name, because `!Ref LogsBucket` inside
  `LogsBucket` is a circular dependency. **If the bucket name changes, change it
  in both places.**
- **A 90-day lifecycle rule is therefore not optional.** Self-logging is a
  feedback loop: writing a log object is itself a request that generates a log.
- **`ObjectOwnership` must stay `BucketOwnerPreferred`.** CloudFront standard
  logging grants itself delivery access by writing the bucket ACL and has no
  policy-based equivalent, so `BucketOwnerEnforced` breaks it.
- **`DistributionConfig.Logging.Bucket` takes the bucket *domain name***, not its
  name or ARN. And it has to be standard logging (legacy) — standard logging v2
  via `AWS::Logs::Delivery*` delivers the same records and still fails both
  `CKV_AWS_86` and `W10`, because neither rule looks outside `DistributionConfig`.

S3 log delivery is authorised by a policy statement on `LogsBucketPolicy` naming
`logging.s3.amazonaws.com`, scoped by `aws:SourceAccount` and an `aws:SourceArn`
pattern, rather than by a `LogDeliveryWrite` ACL — the ACL route works but
`AccessControl` is a legacy property that cfn-lint flags (`W3045`).

The bucket also must **not** use `PlatformKey`: CloudFront standard logging cannot
deliver into a bucket whose default encryption is SSE-KMS.

### 10. `W60` — VPC flow logs

**Disposition: accepted, with a stated expiry condition.** Under
`PublicInternetOnly` no notebook traffic traverses this VPC — Studio egresses via
AWS's managed network. The only ENI in the subnet is the domain's EFS mount
target, verified live on 2026-08-26 (`describe-network-interfaces` returns exactly
one ENI, `InterfaceType: efs`, no public IP). A flow log would record NFS mount
chatter and nothing else.

**This stops being true the moment `AppNetworkAccessType` becomes `VpcOnly`** — at
which point flow logs are worth revisiting, along with the ~$205/month of NAT and
interface endpoints that change also brings.

### 11. `CKV_AWS_187` — CMK on the SageMaker domain

**Disposition: fixed, 2026-08-26 — and it is a one-way door.** `StudioDomain` now
carries `KmsKeyId: !GetAtt PlatformKey.Arn`, setting the CMK for the domain's home
EFS filesystem, which holds every student's notebooks.

The property is **create-only**, and on an existing domain the update does not
merely destroy student work — it fails. CloudFormation creates the replacement
before deleting the original, so it collides with the live domain on `DomainName`
and returns `AlreadyExists`; the rollback then strands the DynamoDB tables on a CMK
whose grant has been rolled away. Confirmed against a live deployment on
2026-08-26, which had to be torn down and rebuilt to take this fix.

On a fresh deploy it costs nothing. On a live one there are exactly two options —
tear down and redeploy, or comment the property out and re-accept this finding —
and the `# STOP.` block above `StudioDomain` says so. Verify with
`create-change-set --no-execute` and read the `Replacement` column; `True` here
means "will fail", not "will succeed destructively". See
[SETUP.md](SETUP.md#what-you-cannot-change-later) and §2 above.

### 12. `W76` — IAM policy complexity above 25

**Disposition: accepted.** A consequence of scoping by exact ARN and by condition
key rather than using wildcards. The policies are long *because* they are narrow.

### 13. `S3_BUCKET_SSL_REQUESTS_ONLY` — TLS not enforced in a bucket policy

**Disposition: fixed, 2026-08-26.** Raised by cfn-guard in scan 4, and correct:
neither bucket refused a plain-HTTP request. Both now carry a `DenyNonTlsRequests`
statement — `Effect: Deny`, `Principal: '*'`, `Action: s3:*`, conditional on
`aws:SecureTransport` being `false`:

- `TemplatesBucketPolicy` is new, and is deny-only. It grants nothing; access to
  that bucket is still identity-side, which is why the resource's `W51`
  suppression was reworded rather than removed.
- `FrontendBucketPolicy` gained the statement alongside its existing CloudFront
  OAC grant.

Nothing legitimate is denied — CloudFront-to-origin, the AWS CLI and every SDK all
connect over HTTPS already. Each policy carries an `F16` suppression, because
`Principal: '*'` on a *deny* is the required form: the intent is to refuse every
principal that arrives without TLS, including ones this account has never seen.
Narrowing the principal would narrow what gets denied. Same reasoning as
`DenyNewAppsPolicy` in §3.

### 14. `AWS Legal Prohibited Terms` — capital/operating spend abbreviations

**Disposition: fixed, 2026-08-26.** A content-rubric finding, not an
infrastructure one. `docs/PROPOSAL.md` used the two-syllable abbreviation for
capital spend to describe self-hosted GPU servers. AWS Legal prohibits that
abbreviation, its operating-spend counterpart, and both spelled-out forms in
customer-facing material — **including inside quotation marks and when describing
costs that are not AWS's**. That last clause is the one that catches people: the
term was being used about buying physical servers, and it was still a finding.

Replaced with "upfront hardware investment"; the approved general phrasing is
"upfront or fixed costs". A repository-wide grep for all four terms now returns
nothing, which is why this section describes them rather than quoting them — a
findings document is customer-facing too.

### 15. `CKV_AWS_174` / `W70` / `CLOUDFRONT_CUSTOM_SSL_CERTIFICATE` — CloudFront minimum TLS version

**Disposition: accepted as a true positive, and not fixable as configured.** This
one is worth reading carefully, because the tempting justification for it is false
and the tempting fix is worse than the finding.

**The finding is correct.** The distribution really does accept TLS 1.0 and 1.1.
With no custom domain it is reached at `<id>.cloudfront.net` under CloudFront's own
certificate, and the CloudFront documentation is explicit: "when
`CloudFrontDefaultCertificate` is `true` in the API, CloudFront automatically sets
the security policy to TLSv1." The `TLSv1` policy admits TLS 1.0, 1.1, 1.2 and 1.3.
No property raises that floor while the default certificate is in use.

Measured against the live distribution on 2026-08-26:

| Protocol offered | Result |
| --- | --- |
| TLS 1.0 | handshake completes — `ECDHE-RSA-AES128-SHA` |
| TLS 1.1 | handshake completes — `ECDHE-RSA-AES128-SHA` |
| TLS 1.2 | handshake completes — `ECDHE-RSA-AES128-GCM-SHA256` |
| TLS 1.3 | handshake completes — `TLS_AES_128_GCM_SHA256` |

One trap in reproducing this. OpenSSL 3 will not *offer* TLS 1.0/1.1 at its default
security level, and reports `no protocols available` — a client-side refusal that
reads exactly like CloudFront declining the connection, and will talk you into
believing the finding is a false positive. Pass `-cipher 'ALL:@SECLEVEL=0'` and the
handshakes succeed:

```bash
openssl s_client -connect <id>.cloudfront.net:443 -servername <id>.cloudfront.net \
  -tls1 -cipher 'ALL:@SECLEVEL=0'
```

**Do not "fix" it by setting the property.** Adding a `ViewerCertificate` with
`CloudFrontDefaultCertificate: true` and `MinimumProtocolVersion: TLSv1.2_2021`
silences both `CKV_AWS_174` and `W70`, and changes nothing at runtime — CloudFront
sets the policy back to `TLSv1` regardless. That converts a documented, visible
accepted risk into an undocumented invisible one, which is a net loss even though
the scan output looks better. The only real fix is a custom domain plus an ACM
certificate, at which point `MinimumProtocolVersion` becomes honoured and this is
genuinely a one-line change.

**Scope of the exposure, stated plainly.** A client that negotiates TLS 1.0 against
this host downloads a public JavaScript bundle — no credential, no token, nothing
that is not already public. It cannot reach the API that way. Both of the hosts that
*do* carry secrets were measured the same day and **reject** TLS 1.0 and 1.1
outright, returning `alert protocol version`:

| Host | TLS 1.0 / 1.1 | Carries |
| --- | --- | --- |
| `AdminHttpApi` (`execute-api`) | rejected | every API call, bearer tokens |
| Cognito hosted UI | rejected | the admin password |

So the weak floor applies only to cacheable static assets, and
`ViewerProtocolPolicy: redirect-to-https` — the part that *is* in our control — is
set. That is the whole of the risk being accepted here.

### 16. `S3_BUCKET_DEFAULT_LOCK_ENABLED` — S3 Object Lock (6 findings)

**Disposition: accepted, and fixing it would break the deploy.** Object Lock makes
an object immutable for its retention period. Every one of these three buckets is
written and then *rewritten or emptied* as a matter of normal operation: the SPA
bundle is overwritten on every console deploy, the per-student template on every
template upload, and all three are emptied by a cleanup custom resource at teardown
so the bucket delete can succeed. Object Lock would turn a re-deploy into an error
and a `delete-stack` into a stack that cannot be torn down. It is also create-only —
it cannot be added to a live bucket at all. The retention this system actually needs
is expiry, not immutability, and that is set: 90 days on the logs, 7 on noncurrent
versions.

### 17. `IAM_NO_INLINE_POLICY_CHECK` — inline policies on roles (4 findings)

**Disposition: accepted; complying would change nothing but the syntax.** The rule
looks for a `Policies:` list on the role, which four roles have:
`AdminBackendFunctionRole`, `StudentStackDeployRole`, `BucketCleanupFunctionRole`,
and `StudentStudioCleanupFunctionRole`. Everywhere else in both templates the same
grants are written as sibling `AWS::IAM::Policy` resources — which IAM also stores
as *inline* policies on the role. So the fix cfn-guard is asking for is a move from
one inline form to the other, with identical permissions and identical lifetime; it
would satisfy the check without improving anything.

For the two cleanup roles the current form is load-bearing and must not be changed:
a standalone `AWS::IAM::Policy` has no dependency path back to the custom resource
that uses it, so CloudFormation is free to delete it in parallel with the very
teardown invocation that needs it. Inlined on the role, the policy lives and dies
with the role. The note is on the resource, at
`04-Sagemaker-Gpu-Student.yaml:733`.

What the rule is really reaching for is *managed* policies, and those are wrong
here: a managed policy outlives the stack unless something detaches it, and every
role in this system is deliberately stack-scoped so that tearing down a class
leaves nothing behind.

### 18. `NO_UNRESTRICTED_ROUTE_TO_IGW` — `0.0.0.0/0` on the public route

**Disposition: accepted; there is nothing in the subnet for the route to expose.**
The rule guards against an internet-reachable workload. This VPC has no workload in
it at all. The domain runs `AppNetworkAccessType: PublicInternetOnly`, under which
notebook traffic does not traverse this VPC — the VPC exists only because
`AWS::SageMaker::Domain` requires `VpcId` and `SubnetIds` regardless, and the single
ENI in it is the domain's EFS mount target. `MapPublicIpOnLaunch` is `false` and
nothing is ever launched in the subnet, so no instance acquires a public address by
this route.

The route and gateway could in principle be dropped, since no traffic uses them.
They are kept because the subnet is configured as a public subnet to match what the
`PublicInternetOnly` layout expects, and pulling network resources out of a live
domain to satisfy a `LOW` finding on an unused path is a worse trade than writing
this paragraph. **None of the above holds under `VpcOnly`** — the same warning is on
the VPC resource itself. If the domain is ever switched, this finding stops being
accepted and the design needs private subnets, and with them the NAT gateway priced
at ~$33/month per AZ in [COSTING.md](COSTING.md).

### 19. `S3_BUCKET_NO_PUBLIC_RW_ACL` — missing `AccessControl` (3 findings)

**Disposition: accepted; the rule reports the absence of a deprecated property.**
The finding is literally "property `AccessControl` to compare from is missing" — it
wants a canned ACL declared so it can check that the ACL is not
`PublicReadWrite`. `AccessControl` is the legacy S3 ACL mechanism, `cfn-lint` flags
its use as `W3045`, and on `LogsBucket` it would collide with the
`ObjectOwnership: BucketOwnerPreferred` that CloudFront logging requires. Public
access is blocked the modern way instead: all four
`PublicAccessBlockConfiguration` settings are `true` on all three buckets, which no
ACL can override.

### 20. `CKV_AWS_68` — no WAF on the CloudFront distribution (fixed, 2026-08-27)

**Disposition: fixed. The suppression that used to sit here argued the finding away
on cost and has been deleted; do not restore it.** `FrontendWebAcl` is a
`Scope: CLOUDFRONT` WAFv2 web ACL, attached through `WebACLId` on
`FrontendDistribution`, carrying three AWS managed rule groups
(`AmazonIpReputationList`, `CommonRuleSet`, `KnownBadInputsRuleSet`) and a
rate-based rule at 2,000 requests per IP per five minutes. `DefaultAction` is
`Allow`, and logging goes to `aws-waf-logs-gpu-guardian-admin-frontend` at 30-day
retention.

Three things about it are worth knowing before you change it.

**It is not the authorization boundary and does not become one.** That is still the
JWT authorizer on `AdminHttpApi`, which this distribution does not sit in front of —
the console is a static bundle and the API is reached directly. Nothing in the WAF
is load-bearing for access control; it is defence in depth over public assets and a
bound on what one address can cost in CloudFront requests. The old suppression's
factual claims were all true. What it got wrong was the conclusion.

**It exists only in us-east-1.** The WAFv2 API accepts `Scope: CLOUDFRONT` in
us-east-1 and nowhere else, and `SETUP.md` does not pin the region. So the ACL, its
log group and its logging configuration are all gated on an `InUsEast1` condition,
and `WebACLId` resolves to `AWS::NoValue` outside it. **A deploy outside us-east-1
therefore succeeds with no WAF in front of the console and says nothing about it** —
that is the accepted gap in this fix, chosen over making the stack undeployable
elsewhere. The `FrontendWebAclArn` output is empty in that case; check it.

**No count-mode overrides are set**, which is safe only because the origin serves a
static SPA over `GET`. Put an API behind this distribution and
`SizeRestrictions_BODY` in `CommonRuleSet` will start blocking real requests.
Similarly, a campus behind a single NAT address is the realistic way to trip the
rate limit — raise the limit rather than deleting the rule.

Cost: about **$9/month** — $5 for the web ACL and $1 per rule — plus $0.60 per
million requests and CloudWatch Logs ingestion, against a control plane that was
$2.21/month. This is the largest single line the guardrails have added, and it was
accepted deliberately; the derivation is in [COSTING.md](COSTING.md).

## Security advisor review, 2026-09-03

A human review, not a scanner run, so it is recorded separately: the reviewer read
the threat model, both templates and the post-WAF Holmes report. The threat model
passed with no comments. Nine items came back. Six are fixed below, three are
declined with reasons.

| # | Item | Disposition |
|---|---|---|
| 1 | `StudentStudioCleanupFunction` uses `print()`, not a logger | **fixed** — all four inline handlers now use `logging` |
| 2 | `LoggingConfig` missing, so the function-to-log-group association is implicit | **fixed** — declared on all four functions (the mandatory item) |
| 3 | Holmes HIGH: CloudFront TLS floor | **fixed as documentation** — `WARNING` block in `README.md` recommending an ACM certificate; the finding itself stays accepted (§15) |
| 4 | `CognitoUserPoolClient` should disable user sign-up | **fixed** — `AllowAdminCreateUserOnly: true` on the pool |
| 5 | KMS missing on the CloudWatch log groups | **declined** — see §2; a CMK on a log group is billed per group |
| 6 | Lambdas not in a VPC (both templates) | **declined** — see §5; IAM has no interface endpoint, so private egress means a NAT gateway |
| 7 | Why only a public subnet in the VPC? | **by design** — see below |
| 8 | Custom IAM roles with narrowed actions | noted approvingly, no action |
| 9 | cfn_nag and checkov suppressions | noted, no action |

**Item 2 in detail, since it was the mandatory one.** The functions were already
writing to CloudWatch: each had an explicit `AWS::Logs::LogGroup` whose name
matched Lambda's implicit `/aws/lambda/<FunctionName>`, so the logs were landing in
a group that had retention set. What was missing was the *declaration* — the
association was inferable only from a naming convention, and a rename would have
silently orphaned the retention policy while Lambda quietly created a fresh
never-expiring group. `LoggingConfig` now states it. A side effect worth knowing:
the `Ref` inside `LoggingConfig` creates the same dependency the two per-student
functions previously carried as an explicit `DependsOn`, so cfn-lint began
reporting `W3005` for the redundancy; the `DependsOn` lines are gone and the
delete-ordering reason they existed for is now written on the `LoggingConfig`
property instead. Do not remove it — the ordering is what stops a deleted student
becoming un-re-addable.

**Item 7, the single public subnet.** Deliberate, and the reason is that nothing
in the design has a private-subnet job. The only ENI the VPC ever holds is the
Studio domain's EFS mount target; the domain itself runs
`AppNetworkAccessType: PublicInternetOnly`, so notebook traffic leaves through the
internet gateway rather than through the subnet's own route. Adding a private
subnet would mean a NAT gateway at $32.85/month for notebooks to reach PyPI, or
notebooks with no internet at all — which for a teaching lab where students `pip
install` is a broken lab, not a hardened one. The subnet sets
`MapPublicIpOnLaunch: false`, so nothing is auto-assigned a public address. The
`0.0.0.0/0` route this leaves on the public route table is §18.

## What was fixed rather than suppressed

All in the remediation pass, commits `2f7363a` and `941089b`:

| Fix | Finding class it closed |
|---|---|
| API Gateway access logging (`AdminHttpApiAccessLogGroup`) | `CKV_AWS_95`, `W46` |
| CloudWatch alarms on the backend (errors, throttles, duration) | operational gap surfaced during triage |
| Dead-letter target on the backend function | `CKV_AWS_116` (backend only) |
| Point-in-time recovery on all three DynamoDB tables | `CKV_AWS_28`, `W78` |
| `MapPublicIpOnLaunch: false` on the public subnet | `W33` |
| SNS at-rest encryption | `CKV_AWS_26`, `W47` |
| `RetentionInDays` on every log group (30 / 90 / 365 by group) | unbounded log retention |
| Deleted `01-Sagemaker-Gpu-Platform.yaml` and `02-Sagemaker-Gpu-Admin.yaml` | ~90 findings that existed only in superseded templates |
| `DenyNonTlsRequests` on both bucket policies | `S3_BUCKET_SSL_REQUESTS_ONLY` (§13) |
| Capital-spend abbreviation removed from `docs/PROPOSAL.md` | AWS Legal prohibited terms (§14) |
| `PlatformKey` (section 0) on all three tables and the Studio domain | `CKV_AWS_119`, `W74`, `CKV_AWS_187` (§2, §11) |
| `LogsBucket` (section 6) + `LoggingConfiguration` on both buckets + `Logging` on the distribution | `CKV_AWS_18` ×2, `CKV_AWS_86`, `W35` ×2, `W10` (§9) |
| Identity Store ARNs on `ManageStudentIdcIdentities` | `CKV_AWS_111` (§3) |

Added 2026-08-27, after scan 6:

| Fix | Finding class it closed |
|---|---|
| Explicit `BucketEncryption` (`AES256`) on all three buckets, and the three `W41` suppressions deleted | `S3_DEFAULT_ENCRYPTION_KMS` ×6, `W41` ×3 (§8) |
| The seven caret-ranged dependencies in `app/package.json` pinned to the versions the lockfile already resolved, and the lockfile regenerated | `Dependency and Supply Chain Security` (rubric, MEDIUM) |
| `docs/cost-summary.html` now names `ml.g6.xlarge` and `ml.g5.xlarge`, quotes both hourly prices, and points at `COSTING.md` for the comparison | `Production Readiness Disclaimers` (rubric, MEDIUM) |
| `FrontendWebAcl` + `WebACLId` on the distribution, and the `CKV_AWS_68` skip deleted | `CKV_AWS_68` (§20) |

Added 2026-09-03, after the security advisor review:

| Fix | Finding class it closed |
|---|---|
| `LoggingConfig` on all four Lambda functions, and the two now-redundant `DependsOn` lines removed | advisor item 2 (mandatory), `W3005` |
| `logging` in place of `print()` in all four inline handlers | advisor item 1 |
| `AllowAdminCreateUserOnly: true` on `CognitoUserPool` | advisor item 4 |
| TLS `WARNING` block in `README.md` recommending an ACM certificate on a custom domain | advisor item 3 |

The dependency fix moved no resolved version — `npm ci`, `npm run typecheck` and
`npm run build` all pass, and the lockfile diff is seven spec strings and nothing
else. The point of pinning is that a fresh `npm install` on a machine without the
lockfile can no longer drift.

## Application-level risks no scanner covers

A cost-control system has a threat model a IaC scanner does not reach: the
adversary is a *legitimate authenticated user* whose incentive is to keep a GPU
running. Trust boundaries, assets, and the threats T1–T11 — including the one that
matters most, **the cap fails silent rather than closed** — are in
[THREAT-MODEL.md](THREAT-MODEL.md). Nothing in this file substitutes for reading
it.

## If you re-scan

- Suppressions live in the templates, so a clean IaC result is expected. A *new*
  cfn_nag or checkov finding means something changed in the template, not that the
  scanner got stricter — read the diff before adding a suppression.
- Never suppress a `Resource: '*'` finding on `DenyNewAppsPolicy` by narrowing the
  policy. Suppress the finding; keep the wildcard. The same applies to
  `Principal: '*'` on any of the three `DenyNonTlsRequests` statements. Nor
  `Resource: '*'` on `EncryptAlertsAtRest`, nor the `EncryptStateTables` statement
  that a customer-managed key on the tables now requires — removing that one stops
  the cap metering (§2).
- Some pipelines do not read `Metadata` suppressions and will re-report every
  accepted finding, all at one severity. Before treating a `HIGH` as new, look the
  rule id up in "The suppressions, by class" above — scan 4 was nine parts
  re-report, two parts real, and scan 5 was nine parts re-report and nothing new.
- **cfn-guard reads no suppressions and there is nothing to add to the templates
  that will quiet it.** A cfn-guard run on the current templates returns the same
  20 accepted findings, and that is the expected result rather than a regression:
  dead-letter queue ×3 (§7), CloudFront certificate ×3 (§15), Object Lock ×6 (§16),
  inline policy ×4 (§17), IGW route ×1 (§18), public-RW ACL ×3 (§19). The six S3
  encryption findings fixed in §8 should be absent. Anything outside that list is
  new.
- The WAF added in §20 brings new resources and therefore new rules into scope. A
  finding on `FrontendWebAcl` asking for count-mode overrides, or on
  `FrontendWebAclLogGroup` asking for a CMK (`W84` / `CKV_AWS_158`, §2), is expected;
  a finding saying the distribution has no WAF is now a regression — check that
  `WebACLId` is still on `DistributionConfig` and that you are scanning in a context
  where `InUsEast1` resolves true.
- Record the new scan in the history table above — date, total, per-scanner counts,
  and what it covered. A row with no counts behind it is an assertion.
