# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**No version has been tagged yet.** There is nothing to apply [Semantic
Versioning](https://semver.org/spec/v2.0.0.html) to: the repository has no tags and no
release artifacts, and the deployable unit is a CloudFormation template consumed
directly from `main`. Entries are therefore grouped by date and reconstructed from git
history. Once a first release is cut, this file switches to `## [x.y.z] - date`
headings and this paragraph goes away.

## [Unreleased]

### Security

Changes from a security advisor review and two Holmes scans on 2026-09-03. The
dispositions, including the three items declined and why, are in
[SECURITY-FINDINGS.md](docs/SECURITY-FINDINGS.md#security-advisor-review-2026-09-03).

- **The email claim is no longer written to the API access log.** The
  `AdminHttpApiStage` access log format carried
  `"jwtEmail":"$context.authorizer.claims.email"`, which put a real address in every
  request record of a log group retained for 365 days — an operational log that was
  quietly also a PII store. `jwtSub` (the Cognito user id) stays and identifies the
  caller just as precisely; resolving it to a person needs `admin-get-user` or the
  students table, which is the point. Raised by the Holmes CSR rubric as
  `Sensitive Data Handling` (medium).

- **Fixed a `NameError` in `StopStudioAppFunction`.** Converting its `print()` to
  `log.info()` earlier the same day did not add the `logging` import or define `log`, so
  the last statement of the handler would have raised on every invocation — *after* the
  `DeleteApp` calls, meaning enforcement layer 2 did its work and then reported failure.
  The handler now sets up a logger like the other three. Found by reading the inline
  handler as uploaded to a Holmes scan, not by any scanner rule; there is now a check
  that parses every inline `ZipFile` and reports names that are never bound.

- **Documented why the KMS key policy grants `kms:*` to the account root.** No behaviour
  change: the statement is the default policy AWS creates and exists to prevent
  permanent lockout. The comment now says it is a ceiling that delegates to IAM rather
  than a grant to any caller, points at the narrow identity policies where least
  privilege is actually enforced, and says not to widen it. Raised by the Holmes CSR
  rubric as `IAM and Authorization` (medium) — a documentation finding, not a
  misconfiguration.

- **`LoggingConfig` on all four Lambda functions** — `AdminBackendFunction`,
  `BucketCleanupFunction`, `StopStudioAppFunction`, `StudentStudioCleanupFunction`. This
  was the review's one mandatory item. The functions were already writing to CloudWatch:
  each had an explicit `AWS::Logs::LogGroup` whose name matched Lambda's implicit
  `/aws/lambda/<FunctionName>`, so logs landed in a group with retention set. What was
  missing was the declaration — the association existed only by naming convention, so a
  rename would have orphaned the retention policy while Lambda silently created a fresh
  never-expiring group.

  **The two per-student `DependsOn: …LogGroup` lines are removed with this**, because the
  `Ref` inside `LoggingConfig` produces the identical dependency and cfn-lint reported
  `W3005` for the redundancy. The reason those `DependsOn` lines existed has not gone
  away and is now written on the `LoggingConfig` property instead: CloudFormation deletes
  in reverse dependency order, and without that ordering the log group is deleted while
  the function still exists, Lambda re-creates it un-retained, and **the student can never
  be re-added**. Do not remove the property to "simplify".

- **`logging` in place of `print()`** in all four inline handlers — six calls in the
  per-student template, two in the platform's bucket-cleanup function. The runtime stamps
  each record with a level and the request id, so a teardown that timed out on a stuck
  Space can now be found by filtering the group on `ERROR` instead of reading a
  15-minute stream.

- **`AllowAdminCreateUserOnly: true` on `CognitoUserPool`** — self-registration is off.
  Cognito defaults this to `false`, which leaves the public `SignUp` API open on the
  hosted UI. Such an account lands in no group, so it could reach no admin route and had
  no student record to resolve to, but it did hold a valid JWT and the pool is meant to
  contain exactly the roster the console created. Nothing needed `SignUp`: every real
  user arrives through `AdminCreateUser` in `ACCOUNT` mode or SAML federation in
  `ORGANIZATION` mode.

- **A TLS `WARNING` block in `README.md`.** The Holmes HIGH finding on the CloudFront
  minimum TLS version is not fixable while the distribution uses the default
  `*.cloudfront.net` certificate — CloudFront pairs it with the `TLSv1` policy and
  ignores `MinimumProtocolVersion`. The README now says so up front and gives the actual
  remedy: an ACM certificate in us-east-1 on a domain you control, `Aliases`, and
  `MinimumProtocolVersion: TLSv1.2_2021`. The finding itself stays accepted (§15).

  Also re-examined `W84`/`CKV_AWS_158` (KMS on log groups) rather than re-citing the old
  reason, which had gone stale: it argued that complying meant owning a key purely to
  satisfy a scanner, and `PlatformKey` has existed since 2026-08-26. Still declined, but
  now on the grounds that a bad key grant makes CloudWatch **stop accepting log events**
  while the backend keeps running — losing the one signal that reports a cap which fails
  silent.

### Added

- `FrontendWebAcl` — an AWS WAF web ACL in front of the admin console's CloudFront
  distribution, wired in through `WebACLId`, with `FrontendWebAclLogGroup` and
  `FrontendWebAclLogging` beside it and a new `FrontendWebAclArn` output. Three AWS
  managed rule groups (`AmazonIpReputationList`, `CommonRuleSet`,
  `KnownBadInputsRuleSet`) and a rate-based rule at 2,000 requests per IP per five
  minutes, `DefaultAction: Allow`. Closes `CKV_AWS_68`, whose suppression is deleted;
  the reason it carried argued the finding away on cost and should not be restored.

  Two things to know. **A `Scope: CLOUDFRONT` web ACL can only be created in
  us-east-1**, so all four resources are gated on a new `InUsEast1` condition and
  `WebACLId` resolves to `AWS::NoValue` elsewhere — a deploy outside us-east-1 comes
  up with the console unprotected and does not warn you, which is why the ARN is now
  a stack output to check. And **the WAF is not the authorization boundary**; that is
  still the JWT authorizer on `AdminHttpApi`, which sits behind API Gateway rather
  than this distribution. Nothing here is load-bearing for access control.

  It costs **$9.02/month** — $5.00 for the web ACL, $1.00 per rule, plus request
  charges — which takes the control plane from $2.21 to **$11.23/month** at 100
  students and makes the WAF 80% of it. That is the largest single line the
  guardrails have ever added and it is accepted deliberately. `COSTING.md`,
  `cost-summary.html`, `README.md`, `ARCHITECTURE.md`, `SETUP.md`, `ADR-0002` and
  `SECURITY-FINDINGS.md` §20 are all re-derived for it; per-student standing cost
  goes $0.58 → $0.67 and the recommended trimester budget is unchanged at $26,000.

- Explicit `BucketEncryption` with `SSEAlgorithm: AES256` on `LogsBucket`,
  `TemplatesBucket` and `FrontendBucket`, replacing the three `W41` suppressions
  that said the block would be a no-op. It still is a no-op — SSE-S3 has applied by
  default since January 2023 — but stating it puts the intent on the resource and
  closes `S3_DEFAULT_ENCRYPTION_KMS` ×6 for scanners that read no suppressions.
  **`AES256`, never the CMK, on `LogsBucket`:** CloudFront standard logging cannot
  deliver to a bucket whose default encryption is SSE-KMS. cfn_nag suppressions:
  45 → 42.

- `PlatformKey` — a customer-managed KMS key (new section 0 of the platform
  template), with rotation enabled and a 30-day deletion window. All three DynamoDB
  tables now carry `SSESpecification` with `SSEType: KMS`, and the Studio domain
  carries `KmsKeyId`, closing `CKV_AWS_119` ×3, `W74` ×3 and `CKV_AWS_187`. One key
  rather than four, because the objection to the rule was cost: it raises the
  control plane from $1.11 to $2.21/month rather than to $5.11.

  Two things to know before applying this to a live deployment. **`KmsKeyId` on
  `AWS::SageMaker::Domain` is create-only, and adding it to an existing domain fails
  the stack update** — CloudFormation creates the replacement before deleting the
  original, so it collides on `DomainName` and returns `AlreadyExists`. Worse, the
  rollback strands the tables: DynamoDB SSE changes do not roll back, so they keep
  the CMK while the key and its `kms:Decrypt` grant are rolled away, and every
  roster and ledger read fails. Confirmed the hard way on 2026-08-26; the live
  deployment had to be torn down and rebuilt. A `# STOP.` comment block above
  `StudioDomain` says so, as do `docs/SETUP.md` and `docs/DEPLOYMENT.md`. And **the
  key is load-bearing for recovery**: scheduling its deletion makes the tables
  unreadable and their point-in-time restores useless.

- `EncryptStateTables` on `AdminBackendFunctionRole` — `kms:Encrypt`, `Decrypt`,
  `ReEncrypt*`, `GenerateDataKey*` and `DescribeKey` on `PlatformKey`, scoped by
  `kms:ViaService` to DynamoDB. A CMK is not transparent to the caller; without
  this statement every roster and ledger read fails and the cap silently stops
  metering. Do not remove it.

- `LogsBucket` and `LogsBucketPolicy` in section 6, plus `LoggingConfiguration` on
  `TemplatesBucket` and `FrontendBucket`, `Logging` on `FrontendDistribution`, and a
  third `LogsBucketCleanup` custom resource. Closes `CKV_AWS_18` ×2, `CKV_AWS_86`,
  `W35` ×2 and `W10`. The bucket logs to itself so the finding closes rather than
  moving, which is why it has a 90-day lifecycle rule; `ObjectOwnership` is
  `BucketOwnerPreferred` because CloudFront standard logging needs bucket ACLs
  enabled. `LogsBucketCleanup` runs last of the three cleanups, since emptying the
  other two is itself logged.

- `DenyNonTlsRequests` on both S3 bucket policies — `Deny` on `s3:*` for any
  request where `aws:SecureTransport` is `false`. `TemplatesBucketPolicy` is a new
  resource and is deny-only; it grants nothing, so access to that bucket remains
  identity-side. Closes the cfn-guard `S3_BUCKET_SSL_REQUESTS_ONLY` finding. Both
  policies carry an `F16` suppression: `Principal: '*'` on a deny is the required
  form.

- `docs/SETUP.md` — prerequisites, every CloudFormation parameter documented, and the
  irreversible decisions called out before the first deploy.
- `docs/THREAT-MODEL.md` — trust boundaries, assets, and threats T1–T11, with a
  file-and-mechanism citation behind every mitigation claim and a grep-based
  verification section. Leads with the fact that the cap fails open, not closed.
- `docs/SECURITY-FINDINGS.md` — every scanner finding on record and its disposition,
  organised by the twelve recurring classes.
- `docs/QUALITY-FINDINGS.md` — code-quality findings, plus the two gaps no scanner
  reports: no automated tests, and cap enforcement never exercised end-to-end.
- `docs/adr/` — eight architecture decision records, covering the decisions that look
  wrong without context: the stack-per-student split, the self-metered cap, name-based
  cross-stack wiring, the S3-loaded handler, the two identity modes, the two
  enforcement layers, Studio cleanup, and the runtime-configured console bundle.
- `docs/README.md` — documentation index and reading orders.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE` (MIT No
  Attribution) and this file.

### Fixed

- Seven caret-ranged dependencies in `app/package.json` pinned to the exact versions
  the lockfile already resolved (`@cloudscape-design/*` ×3, `@eslint/js`,
  `@types/node`, `@types/react`, `@types/react-dom`), and `package-lock.json`
  regenerated so `npm ci` stays in sync. No resolved version moved; `npm ci`,
  `npm run typecheck` and `npm run build` all pass. A fresh `npm install` without the
  lockfile can no longer drift onto a newer minor.

- `docs/cost-summary.html` claimed the default GPU was "20% cheaper per hour than the
  obvious alternative" without naming either machine. It now names `ml.g6.xlarge` and
  `ml.g5.xlarge`, quotes $1.1270 against $1.4100 per hour, and points at
  `docs/COSTING.md`, where the comparison already was.

- **Every successful "Add student" reported `Student <id> already exists`.** Cloudscape
  `Button` defaults to `formAction="submit"`, so inside the add form a single click both
  ran `onClick` and submitted the enclosing native `<form>` — two `POST /students` in the
  same millisecond. The first returned 202 and created the student; the second lost the
  backend's conditional claim and returned 409, and the flash rendered the loser. The
  student was created correctly every time, which is what made this read as a backend bug.
  Both buttons now carry `formAction="none"` — on Cancel it was worse than a bad message,
  since Cancel also submitted the form and could create the student it was meant to
  abandon — and `useCreateStudent` holds a `useRef` in-flight guard, because `loading`
  state cannot help when both calls run before React re-renders. Confirmed from the API
  access log on 2026-08-26: request `…SEw=` 202 and `…a1w=` 409, same second, same JWT.
- Corrected a false claim in both templates' comments: that a Space with no owner runs under
  the domain's default execution role. It does not. A Space created from a student's presigned
  URL reports `OwnerUserProfileName: null`, yet SageMaker acts as **that user profile's**
  execution role, so the domain default is not a fallback that covers a student. This matters
  because it sends you to the wrong role when diagnosing: the comments now say to read the
  principal out of the CloudTrail `CreateGrant` event rather than infer it from the Space
  record. Confirmed 2026-08-26 — `AccessDenied` on
  `assumed-role/gpu-guardian-<id>-exec-role`, `invokedBy: sagemaker.amazonaws.com`, for a
  Space whose owner read as `null`.
- `kms:CreateGrant` folded into `UseStorageEncryptionKey` and its
  `Bool: kms:GrantIsForAWSResource: true` condition **removed**, on both the domain and the
  per-student execution role. The condition was added as hardening on the first pass at the
  notebook fix and it denies the thing it was supposed to permit: it is not satisfied on the
  `CreateGrant` that SageMaker issues for a Space's EBS volume, so notebooks kept failing with
  the same `PermissionError` while the policy read as correct. The action set now matches what
  AWS documents for a SageMaker execution role against a customer-managed key. What bounds the
  unconditional `CreateGrant` is the trust policy — both roles are assumable only by
  `sagemaker.amazonaws.com`. `kms:ViaService` is not a substitute: the call reaches KMS through
  SageMaker and EC2, so pinning either breaks Space creation. Both templates now carry a
  comment saying not to re-add a condition without confirming a Space reaches `InService`.
- **A deleted student could never be re-added.** Their stack died at
  `StudentStudioCleanupLogGroup` with `"The specified log group already exists"`, which
  reads as leftover state from a botched teardown but is created by the teardown itself.
  Nothing ordered the log group against the function, so CloudFormation deleted the group
  *while* the cleanup function was still running its custom-resource `Delete`, and Lambda
  re-created it implicitly on the next line it wrote; the function was then deleted, leaving
  a log group no stack owned. Measured on 2026-08-26: group deleted 11:16:56.467, re-created
  11:16:59, function deleted 11:17:02. `DependsOn` on the two function/log-group pairs makes
  the group go last, when nothing is left to resurrect it. Note this was never a
  `DeletionPolicy: Retain` problem — neither group has one — so the fix is ordering, not
  retention. `StopStudioAppFunction` gets the same treatment: its race is narrower because
  it is invoked at the cap rather than at teardown, but a cap enforcement landing during a
  delete would strand its group just as permanently, and would surface much later as an
  unrelated-looking failure to re-add.
- **No notebook could start.** Adding the CMK gave the Studio domain a `KmsKeyId` but gave
  nothing permission to use it, so opening a space failed with `PermissionError: Unable to
  create EBS volume for Space … you don't have permissions to use the KMS key`. Neither
  `gpu-guardian-domain-role` nor the per-student execution roles carried any KMS action, and
  `PlatformKey`'s key policy only delegates to IAM, so there was no path to the key at all.
  Both roles now carry `kms:CreateGrant`/`Decrypt`/`DescribeKey`/`GenerateDataKey*` on
  `PlatformKey` — see the entry above for why that statement carries no condition; the first
  attempt at this fix split it in two and conditioned `CreateGrant`, which did not work.
  The per-student statements arrive through a new `StorageKmsKeyArn` parameter,
  published by the platform stack as `/gpu-guardian-admin/storage-kms-key-arn` and passed by
  the backend — the IAM `Resource` must be the key ARN, since an alias does not match. The
  student stack reaches `CREATE_COMPLETE` either way and the space is left in `Failed`, so
  without this the cost is paid by the student, in the lab, in front of everyone. Students
  provisioned before this change keep their old role and need a stack update to pick it up.
- Re-adding a student within five minutes of deleting them failed with `Student <id>
  already exists`. Deletion is asynchronous — it marks the record `DELETING` and returns
  202, and the record is only reaped by the next `stack_status_sync` tick — so for up to
  five minutes after the stack, user profile and login were all gone, the id read as
  taken. `api_add_student` now does that reap itself when the record says `DELETING` and
  the stack is genuinely absent, then retries the (still conditional) claim; if the
  teardown is in fact still running it says so and says to retry, rather than implying the
  id is burned. Observed on 2026-08-26: a delete at 08:50:03Z was not reaped until
  08:52:26Z, and every re-add in between was rejected.

### Changed

- **Both architecture diagrams rewritten from scratch.** They had drifted well past the
  point of patching: `sagemaker-gpu-guardian-complete.drawio` and
  `sagemaker-gpu-guardian-simple.drawio` still depicted the **AWS Budgets design that
  ADR-0002 replaced** — a per-student budget with an `APPLY_IAM_POLICY` action at 100%, a
  class-wide trimester pool budget, a `DeployPlatform` toggle and an `ExistingDomainId`
  parameter, none of which exist — and neither one drew the console-hosting path at all,
  so there was nowhere to put the WAF that prompted this. The new complete diagram covers
  the current platform: CloudFront with `FrontendWebAcl` in front of a private
  `FrontendBucket` over OAC, Cognito and the optional Identity Center federation, the HTTP
  API's JWT authorizer, the backend Lambda with all three DynamoDB tables, SSM,
  `PlatformKey`, the three EventBridge rules, SNS and the three CloudWatch alarms,
  `StudentStackDeployRole` into a per-student stack, and both enforcement layers numbered
  in the order they fire. The simple diagram now shows the five-minute self-metered loop
  rather than a budget action, and carries the two caveats — the overshoot and storage
  sitting outside the cap — plus the fail-silent warning.

  The rewrite also removed **a named individual** ("Zhang Jiahui's team", in a label and
  an annotation) and an institution name from the complete diagram. This repository is
  destined to be public, and neither belongs in it.

- `CKV_AWS_174` / `W70` re-justified in `SECURITY-FINDINGS.md` §15 and in the template's
  suppression reasons. The old reason — that CloudFront *rejects* a `ViewerCertificate`
  setting both `CloudFrontDefaultCertificate` and `MinimumProtocolVersion` — was wrong.
  CloudFront accepts the property and overrides the policy: with the default
  certificate it "automatically sets the security policy to TLSv1", which admits TLS
  1.0, 1.1, 1.2 and 1.3. So the finding is a **true positive**, now recorded as accepted
  with measured evidence rather than explained away, and both places warn against the
  no-op "fix" that silences the scanners while leaving TLS 1.0 negotiable. Also records
  that `execute-api` and the Cognito hosted UI — the two hosts that carry tokens and the
  admin password — reject TLS 1.0/1.1 outright, so the weak floor covers only public
  static assets; and the OpenSSL 3 `no protocols available` trap that makes the finding
  look like a false positive.
- `docs/DEPLOYMENT.md` step 1 corrected — the documented command **could not work**.
  The platform template is ~145 KB against CloudFormation's 51,200-byte inline cap,
  so neither `--template-body` nor `aws cloudformation deploy --template-file`
  (without `--s3-bucket`) accepts it; the failure is a `ValidationError` that echoes
  the whole template back rather than saying "too large". Step 1 now stages the
  template to S3 and uses `--template-url`, and names the three parameters that have
  no default. Found by deploying from scratch on 2026-08-26.
- `docs/DEPLOYMENT.md` teardown corrected — the claim that a later deploy would
  re-adopt the retained log groups was **wrong**, in the template comment and in the
  doc. `DeletionPolicy` governs deletion only; adopting an existing resource needs an
  explicit IMPORT change set. A `create-stack` into an account that still holds them
  fails at `AWS::EarlyValidation::ResourceExistenceCheck` before creating anything,
  so a redeploy must delete them first. Verified with a throwaway stack.
- `docs/DEPLOYMENT.md` gained a warning that `$STACK` is only an example name, and a
  command to list candidates. Pointing an update at the wrong stack surfaces as
  "attempting to import some resources because they already exist", which reads like
  a template bug rather than a typo — and did, once.
- The `# STOP.` block above `StudioDomain` and the matching passages in `SETUP.md`,
  `SECURITY-FINDINGS.md` §2/§11, `ARCHITECTURE.md`, `THREAT-MODEL.md` and
  `COSTING.md` rewritten: `KmsKeyId` is **create-only**, and adding it to a live
  domain does not replace the domain, it fails the update outright. "Accept the loss
  of the notebooks" was listed as an option and is not one.
- `docs/RUNBOOK.md` renamed to `docs/DEPLOYMENT.md` and rewritten around the actual
  deploy, operate and teardown sequences — including the manual EFS, ENI and NFS
  security-group cleanup that a Studio domain always leaves behind, and the forced cold
  start that a backend handler upload requires to take effect.
- Both CloudFormation templates given comprehensive `Description` fields and header
  comments describing what each stack builds, in what order, and what breaks if it is
  changed.
- Filenames removed from template comments and `Description` prose. Artifacts are now
  named by role ("the per-student template", "the backend handler") so that renaming a
  file does not falsify the documentation. The two `Default:` S3 keys still name files,
  because those are wired values rather than prose.
- `docs/COSTING.md`, `docs/ARCHITECTURE.md`, `docs/PROPOSAL.md` and `README.md` brought
  in line with the current design.
- `docs/PROPOSAL.md` no longer uses the two-syllable abbreviation for capital
  spend — prohibited by AWS Legal in customer-facing material regardless of
  context. Replaced with "upfront hardware investment". The prohibited terms
  themselves are deliberately not reproduced anywhere in this repository, including
  here; see `docs/SECURITY-FINDINGS.md` §14.
- `ManageStudentIdcIdentities` on `AdminBackendFunctionRole` scoped from
  `Resource: '*'` to four Identity Store ARNs, closing `CKV_AWS_111`. The previous
  suppression's stated reason — that the Identity Store API supports no resource
  ARNs — was simply wrong; it defines five resource types. The store itself is
  pinned to the `IdentityStoreId` parameter under an `!If [IsOrgInstance, …]` guard,
  because that parameter is empty in `ACCOUNT` mode and an unguarded `!Sub` would
  emit a malformed ARN. The `user/`, `group/` and `membership/` wildcards are not
  reducible — those ids are minted by IdC at call time. `W11` on the role was
  reworded: the two remaining wildcard statements are `ReadComputeStatus` and
  `EncryptAlertsAtRest`.
- `docs/SECURITY-FINDINGS.md` records a fourth and fifth scan, revises §2, §3, §9
  and §11 from "accepted" to "fixed", and now warns that some pipelines re-report
  every suppressed finding at `HIGH` because they do not read `Metadata`
  suppressions. Suppression counts corrected against the templates: 45 cfn_nag and
  21 checkov across 34 `Metadata` blocks.
- `docs/COSTING.md` re-derived for the KMS key and the log bucket — the control
  plane goes from $1.11 to $2.21/month at 100 students, of which $1.00 is the key.
  `README.md` and `docs/adr/0002-*` updated to match.
- `docs/ARCHITECTURE.md` gains a `### 0. Encryption` section and updates to §3, §6,
  §8 and §12–13; the immutability trade-off list now names `KmsKeyId` beside
  `AuthMode`.

### Removed

- `scripts/02-deploy-artifacts.sh`. A wrapper script that hid which AWS API calls a
  deployment actually makes; its content now lives in `docs/DEPLOYMENT.md` as raw
  `aws` CLI commands.

## 2026-08-26

### Added

- API Gateway access logging (`AdminHttpApiAccessLogGroup`).
- Three CloudWatch alarms on the admin backend function — errors, throttles and
  duration — notifying the SNS topic. These are the only detection that the metering
  job has stopped, and therefore that the cap has stopped existing.
- A dead-letter target on the admin backend function. Deliberately **not** added to the
  per-student stop-app function, where a dead-lettered invocation would mean a student
  recorded as `ON_HOLD` while their GPU is still running.
- Point-in-time recovery on all three DynamoDB tables.
- SNS at-rest encryption.
- `RetentionInDays` on every log group (30 / 90 / 365 depending on the group).
- Cloudscape `I18nProvider` wired up in `app/src/providers.tsx` with `locale="en"` and
  only the `en` message bundle imported, plus `<html lang="en">` and locale-aware
  currency and date formatting in the five tables that render dollars and dates.
- Inline `Metadata` suppressions with a written `reason:` on every remaining cfn_nag
  and checkov finding, and a `SECURITY-SCANNER TRIAGE` block above `Resources:` in each
  template explaining the recurring classes once. 47 cfn_nag suppressions and 29
  checkov skips across 31 `Metadata` blocks at the time (since reduced — see
  `[Unreleased]`); 14 of them are `W28`, where complying with the scanner would break
  the enforcement path.
- 77 `nosemgrep: jsx-not-internationalized` markers, placed at the exact line so the
  reason is visible to whoever next edits the string.

### Changed

- `MapPublicIpOnLaunch: false` on the public subnet.

### Removed

- `01-Sagemaker-Gpu-Platform.yaml` and `02-Sagemaker-Gpu-Admin.yaml`, both superseded
  by the current platform template. They contained an `AWS::Budgets::Budget` per
  student — the design replaced by the self-metered cap
  ([ADR-0002](docs/adr/0002-self-metered-cap-instead-of-aws-budgets.md)) — and
  accounted for roughly 90 of the 230 findings in the first scan.
- `context.md`.

## 2026-08-25

### Changed

- Costing corrected and re-derived from the AWS Price List API rather than estimated.

## 2026-08-19

### Added

- Initial commit: the platform and per-student CloudFormation templates, the admin
  backend handler, and the admin and student console.
