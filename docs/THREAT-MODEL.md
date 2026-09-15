# SageMaker GPU Guardian - Threat Model

Structured to the *Simplified AWS SA Threat Model* template. Every mitigation
claim names the file and mechanism implementing it, so a reviewer can confirm
rather than trust — verification commands are in [Appendix C](#appendix-c---verifying-these-claims).

## Introduction

### Purpose

University and training-lab GPU notebooks are the easiest way to lose control of
an AWS bill: a `ml.g5.xlarge` left running over a weekend costs more than the
coursework it produced. This asset gives each student their own SageMaker Studio
environment with a **hard dollar cap that is enforced without a human noticing
the breach** — metered every few minutes, and enforced by blocking new compute
*and* stopping compute already running.

The threat this system exists to stop is therefore not primarily an attacker. It
is a *legitimately authenticated student* whose incentive is to keep a GPU
running, plus the ordinary failure modes of a control plane that nobody is
watching. Neither is modelled by an IaC scanner —
[SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) covers what the scanners do see.

### Project/Asset Overview

Two CloudFormation templates, one Python handler, one static console
([ARCHITECTURE.md](ARCHITECTURE.md) has the full inventory):

| Component | Contents |
|---|---|
| `cloudformation/03-Sagemaker-Gpu-Platform-Base.yaml` | Deployed once. VPC (`PublicInternetOnly`, no NAT), KMS CMK, SageMaker Studio domain, Cognito user pool + groups, optional Identity Center federation, three DynamoDB tables (roster, usage ledger, alarm events), the backend Lambda, an HTTP API with a JWT authorizer and 14 routes, three EventBridge schedules, S3 + CloudFront + WAF console hosting, SNS alerting, three CloudWatch alarms. |
| `cloudformation/04-Sagemaker-Gpu-Student.yaml` | Deployed by the console once per student. That student's Studio execution role, UserProfile, `DenyNewAppsPolicy` (enforcement layer 1), `StopStudioAppFunction` (layer 2), and a delete-time Studio cleanup custom resource. |
| `scripts/01-admin-platform-api.py` | ~2,400-line Lambda handler: the 14 HTTP routes plus three scheduled jobs (`usage_sync`, `stack_status_sync`, `period_rollover`). Loaded from S3 at cold start because CloudFormation caps inline code at 4,096 characters, so re-uploading it **is** a code deploy. |
| `app/` | Vite + React SPA, one bundle for any deployment, configured at runtime from the unauthenticated `GET /init` route. Served from S3 via CloudFront. |

Third-party dependencies: the SPA's npm tree (React, Vite, ESLint) at build
time only; nothing third-party runs server-side — the handler uses `boto3` from
the Lambda runtime. Build and deploy are raw `aws` CLI commands
([DEPLOYMENT.md](DEPLOYMENT.md)); there are no wrapper scripts and no CI.

The cap is **self-metered** rather than delegated to AWS Budgets
([ADR-0002](adr/0002-self-metered-cap-instead-of-aws-budgets.md)): $0 instead of
$3.04/student/month, enforcement lag of minutes instead of ~12 hours, and the
accepted cost that it **fails silent rather than closed** (T-001).

### Assumptions

| ID | Assumption | Comments |
|---|---|---|
| A-01 | The asset is deployed into a **non-production** account for teaching purposes, with a synthetic or consenting cohort and no regulated data. | Several dispositions below (T-010, T-011, and the whole "no separation of duties" position) change if this is false. Severities are stated for both cases. |
| A-02 | The AWS account itself is trusted and properly governed: root is locked down, admins use MFA, CloudTrail is on account-wide. | Not created or verified by this asset. |
| A-03 | All external traffic is TLS 1.2+. | API Gateway HTTP APIs and CloudFront default to TLS 1.2+; `TemplatesBucketPolicy` denies non-TLS S3 requests. |
| A-04 | Whatever a student runs *inside* their notebook is out of scope. They have a Python kernel and internet egress; that is the product. | Bounded by their cap, not prevented. |
| A-05 | Under `ORGANIZATION` mode, the institution's directory hygiene (who is in the admin group) is the institution's responsibility. | Group membership comes from the customer's IdP sync, not from this template. |
| A-06 | AWS service-level vulnerabilities, and the physical/account security of AWS itself, are out of scope. | Standard shared-responsibility split. |
| A-07 | Admins are trusted. Admin authority is the trust anchor of the whole system. | There is no second approver and no separation of duties (T-014). |

### References

- **Code Repo:** `git@ssh.gitlab.aws.dev:ruvigh/sagemaker-gpu-guardian.git`
- **Project Team:** ruvigh
- **CSR Link:** _TBD - add once the CSR ticket exists_
- **SFDC Opportunity Link:** N/A (not a customer-specific asset)
- **Other documentation:** [ARCHITECTURE.md](ARCHITECTURE.md) ·
  [SETUP.md](SETUP.md) · [DEPLOYMENT.md](DEPLOYMENT.md) ·
  [COSTING.md](COSTING.md) · [SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) ·
  [QUALITY-FINDINGS.md](QUALITY-FINDINGS.md) · [ADRs](adr/)

## Solution Architecture

### Architecture Diagram

Source diagrams live in [diagrams/](diagrams/) (open the `.drawio` files at
[app.diagrams.net](https://app.diagrams.net)): `-complete` mirrors the resource
inventory, `-simple` is the one-page version. The numbered flow below is the
enforcement path, which is the part of the architecture this model exists for.

```
  admin browser ──1── CloudFront ──▶ S3 (console bundle)
        │
        └──2── HTTPS ──▶ HTTP API ──(JWT authorizer)──▶ AdminBackendFunction
                                                            │
   student browser ──3── IdC access portal tile (ORGANIZATION)
        └──────────── or presigned domain URL from GET /me/studio-url (ACCOUNT)
                                    │
                                    ▼
                          SageMaker Studio domain ──▶ per-student UserProfile
                                    │                       (StudentExecutionRole)
                                    │
  EventBridge ──4── usage_sync every SweepMinutes ──▶ AdminBackendFunction
                                    │
                       ListApps ──▶ accrue onto SESSION# row ──▶ price it
                                    │
                       add to PERIOD#<YYYY-MM> row (atomic ADD)
                                    │
                       if PERIOD total >= that student's budget:
                         5a. attach gpu-guardian-${StudentId}-deny-new-apps
                         5b. invoke gpu-guardian-${StudentId}-stop-app
                         5c. record ON_HOLD -- only if BOTH succeeded
```

Design patterns common to the whole system: every mutating action goes through
the one HTTP API and the one handler; authorization is a Cognito group claim
checked in handler code on every request; the two stacks are wired **by name,
not by `Ref`** ([ADR-0003](adr/0003-cross-stack-wiring-by-name.md)); everything
at rest that a scanner asks about is encrypted under a single CMK.

### Data Flow Diagrams

Steps 1–5 above are the two primary flows (admin control plane; metering and
enforcement). The trust boundaries they cross:

| # | Boundary | Crossed by |
|---|---|---|
| B1 | Browser → HTTP API | A Cognito JWT in the `Authorization` header, validated by an API Gateway JWT authorizer, then re-checked for group membership in handler code. |
| B2 | Student → their own Studio notebook | An IdC access-portal tile (`ORGANIZATION`) or a backend-minted presigned domain URL (`ACCOUNT`). |
| B3 | Notebook kernel → the rest of the AWS account | The per-student Studio execution role. This is the boundary that keeps one student's breach from touching anyone else. |
| B4 | Platform stack → per-student stacks | Not a `Ref`. Literal name patterns matched by `ArnLike` conditions. The weakest-looking boundary and the most load-bearing. |
| B5 | Scheduled jobs → reality | EventBridge rules invoking the backend. If this boundary is quiet, nothing is enforced and nothing says so. |

### Main Functionality/Use Cases of the Solution

1. **Provision a student.** An admin creates a roster entry with a per-student
   dollar cap and an instance tier; the backend assumes
   `StudentStackDeployRole` and creates that student's stack.
2. **Student works in a notebook.** The student signs in (IdC portal or Cognito),
   reaches Studio, and opens a GPU space.
3. **Meter and enforce.** `usage_sync` samples running apps every
   `SweepMinutes`, prices them, accrues to the period row, and on breach attaches
   the deny policy, stops running apps, and records `ON_HOLD`.
4. **Student self-service.** `GET /me`, `/me/usage`, `/me/studio-url` — their own
   status, spend-to-date, and a way in. No student route can name another student.
5. **Admin operations.** Raise a cap (which releases a budget hold), suspend,
   resume, terminate, and read the enforcement audit trail.
6. **Monthly reset.** Structural, not scheduled: spend is read from
   `PERIOD#<YYYY-MM>`, so on the 1st everyone is at zero. `period_rollover` only
   detaches last month's *budget* holds; manual suspensions survive.
7. **Teardown.** Delete the per-student stacks, then the platform stack, then the
   EFS/ENI/security-group orphans the Studio domain leaves behind (T-011).

### APIs

14 routes, one unauthenticated. Full table in [Appendix A](#appendix-a---apis).

### Assets/Dependency

| Asset Name | Asset Usage | Data Type | Comments |
|---|---|---|---|
| **The class budget** | The primary asset. Every threat here is ultimately about spending it. | Service data (financial) | Not a stored object — the thing all controls protect. Per-student caps in `StudentsTable`; optional notify-only `ClassPoolCapUsd`. |
| **The usage ledger** (`gpu-guardian-admin-usage-ledger`) | The `PERIOD#<YYYY-MM>` row **is** the enforced spend figure. Corrupt it and the cap is wrong in whichever direction the attacker chose. | Service data-at-rest | DynamoDB, PITR on, CMK-encrypted, TTL 120 days on `SESSION#` rows. |
| **Student notebook contents** | The Studio domain's home EFS filesystem. Coursework; irrecoverable if the domain is replaced. | Customer data-at-rest | Encrypted under `PlatformKey`. No backups configured (T-010). |
| **The enforcement path** | `DenyNewAppsPolicy`, `StopStudioAppFunction`, and the `ArnLike` name conditions that aim them. | Service data (control) | Aimed by literal name, not by `Ref` (T-002). |
| **The student roster** (`gpu-guardian-admin-students`) | Names, emails, per-student caps, status. Holds the **enforced** budget, so a cap change needs no stack update. | Customer data-at-rest (contact) | DynamoDB, PITR, CMK, GSI on `status`. |
| **The enforcement audit trail** (`gpu-guardian-admin-alarm-events`) | Record of every enforcement decision, surfaced by `GET /alarm-events`. | Service data-at-rest | DynamoDB, PITR, CMK. Detective control for T-006/T-014. |
| **Admin authority** | Membership of the admin group. Confers provisioning, cap changes, suspension and termination over the whole class. | Credential | Cognito group `gpu-guardian-admins`, or an IdC group under `ORGANIZATION`. |
| **Cognito JWTs and presigned Studio URLs** | Bearer credentials crossing B1 and B2. | Data-in-transit (credential) | JWTs validated by the API Gateway authorizer; presigned URLs short-lived and single-use. |
| **`PlatformKey`** (KMS CMK) | Encrypts the three tables and the home EFS. Load-bearing for recovery: schedule its deletion and every table and every PITR restore becomes useless. | Credential / key material | One key, rotation on, `PendingWindowInDays: 30` rather than the 7-day minimum. |
| **The handler artifact in S3** | `TemplatesBucket` holds `01-admin-platform-api.py`; the Lambda fetches it on cold start. Whoever can write it runs code as the backend role. | Service data-at-rest (code) | TLS-only bucket policy; write access identity-side only. |

## Threats & Mitigations

Severity is stated for the current deployment (a teaching lab in a non-production
account, synthetic cohort) and for a production/real-cohort deployment, because
several differ sharply. Mitigation IDs resolve in [Appendix B](#appendix-b---mitigations).

### Threat Actors

| Threat Actor # | Threat Actor Description |
|---|---|
| TA1 | A threat actor from the internet — unauthenticated, reaching CloudFront or the API's public endpoint. |
| TA2 | A **student** — legitimately authenticated, in the student group, with a Studio notebook and their execution role's credentials. The primary actor: motivated to keep a GPU running past their cap. Not necessarily malicious. |
| TA3 | A **maintainer/editor** with commit access to this repo. Includes the well-intentioned engineer who renames a resource or "fixes" a scanner finding, which is the likeliest cause of T-002 and T-004. |
| TA4 | An **admin** — the console's admin group. Can provision, raise caps, release holds, suspend and terminate. The trust anchor. |
| TA5 | An actor with account-admin or root credentials in the deploying AWS account. Out of scope by A-02. |

### Threat & Mitigation Detail

| Threat # | Priority | Threat | STRIDE | Affected Assets | Mitigations | Decision | Status/Notes |
|---|---|---|---|---|---|---|---|
| T-001 | **High** (lab: Medium; production: **Critical**) | The metering job stops — `UsageSyncRule` disabled, concurrency exhausted, IAM broken, or a handler that throws before `_enforce_breach` — and **nothing enforces anything**. No error reaches a student, no stack fails, no policy is attached; GPU hours accrue at full rate. No adversary required (TA3 or ordinary failure). | Denial of Service (of the control) | The class budget, the enforcement path | M-001, M-002, M-003, M-004, M-005 | **Accept** (with detection) | The design's central weakness, stated as such in every document. **This cap fails open, not closed** — the price of not paying AWS Budgets $0.10/action-enabled budget-day ([COSTING.md](COSTING.md) §4.1) and of being minutes rather than ~12 hours late. Every mitigation is detective, and every one of them is a notification: if nobody is subscribed to the SNS topic, or the address bounces, the system is uncapped and mute. **Subscribe to the alarms and confirm delivery, or do not claim a cap exists.** For a real cohort, add a coarse notify-only AWS Budgets budget as an independent backstop. |
| T-002 | **High** | Enforcement is aimed by literal name (`role/gpu-guardian-*-exec-role`, `policy/gpu-guardian-*-deny-new-apps`, `function:gpu-guardian-*-stop-app`). TA3 renames a resource — or lets CloudFormation generate a name, which is exactly what "fixing" cfn_nag `W28` would have you do — and the `ArnLike` conditions stop matching. **Deploys still succeed. IAM raises nothing. Enforcement just stops targeting anything.** | Tampering | The enforcement path | M-006 | **Accept** (structurally forced) | Students live in separate stacks, so there is no `Ref` to use across B4 ([ADR-0003](adr/0003-cross-stack-wiring-by-name.md)). Mitigated by documentation at every point of change. **Residual:** no test asserts the conditions match a real student's ARNs. A cap-drop test would catch it; none has run. |
| T-003 | **High** | TA2 keeps a notebook running after being suspended or held — "a stuck kernel over the weekend" is precisely the scenario the product exists for, and blocking *new* apps does nothing about compute already up. | Elevation of Privilege | The class budget | M-007, M-008, M-009 | **Mitigate** | Two independent layers by design ([ADR-0006](adr/0006-two-enforcement-layers.md)). `ON_HOLD` is recorded only if **both** succeeded, so the ledger never claims a student is stopped while their GPU is warm — which is why the stop function deliberately has no reserved concurrency and no DLQ. Design-verified only; the end-to-end cap-drop test has not run. |
| T-004 | **High** | TA3 narrows `DenyNewAppsPolicy`'s `Resource: '*'` to satisfy cfn_nag `W12`/`W11` or checkov `CKV_AWS_111`, and a held student launches from the app/space ARN shape that was forgotten. | Tampering, Elevation of Privilege | The class budget, the enforcement path | M-010 | **Accept** (marked do-not-touch) | It is a **Deny** statement; the wildcard *is* the security property — it must cover every app, space and *future* ARN shape a breached student could reach for. The suppression's own `reason:` reads *"MUST NOT BE NARROWED … the one finding in the report where complying would directly weaken the cost control."* Also [SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) §3. |
| T-005 | **High** (Critical if it succeeded) | TA2 escalates out of their notebook: reads or writes the ledger, detaches their own deny policy, or touches another student's profile. If the execution role could do any of that, every other control is theatre. | Elevation of Privilege, Tampering | The usage ledger, the enforcement path, the roster, admin authority | M-011, M-012, M-013 | **Mitigate** | One execution role **per student**, so the blast radius of any compromise is one student. Its only wildcard statements are read-only `List*`/`Describe*` actions copied from AWS's published Studio execution-role policy, for actions supporting no resource-level ARNs. No DynamoDB, no `iam:DetachRolePolicy`, no CloudFormation, no console. **Residual:** the deny policy is attached to the student's *own* role — a student who could call `iam:DetachRolePolicy` on themselves would self-unsuspend. They cannot, but this is the single most valuable thing to re-verify after any change to that role. |
| T-006 | **Medium** | The `PERIOD#<YYYY-MM>` row is poisoned so spend reads low — by a lost update between concurrent sweeps, a re-run that double- or under-counts, or a principal that should not be able to write it. | Tampering, Repudiation | The usage ledger | M-014, M-015, M-016, M-017 | **Mitigate** (one accepted gap) | No student-reachable principal has DynamoDB access at all. `add_to_period` uses an atomic `ADD` and returns the authoritative total; `lastSampledAt` makes the meter idempotent. **Accepted gap:** an admin can raise a cap (`PUT /students/{id}/budget`) and thereby release a hold. That is a feature — the alternative is a lecturer unable to grant an extension. Authorised and logged, not prevented, no second approver (T-014). |
| T-007 | **Medium** | Under `ACCOUNT` mode, TA2 shares or TA1 replays the presigned Studio URL from `GET /me/studio-url`. Whoever holds it during its validity window opens that student's Studio — their notebooks, and their budget. | Spoofing, Information Disclosure | Student notebook contents, the class budget | M-018, M-019 | **Mitigate** (partial; accepted for a teaching lab) | The route derives the profile from the caller's own token, never from a request parameter, and refuses outright while `status` is `SUSPENDED` or `ON_HOLD`. **Residual:** within the window the URL is a bearer credential. Cost impact is bounded by that student's own cap; the real exposure is their coursework. `ORGANIZATION` mode avoids this entirely — the student authenticates to IdC and no URL is minted. Prefer it where an organization instance exists ([ADR-0005](adr/0005-two-identity-modes.md)). |
| T-008 | **Low** | TA1 calls the one unauthenticated route, `GET /init`, to fingerprint the deployment or to reach the backend function without a token. Likelihood is High — the route is public by necessity. | Information Disclosure, Denial of Service | The roster (attempted), the backend | M-020, M-021 | **Mitigate** (by contract) | It has to be public: it is what the SPA calls to draw a login page before any token exists, and it is why one built bundle works against any deployment. Its route declaration carries no `AuthorizerId`, and `_dispatch_http` matches it **before any authorization check**. The response carries branding and public sign-in coordinates only — no per-student data, no counts, no roster; a hosted-UI client id is exposed to every browser anyway. **Residual:** it does fingerprint institution name and identity mode to an anonymous caller, and rate limiting on the API is the account default. |
| T-009 | **High** (Critical if exploited) | Authorization is enforced in handler code, not by the authorizer. The JWT authorizer proves only that the caller signed in — it says nothing about group. So a route added to the template (TA3) without a matching gated branch in `_dispatch_http` would be reachable by any authenticated caller, including TA2. | Elevation of Privilege, Spoofing | Admin authority, and everything downstream of it | M-022, M-023, M-024 | **Mitigate** (by ordering, fail-closed) | `_dispatch_http` is ordered so the default is closed: `GET /init` first, then `GET /whoami`, then the three `/me/*` routes gated on the *student* group (an admin is not in it and has no UserProfile, so those are deliberately closed to them), and **every remaining route falls through a single `if not auth.is_admin(event): return 403`**. A new admin route that forgets its own check still hits that gate; a route in the template with no branch returns 404, not an unauthorised success. `GET /whoami` derives `isAdmin`/`isStudent`/`landing` server-side, so the SPA cannot assert its way into the admin view. **Residual:** it is code, so it is only as good as review. No tests assert per-route gating ([QUALITY-FINDINGS.md](QUALITY-FINDINGS.md#the-real-quality-gap)) — the highest-value test to write first. |
| T-010 | **High** (lab: Medium; production: **Critical and irreversible**) | An operator changes `AuthMode` (via `IdentityCenterInstanceType`) or adds `KmsKeyId` to a live domain, replacing/destroying the Studio domain, every UserProfile in it, and the home EFS holding all coursework. | Denial of Service (destruction) | Student notebook contents | M-025, M-026 | **Accept** (documented; no technical guard) | `AuthMode` is immutable; `KmsKeyId` is create-only — adding it later does not replace the domain, it fails the update outright (the replacement collides on `DomainName`), so it must be decided before the first deploy. This is why `IdentityCenterInstanceType` has **no default**: there is no value that could safely be guessed. **Residual:** nothing prevents it. No stack policy, no `DeletionPolicy` on the domain, no EFS backups. On a lab this costs a rebuild; on a live cohort mid-trimester it destroys student work — add a stack policy denying updates to `StudioDomain` and take EFS backups before that is true. |
| T-011 | **Low** | Teardown leaves billable orphans: `AWS::SageMaker::Domain` has no CloudFormation property for EFS retention, so deleting the domain **always** leaves the home EFS filesystem, its mount-target ENI, and two SageMaker-created `security-group-for-*-nfs-*` groups — which then block subnet and VPC deletion with `DependencyViolation`. Likelihood High: it is the default outcome. | Denial of Service (cost), Information Disclosure | The class budget, student notebook contents | M-009, M-027 | **Mitigate** (documented, not automated) | `RetentionPolicy` is a raw `DeleteDomain` API parameter and setting it as a resource property fails validation. Full discover-and-delete sequence in [DEPLOYMENT.md](DEPLOYMENT.md#2-clean-up-what-the-studio-domain-leaves-behind), including revoking the two NFS groups' cross-referencing rules first. **Residual:** an operator who deletes the platform stack and walks away pays for an orphaned EFS indefinitely — and, since it holds the notebooks, may be retaining data they believe they deleted. |
| T-012 | Low | TA2 runs anything they like inside their notebook — crypto mining, scanning, data exfiltration to the internet through the IGW. | Elevation of Privilege, Information Disclosure | The class budget | None | **Accept** | Out of scope by A-04: they have a Python kernel and internet egress, and that is the product. Bounded by their cap, not prevented. `AppNetworkAccessType` is `PublicInternetOnly` (the cheap topology, not the locked-down one); moving to `VpcOnly` is the lever if this ever matters. |
| T-013 | Low | TA2 burns their entire cap in one sitting, or across many parallel notebooks. | Denial of Service (self) | The class budget | M-028 | **Accept** | The cap is on dollars, not on session count or pace. More notebooks burn the same cap faster, they do not exceed it. `InstanceType`'s `AllowedValues` list is the only tier control. |
| T-014 | Medium | TA4 abuses admin authority: raises caps to release holds, resumes a suspended student, or terminates a cohort. | Elevation of Privilege, Repudiation | Everything | M-017 | **Accept** | Admin authority is the trust anchor (A-07). There is no second approver and no separation of duties. Every enforcement and admin decision is written to the alarm-events audit trail, and AWS API calls are in the account's CloudTrail — detection only. |
| T-015 | Low | PII lands in notebooks or the roster and is neither classified nor scrubbed. | Information Disclosure | Student notebook contents, the roster | M-026 | **Accept** | Non-production, synthetic cohort only (A-01). Roster fields are name/email; both tables are CMK-encrypted with PITR. If a real cohort is onboarded, this needs a decision rather than an acceptance. |
| T-016 | Medium | TA3 or a compromised deploy pipeline overwrites `scripts/01-admin-platform-api.py` in `TemplatesBucket`; the next cold start runs it as the backend role. Re-uploading the handler **is** a code deploy, with no stack update and no review gate. | Tampering, Elevation of Privilege | The handler artifact, and every asset the backend role reaches | M-029 | **Accept** | Consequence of [ADR-0004](adr/0004-handler-loaded-from-s3.md) (CloudFormation's 4,096-character inline-code cap vs a ~2,400-line handler). Write access to the bucket is identity-side and admin-only, the bucket is TLS-only and access-logged, and S3 data events plus the alarm-events trail are the detection. There is no artifact signing and no version pinning. |

## APPENDIX A - APIs

One HTTP API (`AdminHttpApi`), one Lambda proxy integration, a `$default` stage
with `AutoDeploy: true`, and a JWT authorizer against the Cognito user pool on
13 of the 14 routes. All are callable from the internet. "Authorized Callers" is
enforced **in handler code** from the group claim (T-009), not by the authorizer.

| API | Method | Status | Mutating/Non-Mutating | Functionality | Callable from Internet | Authorized Callers | Comments |
|---|---|---|---|---|---|---|---|
| `/init` | GET | In scope | Non-Mutating | Branding and public sign-in coordinates (Cognito domain, client id, identity mode) so one bundle configures itself at runtime. | Yes | **Anyone (unauthenticated)** | The only route with no `AuthorizerId`; matched before any authorization check. `Cache-Control: public, max-age=300`. T-008. |
| `/whoami` | GET | In scope | Non-Mutating | Returns `isAdmin`/`isStudent`/`landing`, derived server-side from the group claim. | Yes | Any authenticated caller | Neither admin- nor student-gated by design. M-024. |
| `/platform-info` | GET | In scope | Non-Mutating | Deployment metadata for the admin console. | Yes | Admin group | |
| `/students` | GET | In scope | Non-Mutating | List the roster with status and spend. | Yes | Admin group | |
| `/students/{studentId}` | GET | In scope | Non-Mutating | One student's detail. | Yes | Admin group | |
| `/students` | POST | In scope | **Mutating** | Provision a student: roster entry, then a per-student stack created under `StudentStackDeployRole`. | Yes | Admin group | The console never holds the deploy permissions directly. |
| `/students/{studentId}` | DELETE | In scope | **Mutating** | Terminate a student: delete their stack (Studio cleanup custom resource stops apps and deletes spaces first). | Yes | Admin group | Irreversible for that student's spaces. |
| `/students/{studentId}/budget` | PUT | In scope | **Mutating** | Change the enforced cap. Raising it above current spend releases a budget hold. | Yes | Admin group | The accepted gap in T-006 / T-014. No second approver. |
| `/students/{studentId}/suspend` | POST | In scope | **Mutating** | Manual suspension: attach the deny policy and stop running apps. | Yes | Admin group | Survives the month boundary, unlike a budget hold. |
| `/students/{studentId}/resume` | POST | In scope | **Mutating** | Detach the deny policy and clear the hold. | Yes | Admin group | |
| `/alarm-events` | GET | In scope | Non-Mutating | The enforcement audit trail. | Yes | Admin group | Detective control for T-006/T-014. |
| `/me` | GET | In scope | Non-Mutating | The caller's own status and cap. | Yes | Student group | Derived from the token; cannot name another student. |
| `/me/usage` | GET | In scope | Non-Mutating | The caller's own spend to date, honest to `lastSampledAt`. | Yes | Student group | |
| `/me/studio-url` | GET | In scope | **Mutating** (mints a credential) | A presigned domain URL for the caller's **own** UserProfile. `ACCOUNT` mode only in practice. | Yes | Student group | Refuses while `SUSPENDED`/`ON_HOLD`. T-007. |

Internal (non-API) invocation paths, for completeness: three EventBridge
schedules invoke the same function with `{"job": ...}` payloads —
`usage_sync` (`rate(${SweepMinutes} minutes)`), `stack_status_sync`
(`rate(5 minutes)`), `period_rollover` (`rate(1 hour)`). They are not reachable
from the internet; `_dispatch_job` is a separate dispatcher from `_dispatch_http`.

## APPENDIX B - Mitigations

| Mitigation Number | Mitigation Description | Threats Mitigating | Status | Related BSC | Comments |
|---|---|---|---|---|---|
| M-001 | Three CloudWatch alarms on the backend function — `gpu-guardian-admin-backend-errors`, `-throttles`, `-duration` — notifying `NotificationEmail` via SNS. `BackendErrorsAlarm` sets `TreatMissingData: breaching`, so **silence is also an alarm**. | T-001 | Complete | Monitoring/alerting | Detective, not preventive. Useless if nobody confirms the subscription. |
| M-002 | `SweepMinutes` (default 5, `MinValue: 2`) bounds how stale the meter can be. | T-001 | Complete | | `MinValue` is 2 because EventBridge requires singular `rate(1 minute)` and the template builds the plural form. |
| M-003 | The handler's `MISSING_ENV` preflight refuses to start rather than run half-configured. | T-001 | Complete | | Fail-closed at startup; does not help once running. |
| M-004 | Dead-letter target (`AdminAlertsTopic`) on the backend function, so a failed job invocation is not lost silently. | T-001 | Complete | | |
| M-005 | Runbook: confirm `UsageSyncRule` is `ENABLED` and recent invocations succeeded — [DEPLOYMENT.md](DEPLOYMENT.md#checking-the-meter-is-actually-running). | T-001 | Complete | | Manual. |
| M-006 | `NAMES ARE LOAD-BEARING` block in the per-student template header; a `SECURITY-SCANNER TRIAGE` block explaining `W28` as the one class where complying breaks the control; a `reason:` on each of the 14 `W28` suppressions; [ARCHITECTURE.md § Names are load-bearing](ARCHITECTURE.md#names-are-load-bearing); [ADR-0003](adr/0003-cross-stack-wiring-by-name.md). | T-002 | Complete | | Documentation only — the boundary is structurally unenforceable across separate stacks. |
| M-007 | Enforcement layer 1: `DenyNewAppsPolicy` denies `sagemaker:CreateApp`, `CreateSpace`, `UpdateSpace`. Layer 2: `StopStudioAppFunction` deletes the student's `InService`/`Pending` apps. Independent mechanisms, different jobs. | T-003 | Complete | | Layer 1 alone cannot touch a running notebook, which is the whole cost. |
| M-008 | `_enforce_breach` writes `ON_HOLD` only if **both** layers succeeded, checking the invoke result; the stop function therefore has no reserved concurrency and no DLQ. | T-003 | Complete | | A silently-queued retry would let the platform record a hold that never happened ([ADR-0006](adr/0006-two-enforcement-layers.md)). |
| M-009 | `Delete*` deliberately **absent** from the deny policy, so a held student — and teardown — can still tidy up. | T-003, T-011 | Complete | | |
| M-010 | The `Resource: '*'` suppression carries its own do-not-narrow `reason:`, repeated in [SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) §3 and the per-student `TRIAGE` block. | T-004 | Complete | | |
| M-011 | One Studio execution role **per student**, in a per-student stack. | T-005 | Complete | Least privilege | The blast radius of any notebook compromise is one student. |
| M-012 | Execution-role least privilege: no DynamoDB, no `iam:DetachRolePolicy`, no CloudFormation, no console; wildcards limited to read-only `List*`/`Describe*` actions from AWS's published Studio policy that support no resource-level ARNs. | T-005 | Complete | Least privilege | Re-verify after **any** edit to this role. |
| M-013 | `DeleteApp`/`DeleteSpace` grants on the enforcement functions scoped by profile ARN and `OwnerUserProfileArn`, not by wildcard. | T-005 | Complete | | |
| M-014 | No student-reachable principal has DynamoDB access; only `AdminBackendFunctionRole` does. Tables are CMK-encrypted (`SSEType: KMS`) with PITR. | T-006 | Complete | Encryption at rest | Omitting `KMSMasterKeyId` would silently select the AWS-managed key. |
| M-015 | `add_to_period` uses an atomic DynamoDB `ADD` and returns the authoritative total, so concurrent sweeps cannot lose an update or act on a stale read. | T-006 | Complete | | |
| M-016 | `SESSION#` rows carry `lastSampledAt`, making the meter idempotent: a job that runs twice, or late, accrues the delta once. | T-006 | Complete | | Also why the portal reports "counted up to `lastSampledAt`" rather than an "ended at" the platform cannot know. |
| M-017 | Every enforcement and admin decision is written to `gpu-guardian-admin-alarm-events` and surfaced by `GET /alarm-events`; AWS API calls land in the account's CloudTrail. | T-006, T-014, T-016 | Complete | Audit logging | Detection only; no prevention, no second approver. |
| M-018 | `GET /me/studio-url` derives the UserProfile from the caller's own token (never a request parameter), refuses while `SUSPENDED`/`ON_HOLD`, and returns a short-lived single-use URL the SPA is instructed to redirect to rather than store. | T-007 | Complete | | |
| M-019 | Prefer `ORGANIZATION` identity mode where an IdC organization instance exists — the student authenticates to IdC and no URL is minted at all. | T-007 | Deployment choice | | The live deployment is an *account* instance, so `ACCOUNT` mode and presigned URLs are in force there ([ADR-0005](adr/0005-two-identity-modes.md)). |
| M-020 | `GET /init` returns branding and public sign-in coordinates only — nothing per-student, no counts, no roster — with `Cache-Control: public, max-age=300`. | T-008 | Complete | | The client id is public by construction. |
| M-021 | `FrontendWebAcl` in front of CloudFront: `AmazonIpReputationList`, `CommonRuleSet`, `KnownBadInputsRuleSet`, and a rate-based rule at 2,000 requests/IP/5 min. API throttling is the API Gateway account default. | T-008 | Partial | Edge protection | **The WAF is not the authorization boundary** — the API is reached directly, so it never sees a token-bearing request. It is also gated on an `InUsEast1` condition: deploy outside us-east-1 and the console has no WAF, silently ([SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) §20). |
| M-022 | API Gateway JWT authorizer against the Cognito user pool on 13 of 14 routes. | T-009 | Complete | Authentication | Proves sign-in only; says nothing about group. |
| M-023 | `_dispatch_http` is ordered fail-closed: public route first, `/whoami`, then student-gated `/me/*`, then **a single fall-through `if not auth.is_admin(event): return 403`** covering every remaining route. An unmatched route returns 404, not an unauthorised success. | T-009 | Complete | Authorization | The one gate a forgetful new admin route still hits. |
| M-024 | `GET /whoami` derives `isAdmin`/`isStudent`/`landing` server-side from the group claim, and every admin route re-checks independently. | T-009 | Complete | | The SPA cannot assert its way into the admin view. |
| M-025 | `IdentityCenterInstanceType` has **no default**; [SETUP.md § What you cannot change later](SETUP.md#what-you-cannot-change-later); the root README's getting-started leads with it. | T-010 | Complete | | Documentation only — nothing technically prevents the destructive update. |
| M-026 | `PlatformKey` CMK with rotation on and `PendingWindowInDays: 30` (not the 7-day minimum); PITR on all three tables; home EFS encrypted under the same key. | T-010, T-015 | Complete | Encryption at rest | The key is load-bearing for recovery: schedule its deletion and every table, every PITR restore, and the home EFS become unrecoverable. |
| M-027 | Teardown runbook: discover and delete the orphaned EFS filesystem, mount-target ENI and two NFS security groups, revoking their cross-referencing rules first — [DEPLOYMENT.md](DEPLOYMENT.md#2-clean-up-what-the-studio-domain-leaves-behind). Three custom resources empty the buckets so `DeleteStack` does not stall. | T-011 | Complete | | Manual and not optional. |
| M-028 | `InstanceType`'s `AllowedValues` list in the per-student template is the tier control; the per-student cap is the dollar control. | T-013 | Complete | | Caps pace only indirectly. |
| M-029 | Write access to `TemplatesBucket` is identity-side and admin-only; `TemplatesBucketPolicy` denies non-TLS requests; server access logs go to `LogsBucket` (90-day lifecycle). | T-016 | Partial | Data protection in transit | No artifact signing, no version pinning, no review gate on a handler re-upload. |

## APPENDIX C - Verifying These Claims

```bash
# T-002 — the ArnLike name conditions enforcement depends on.
grep -n "ArnLike" -A4 cloudformation/03-Sagemaker-Gpu-Platform-Base.yaml | grep "gpu-guardian-"

# T-002 — every W28 suppression, with the reason travelling with it.
grep -n "id: W28" -A1 cloudformation/*.yaml

# T-003 — the hold is written only if both enforcement layers succeeded.
grep -n "_enforce_breach" -A40 scripts/01-admin-platform-api.py | grep -in "ON_HOLD\|invoke\|status"

# T-003/T-004 — Delete* is absent from the deny policy; the wildcard is deliberate.
grep -n "DenyNewAppsPolicy" -A30 cloudformation/04-Sagemaker-Gpu-Student.yaml

# T-005 — the student execution role's only wildcards are read-only List*/Describe*.
grep -n "StudentExecutionRole" -A80 cloudformation/04-Sagemaker-Gpu-Student.yaml | grep -n "Resource: '\*'" -B8

# T-006 — the atomic ADD that makes the period total authoritative.
grep -n "add_to_period" -A20 scripts/01-admin-platform-api.py

# T-006 — lastSampledAt is what makes re-running the meter safe.
grep -n "lastSampledAt" scripts/01-admin-platform-api.py

# T-007 — the profile comes from the caller's own token, and suspension refuses.
sed -n '/def api_my_studio_url/,/^def /p' scripts/01-admin-platform-api.py

# T-008 — GET /init is matched before any authorization check, and carries no authorizer.
grep -n "GET /init" -A6 scripts/01-admin-platform-api.py
grep -n "InitRoute" -A8 cloudformation/03-Sagemaker-Gpu-Platform-Base.yaml

# T-009 — the single fall-through admin gate, and what sits above it.
sed -n '/def _dispatch_http/,/def _dispatch_job/p' scripts/01-admin-platform-api.py

# T-010 — AuthMode is driven by IdentityCenterInstanceType, which has no default.
grep -n "IdentityCenterInstanceType" -A12 cloudformation/03-Sagemaker-Gpu-Platform-Base.yaml | head -20

# T-001 — is the meter actually running right now?
aws events describe-rule --name gpu-guardian-admin-usage-sync --query 'State'
```

## APPENDIX D - Did We Do a Good Job? Revisit Triggers

The honest answer today: the *design* is modelled and documented; the
*enforcement* has never been exercised end to end. T-001, T-003 and T-009 are
design claims, not observations. Re-read this document — and update this
appendix — if any of these change:

1. **The cap-drop test finally runs.** Most of T-001 and T-003 becomes
   observation rather than design, and the result belongs here.
2. **A route is added to the HTTP API.** T-009's fall-through gate is the only
   thing protecting it, and no test asserts per-route gating
   ([QUALITY-FINDINGS.md](QUALITY-FINDINGS.md#the-real-quality-gap)).
3. **Anyone edits the student execution role, `DenyNewAppsPolicy`, or the backend
   role's `ArnLike` conditions.** T-002, T-004 and T-005 all key off those.
4. **`AppNetworkAccessType` moves from `PublicInternetOnly` to `VpcOnly`.**
   T-005's and T-012's blast radius and the `W60` flow-log disposition all shift.
5. **The platform starts holding real coursework or a real cohort.** A-01 is
   invalidated: T-010, T-011 and T-015 move from "documented" to "must be
   prevented", and T-014's lack of separation of duties needs a decision.
6. **The deployment moves out of us-east-1**, or the pricing table it meters
   from changes — the WAF disappears silently (M-021) and the meter's rates go
   stale.
