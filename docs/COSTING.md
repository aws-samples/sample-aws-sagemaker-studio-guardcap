# SageMaker GPU Guardian — Cost Report

What it costs to run the platform, and what each student adds. All rates are
us-east-1 on-demand list prices pulled from the AWS Price List API on
**2026-08-24**. Nothing here is estimated from memory — see
[How to re-derive these numbers](#how-to-re-derive-these-numbers).

**Sized for a class of 100.** Smaller classes are shown in
[The one table](#the-one-table); every other section works the 100-student case,
because that is the scale the platform is being planned at.

For what the resources are, see [ARCHITECTURE.md](ARCHITECTURE.md); for what has
to exist first, [SETUP.md](SETUP.md); for how they get deployed,
[DEPLOYMENT.md](DEPLOYMENT.md). A one-page non-technical version is in
[cost-summary.html](cost-summary.html).

> **The deployment is `03-Sagemaker-Gpu-Platform-Base.yaml` +
> `04-Sagemaker-Gpu-Student.yaml`, and nothing else.** Templates 01 and 02 are
> superseded — 03 is 01 + 02 merged into a single stack — and are not deployed,
> not costed here, and not a supported path.
>
> **AWS Budgets is not part of this design. There is no Budgets cost in any
> figure in this document.** Enforcement is self-metered: the backend prices
> running Studio apps every five minutes into a DynamoDB ledger and attaches the
> deny policy itself. That mechanism **is** costed here — see
> [§4.1](#41-enforcement-cost) — and it is what takes per-student standing cost
> from $3.60 to $0.56.
>
> Verified in a live deployment account on 2026-08-25, not merely intended:
> `budgets describe-budgets` returns **no budgets**, no live IAM policy grants
> any `budgets:*` action, and neither deployed template declares an
> `AWS::Budgets::Budget`. The $3.04/student/month Budgets would have cost is
> priced in [§4.1](#41-enforcement-cost) as a **rejected** alternative, to show
> what the current design is worth — never as a line item.

---

## The one table

Monthly cost in USD, us-east-1, on-demand. **Standing cost** is what you pay
with every notebook stopped. **Usage** assumes each student runs an
`ml.g6.xlarge` for 26 hours/month (~6 h/week).

| Class size | Platform | Space storage | **Standing total** | **Per student** | Usage @ 26 GPU-hr each | **All-in** |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | $10.42 | $0.56 | **$10.98** | **$10.98** | $29.30 | **$40.28** |
| 5 | $10.47 | $2.80 | **$13.27** | **$2.65** | $146.51 | **$159.78** |
| 10 | $10.57 | $5.60 | **$16.17** | **$1.62** | $293.02 | **$309.19** |
| 30 | $10.77 | $16.80 | **$27.57** | **$0.92** | $879.06 | **$906.63** |
| **100** | **$11.23** | **$56.00** | **$67.23** | **$0.67** | **$2,930.20** | **$2,997.43** |

**Read it as:** the shared platform and the per-student scaffolding are both
free to a rounding error at class scale. **Essentially 100% of the bill is GPU
hours students actually consume** — $2,930 of the $2,997 at 100 students, or
97.8%.

The platform line is **not** flat with headcount — both sweeps do per-student
work — but the slope is about **one cent per student per month**. At 100
students the entire control plane is $11.23, and $10.02 of that is two fixed
charges that do not scale with headcount at all: **$9.02 for the WAF in front of
the admin console** and $1.00 for a single KMS key. That is why the platform
column barely moves between one student and a hundred, and why it dominates the
standing total for a small class: at one student the WAF is 87% of the platform
bill. There is no per-student overhead worth optimising. Control the GPU hours
and you control the bill.

---

## Method and assumptions

| | |
|---|---|
| Region | us-east-1 |
| Class size | 100 students unless stated otherwise |
| Pricing model | On-demand list price. No Savings Plans, Reserved Instances, EDP/PPA discount, or credits |
| Month | 730 hours / 30.4 days |
| Tax | Excluded |
| Free tiers applied | Only the **perpetual** ones: CloudFront (1 TB out + 10 M requests), Cognito Essentials (10,000 MAU), DynamoDB (25 GB storage), CloudWatch Logs (5 GB ingest) |
| Free tiers **not** relied on | The 12-month new-account tiers for Lambda and API Gateway. Those line items are shown at full price |
| Templates costed | `03-Sagemaker-Gpu-Platform-Base.yaml` (shared) + `04-Sagemaker-Gpu-Student.yaml` (per student). 01 and 02 are superseded and excluded |
| Excluded by design | AWS Budgets — not deployed. See the note at the top |
| Sweep interval | 5 minutes (`SweepMinutes` default). This is the main driver of the platform's Lambda and DynamoDB lines |
| Priced from | Live `pricing:GetProducts` against this account, plus the Cognito pricing page for the free-tier rule the Price List API does not express |

### Measured, not modelled

The platform lines below were **corrected against live CloudWatch and service
metadata in a deployed platform on 2026-08-25**, not derived by reading the
sweep code and multiplying. What the measurement changed:

| Check | Measured result | Effect on this document |
|---|---|---|
| DynamoDB billing mode | Both tables `PAY_PER_REQUEST` | Per-request pricing is the correct model |
| `ConsumedWriteCapacityUnits` on `students`, three consecutive idle hours | **0.0, 0.0, 0.0 WRU/hour** | **Corrected a ~7× overstatement.** The sweeps do not rewrite records when nothing changed. Writes track *usage*, not headcount |
| `ConsumedReadCapacityUnits`, same hours | 30.0 RRU/hour at 1 student | Confirms the read line; extrapolates to ~$0.28/mo at 100 |
| Backend Lambda `REPORT` durations | 450 ms and 790 ms for the two sweeps at 1 student, 127 MB of 256 MB used | Confirms the Lambda line and the memory setting |
| `describe-alarms` | **0 alarms**; no `put_metric_data`, `put_metric_alarm` or metric filter anywhere in the code or templates | Confirms $0.00 — the §4.1 alarm option was rejected, not quietly deployed |
| `describe-nat-gateways`, `describe-vpc-endpoints`, `describe-addresses` | **All empty** | Confirms the $0.00 network line |
| SageMaker domain | `AppNetworkAccessType: PublicInternetOnly`, EFS 12 KB, `bursting` throughput | Confirms $0.00 network and no provisioned-throughput charge |
| Cognito user pool | `ESSENTIALS` tier, 100 of 10,000 free MAU | Confirms $0.00 |
| CloudFront distribution | `PriceClass_All`, no logging, no CloudFront Functions, **no WAF** | Confirmed $0.00 *as measured*. Standard logging and a WAF were both added after this measurement — the WAF is the $9.02 line in §1 and is the one platform figure below that is derived from list price rather than measured |
| KMS, Secrets Manager, Route 53 | No customer-managed keys, no secrets, no hosted zones | Three lines that did not need to exist |

---

## 1. Platform — shared monthly cost at 100 students

Everything in `03-Sagemaker-Gpu-Platform-Base.yaml`. Shared across the whole
class.

| Resource | Rate | Usage at 100 students | Monthly |
|---|---|---|---:|
| VPC, subnet, internet gateway, route table | — | No NAT gateway, no VPC endpoint, no Elastic IP — all verified absent | $0.00 |
| SageMaker Studio domain | No charge for the domain itself | 1 domain | $0.00 |
| └ domain EFS filesystem | $0.30/GB-mo Standard, `bursting` | 12 KB live | $0.00 |
| Backend Lambda (256 MB) | $0.20/M requests + $0.0000167/GB-s | 8,760 metering + 8,760 stack-sync + 730 rollover + ~30,000 API ≈ 48,000 invocations, ≈42,000 GB-s | $0.71 |
| Bucket-cleanup Lambda (512 MB) | Same | Teardown only — 0 invocations/mo | $0.00 |
| 3 × DynamoDB table (`PAY_PER_REQUEST`) — reads | $0.125/M RRU | ~3,120 RRU/hour → 2.28 M RRU/mo | $0.28 |
| └ writes | $0.625/M WRU | ~63 k WRU/mo — samples for running apps and real status changes only | $0.05 |
| └ storage | 25 GB free | Kilobytes | $0.00 |
| API Gateway HTTP API | $1.00/M requests | ~30,000 requests/mo | $0.03 |
| CloudFront distribution | 1 TB out + 10 M requests/mo free, perpetual | An admin SPA + 100 student sessions | $0.00 |
| 3 × S3 bucket | $0.023/GB-mo | SPA bundle + templates ≈ 10 MB, plus access logs expiring at 90 days | $0.00 |
| └ S3 + CloudFront access-log delivery | $0.005/1,000 PUT | One log object per bucket per few minutes of activity | $0.01 |
| **AWS WAF web ACL** (`FrontendWebAcl`) | **$5.00/web-ACL-mo + $1.00/rule-mo** | 1 web ACL + 4 rules: three AWS managed rule groups and one rate-based rule | **$9.00** |
| └ WAF request charge | $0.60/M requests | ~30,000 console requests/mo | $0.02 |
| **KMS customer-managed key** (`PlatformKey`) | **$1.00/key-mo** | 1 key, covering the domain's home EFS and all three tables | **$1.00** |
| └ KMS requests | $0.03/10,000 | DynamoDB refreshes its table key every ~5 min of activity, ×3 tables | $0.09 |
| Cognito user pool (ESSENTIALS) | 10,000 MAU/mo free, then $0.015/MAU | 100 MAU | $0.00 |
| SNS admin-alerts topic | $2.00/100 k emails; 1,000/mo free | A handful | $0.00 |
| 4 × CloudWatch log group | $0.50/GB ingest, $0.03/GB-mo storage; 5 GB/mo free | ~290 MB/mo ingest (the consumption audit dominates; WAF logs add ~30 MB); ~1.6 GB retained at steady state on 365-day retention | $0.04 |
| Cost Anomaly Detection monitor + subscription (optional) | Free | — | $0.00 |
| 7 × SSM Parameter (Standard) | Free | — | $0.00 |
| Identity Center group / permission set / assignment | Free | — | $0.00 |
| | | **Platform total at 100 students** | **$11.23** |

**The single biggest line is the WAF**, at $9.02 of an $11.23 total — 80% of the
control plane, and four times everything else in this table put together. It is
fixed: $5.00 for the web ACL and $1.00 for each of the four rules, whether one
student uses the console or a hundred. What it buys is three AWS managed rule
groups and a per-IP rate limit in front of a static SPA whose contents are public;
it is **not** the authorization boundary, which is still the JWT authorizer on the
API. This was added deliberately with the cost accepted — see
[SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) §20 for what it does and does not
protect. If you want the control plane back under $3, deleting `FrontendWebAcl`,
its log group, its logging configuration and the `WebACLId` line on the
distribution is a clean reversal with no data loss; you get `CKV_AWS_68` back.
Note that the ACL only exists in us-east-1 at all, so a deploy elsewhere pays
$2.21 and has no WAF.

**The second biggest is the KMS key**, at $1.00 — likewise fixed, and it buys no
capability, only a clean scanner report on `CKV_AWS_119` and `CKV_AWS_187`. It is
one key rather than four deliberately; four would have been $4.00. If a
customer-managed key is not a requirement for your deployment, deleting
`PlatformKey` and reverting the three tables to `SSEEnabled: true` with no
`SSEType` removes it. Note that the same is **not** true of the Studio domain:
`KmsKeyId` cannot be removed from a live domain at all — the update fails rather
than replacing it, so dropping the key means rebuilding the domain. See
[SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) §2.

**How it scales.** Reads grow with headcount because both sweeps read every
student record each tick; writes do not, because a record is only written when
something actually changed. The result is a slope of roughly **$0.01 per
student per month**:

| Class size | 1 | 5 | 10 | 30 | 100 |
|---|---:|---:|---:|---:|---:|
| Platform total | $10.42 | $10.47 | $10.57 | $10.77 | **$11.23** |

The $9.02 of WAF and $1.09 of KMS are present in every column, which is why the
slope is now almost invisible: at one student they are 97% of the platform bill,
at 100 still 90%. The variable part of the control plane — Lambda, DynamoDB, API
Gateway, logs — is $1.12 at 100 students.

Self-metering is what put most of this on the bill — the sweep went from every
20 minutes to every 5, and now writes as well as reads. **That growth replaces
$3.04/student/month**: at 100 students, under $1 in place of $304. Raising
`SweepMinutes` to 10 would roughly halve the Lambda and read lines and double
the worst-case overshoot; at these absolute numbers that is not a trade worth
making.

### Why it is this cheap

Two template decisions do the work, and both are worth defending in review:

- **`AppNetworkAccessType: PublicInternetOnly`** — notebooks egress through
  AWS's managed Studio network rather than yours. A `VpcOnly` domain would need
  interface VPC endpoints for SageMaker API, SageMaker runtime, STS, S3 and
  CloudWatch, at roughly $7.30/mo each per AZ, plus per-GB processing.
- **No NAT gateway** — a private-subnet design would add ~$33/mo per AZ plus
  $0.045/GB processed, before any traffic.

Together those two choices are the reason the network line is $0.00 rather than
the largest item in the control plane — larger even than the WAF, and unlike the
WAF it would buy nothing this design needs. Both are verified absent in the live
account, not merely intended.

---

## 2. Per student — standing cost

Everything in `04-Sagemaker-Gpu-Student.yaml`. Billed whether or not the
student ever starts a notebook.

| Item | Rate | Monthly | × 100 students |
|---|---|---:|---:|
| **Studio Space EBS volume** (5 GB, auto-created on first launch) | $0.112/GB-mo (`USE1-Studio:VolumeUsage.gp3`) | **$0.56** | **$56.00** |
| EFS home directory | $0.30/GB-mo, usage-dependent | ~$0.03 per 100 MB | ~$3.00 |
| Share of the platform (§1) | — | $0.11 | $11.23 |
| `stop-app` + `studio-cleanup` Lambdas | Invoked on cap breach / teardown only | ~$0.00 | ~$0.00 |
| 2 × CloudWatch log group (90-day retention) | $0.50/GB ingest; 5 GB/mo free | A few KB per breach | $0.00 |
| 3 × IAM role, 3 × IAM policy, 1 × managed policy | Free | $0.00 | $0.00 |
| Studio UserProfile | Free | $0.00 | $0.00 |
| | **Per-student standing total** | **$0.70** | **$70.23** |

The whole per-student standing cost is one 5 GB gp3 volume that Studio creates
the first time a student opens JupyterLab. Storage persists when the app stops —
deliberately, so work survives a shutdown — which is why a fully idle student
still costs $0.56 rather than nothing.

The per-student SNS topic is gone along with the budget it notified for; alerts
now land on the platform's single consolidated `admin-alerts` topic.

**Worth stating plainly: this $0.56 sits OUTSIDE the $80 cap.** The ledger meters
notebook compute only, so a student's true bill is their metered spend plus this
volume. Under Budgets it was inside the cap, because Budgets counted the actual
invoice. On an $80 cap that is a 0.7% understatement, and `GET /me/usage` reports
it to students verbatim (`capCovers`) rather than letting them discover it.

Setting `DefaultSpaceStorageSettings` on the domain to a smaller default volume
is the only lever here, and it is worth about **$0.11/student/month per GB**
shaved off — **$11/month across 100 students** per GB.

---

## 3. Per student — the notebook

The variable cost, and now essentially the *entire* cost. Studio JupyterLab
rates (`USE1-Studio:JupyterLab-*`), us-east-1 on-demand. These are the four
types `InstanceType` allows.

| Instance | GPU | $/hour | Hours to burn $80 | $/mo @ 26 h | **× 100 students @ 26 h** | $/mo if left running 24×7 |
|---|---|---:|---:|---:|---:|---:|
| `ml.t3.medium` | none (rehearsal/demo) | 0.0500 | 1,600.0 | $1.30 | $130.02 | $36.50 |
| `ml.g4dn.xlarge` | 1 × T4 16 GB | 0.7364 | 108.6 | $19.15 | $1,914.64 | $537.57 |
| `ml.g6.xlarge` | 1 × L4 24 GB | 1.1270 | 71.0 | $29.30 | **$2,930.20** | $822.71 |
| `ml.g5.xlarge` | 1 × A10G 24 GB | 1.4100 | 56.7 | $36.66 | $3,666.00 | **$1,029.30** |

These four rates are duplicated in the backend as `NOTEBOOK_HOURLY_USD`
(`scripts/01-admin-platform-api.py`), stamped `RATES_ASOF = '2026-08-24'`. That is
the copy the cap is actually enforced from — see the warning at the end of this
document. An instance type not in that map is billed at the highest known rate
rather than $0, so a mis-typed `InstanceType` is a visible over-charge instead of
an invisible hole in the cap.

Three things fall out of this table:

- **`ml.g6.xlarge` is both newer and 20% cheaper than `ml.g5.xlarge`.** It is
  the right default for most teaching workloads, and the template's
  "best price-performance" comment on it is correct. **Across 100 students that
  preference alone is worth $736/month.**
- **One forgotten `ml.g5.xlarge` costs $1,029/month** — 12.9× a student's
  entire $80 cap. Automatic shutdown is not a nice-to-have; it is the only
  thing standing between a mis-click and a four-figure bill.
- **The $80 cap is 71 hours of `ml.g6.xlarge`** — about 2.7 hours a week over a
  trimester. That is the number to sanity-check the cap against the syllabus.

---

## 4. Cost risks in the current design

### 4.1 Enforcement cost

**This table prices the options that were considered. Only the `deployed` row is
a cost in this document — every other row is a counterfactual, included so the
choice can be checked rather than taken on trust.**

The deployed mechanism is the first row: the backend polls `list_apps` every
five minutes, prices runtime against a rate table, and writes to the usage
ledger. Its cost is already inside §1's Lambda and DynamoDB lines — **about $1
total, shared across the whole class rather than charged per student.**

| Approach | Cost driver | Monthly at 100 students | Status |
|---|---|---|---|
| Poll `list_apps` on a schedule and meter runtime × known hourly rate | Lambda + DynamoDB; the data is already in the response | **~$1.04 total** | **deployed** |
| Studio idle-shutdown lifecycle configuration | None — a domain setting | $0.00 | available, complementary — it is not a cap |
| AWS Budgets action per student | $0.10/action-enabled budget-day | $304.00 | **not deployed** — the mechanism this design replaced. No budgets exist in the account |
| CloudWatch alarm per student on a custom metric | $0.10/alarm-month + $0.30/custom metric | ~$40.00 | not deployed — scales per student. Verified: 0 alarms in the account |
| Cost Explorer `GetCostAndUsage` polling | $0.01 per request | $0.43/mo at 20-min polling | not deployed — data is hours stale |

AWS Budgets is the row worth understanding, because it is what this design
replaced. At **$0.10 per action-enabled budget-day** it cost $3.04/student/month
— **$304/month at 100 students**, which would have been 81% of standing cost and
by far the largest non-GPU line here. Dropping it is what takes per-student
standing cost from $3.60 to $0.56, an **84% reduction**.

The point of the shape, not just the price: **the per-student options are the
ones that get painful at 100.** Budgets would cost 300× the deployed mechanism
at this class size, and the alarm option 40×; the metering sweep grows by about
a cent per student.

What was genuinely lost is not cost but coverage. Budgets counted the actual
invoice; the ledger counts metered notebook compute only, so Space EBS (§2) and
any stray tagged resource now fall outside the cap. And the cap now depends on our
Lambda running — a Budgets action ran inside AWS whether our code did or not.
That is the trade accepted in exchange for §4.2.

### 4.2 Enforcement latency is what the cap really costs

The cap is only as tight as the loop that enforces it. The overshoot past $80 is
simply the detection delay multiplied by the hourly rate:

| Detection delay | `ml.g4dn.xlarge` | `ml.g6.xlarge` | `ml.g5.xlarge` | × 100 students on `ml.g6.xlarge` |
|---|---:|---:|---:|---:|
| **5 minutes — deployed default** | **$0.06** | **$0.09** | **$0.12** | **$9.39** |
| 20 minutes | $0.25 | $0.38 | $0.47 | $37.57 |
| 1 hour | $0.74 | $1.13 | $1.41 | $112.70 |
| 12 hours | $8.84 | $13.52 | $16.92 | $1,352.40 |

The 12-hour row is what AWS Budgets gave you, because its data refreshes only
up to three times a day — so the old effective cap was closer to **$89–97 than
$80**, and across 100 students that drift alone was worth **$1,352/month**. The
deployed 5-minute sweep brings worst-case overshoot to **$0.12 per student**, a
roughly **100× tighter cap**. **That accuracy, not the $304, is the strongest
argument for the replacement** — and it is the number to quote when someone asks
whether an $80 cap really means $80.

The row you get is whatever `SweepMinutes` is set to; `EnforcementLagMinutes` on
the stack outputs reports what is actually deployed, and `GET /me/usage` reports
it to students.

### 4.3 Sweep duration is the real scaling limit, not cost

The backend Lambda has `Timeout: 120`
(`03-Sagemaker-Gpu-Platform-Base.yaml`), and both sweeps do their per-student
work **serially** — one `describe_stacks`, one directory lookup and a handful of
DynamoDB calls per student, in a loop.

| Class size | `stack_status_sync` | `usage_sync` | Headroom to the 120 s timeout |
|---:|---:|---:|---|
| 1 (measured 2026-08-25) | **0.79 s** | **0.45 s** | 150× |
| 100 (extrapolated) | ~15–20 s | ~4–8 s | 6× |
| 500 (extrapolated) | ~75–100 s | ~20–40 s | **marginal** |

**At 100 students this is comfortable.** But the growth is linear and the
consequence of crossing the timeout is not a cost problem — a timed-out
`usage_sync` is an **unenforced cap** for that tick. If class size is ever
planned past ~300, batch the per-student loop (or fan it out) *before* raising
the timeout, because raising the timeout only defers the same failure.

### 4.4 CloudWatch log retention — fixed

Previously no `RetentionInDays` was set on any log group, so logs accumulated
forever at $0.03/GB-mo. Every log group in 02, 03 and 04 now declares retention:

| Log group | Retention | Why |
|---|---:|---|
| `/gpu-guardian/consumption` | 365 days | The record that settles a billing dispute — must outlive a trimester and its grading appeals |
| `/aws/lambda/gpu-guardian-admin-backend` | 90 days | Operational debugging |
| Per-student `stop-app` / `studio-cleanup` | 90 days | Proof a specific enforcement action fired |
| `/aws/lambda/gpu-guardian-admin-bucket-cleanup` | 30 days | Runs at teardown only |

The consumption group is the only one with a material steady-state cost, and at
100 students it is ~$0.04/month (§1). The backend's IAM grants it **no
`logs:Delete*`** on that group: the process that writes the audit trail cannot
erase it.

---

## 5. Pessimistic case at 100 students

Every assumption above pushed the wrong way at once, so the number is defensible
in a budget review rather than merely optimistic. This is not the expected case;
it is the ceiling on the *guardrail* cost.

| Line | Realistic | **Pessimistic** | What drives the pessimistic figure |
|---|---:|---:|---|
| DynamoDB reads | $0.28 | $0.60 | Retries, strongly-consistent reads, larger student records |
| DynamoDB writes | $0.05 | $1.50 | All 100 students running 24×7 instead of 26 h/month |
| DynamoDB storage | $0.00 | $0.00 | Kilobytes against a perpetual 25 GB free tier |
| Backend Lambda | $0.71 | $1.10 | Sweeps at 20 s / 8 s instead of the extrapolated 15 s / 4 s |
| API Gateway | $0.03 | $0.30 | SPA polling hard — 300 k requests/month |
| CloudWatch Logs | $0.04 | $1.00 | 365-day retention accruing; free tier consumed by other workloads |
| CloudFront | $0.00 | $1.00 | Assume the 1 TB / 10 M perpetual free tier is fully spent elsewhere in the account |
| Cognito / S3 / SNS / SSM | $0.01 | $0.20 | Access logs now land in S3; still kilobytes against a 90-day lifecycle |
| KMS customer-managed key | $1.09 | $1.40 | $1.00 fixed + request charges; the fixed part cannot be reduced |
| **AWS WAF** | **$9.02** | **$9.50** | $9.00 of it is fixed and cannot be reduced without deleting rules; only the request charge moves |
| VPC / network | $0.00 | $0.00 | Verified: no NAT gateway, no VPC endpoint, no Elastic IP |
| **Platform subtotal** | **$11.23** | **$16.50** | |
| Studio Space EBS, per student | $0.56 | $2.24 | Students resize the default 5 GB volume to 20 GB |
| EFS home directory, per student | $0.03 | $0.30 | 1 GB of home directory each instead of 100 MB |
| **Per student** | **$0.60** | **$2.54** | |
| **Standing total, 100 students** | **$70.23** | **$270.50** | |

| Scenario at 100 students | Realistic | **Pessimistic** |
|---|---:|---:|
| Expected spend — 26 GPU-hr each on `ml.g6.xlarge`, plus standing | $3,000 | $3,201 |
| Worst case — every student at their full $80 cap, plus standing | **$8,070** | **$8,271** |
| Guardrail cost as % of the caps it enforces | **0.87%** | **3.3%** |

**Even fully pessimistic, the guardrails are 3% of the exposure they bound.**
The pessimistic column moves the total by $200/month on an $8,000 ceiling —
which is the real finding: there is no plausible way for the control plane to
become a material cost at this scale. The only line that can move the bill is
GPU hours.

---

## 6. Trimester view

One trimester = 3 months, 100 students, $80 cap each.

| | |
|---|---:|
| Standing cost of the guardrails (3 × $70.23) | $210.69 |
| Expected spend at 26 GPU-hr/student/month (3 × $3,000.43) | $9,001.29 |
| Sum of per-student caps (100 × $80 × 3) | $24,000.00 |
| Worst case — every student at their full cap, plus standing | **$24,210.69** |
| Same, on the pessimistic column of §5 (3 × $270.50) | **$24,811.50** |
| **Recommended budget to set aside** | **$26,000.00** |
| Guardrail cost as % of the caps it enforces | **0.87%** |
| Enforcement overhead per student per trimester | **$2.11** on a $240 cap (0.88%) |
| *For comparison only* — the same trimester had Budgets been kept (add 3 × $3.04 × 100) | standing **$1,122.69**, overhead **$11.23**/student (4.7%) |

Sizing check: a $26,000 trimester budget is fully consumed by **107 students**
each spending their full $80 cap, or by **8 forgotten `ml.g5.xlarge` notebooks
left running for the whole trimester** ($24,703).

For a 30-student class, take §1's platform line at $10.77 and scale the rest
linearly: standing $85.41/trimester, worst case $7,285, recommended set-aside
**$8,000**. Note that the WAF is the same $9.02 whatever the class size, so a
small class carries proportionally more of it.

---

## 7. What is excluded

Usage-dependent and near-zero at this scale, but not zero:

- **AWS Budgets** — excluded because it is not deployed, not because it is small.
  Had it been kept it would be the second-largest line in this report at
  $304/month. See the note at the top and [§4.1](#41-enforcement-cost).
- **Data transfer out of Studio to the internet** — $0.09/GB after 100 GB/mo
  free. Package installs are ingress, which is free; only egress is billed. At
  100 students the free allowance is the one to watch, not the rate.
- **EFS growth from student home directories** — $0.30/GB-mo, carried as a line
  in §2 and stressed in §5. In the Spaces model most working data lands on the
  per-space EBS volume, already costed.
- **SES / SNS SMS** — not used.
- **AWS Support plan**, if any, which is priced as a percentage of spend.
- **Cost Explorer API calls** at $0.01/request. Free, and stays free: the
  metering loop reads `list_apps` and its own ledger, never Cost Explorer. This
  is why the sweep can run every five minutes at all — see the rejected row in
  §4.1.

---

## How to re-derive these numbers

Every rate in this document comes from the AWS Price List API and can be
re-pulled. The usage-type strings are the ones to query:

| What | Service code | Usage type |
|---|---|---|
| Studio notebook hours | `AmazonSageMaker` | `USE1-Studio:JupyterLab-<instance>` |
| Studio Space EBS | `AmazonSageMaker` | `USE1-Studio:VolumeUsage.gp3` |
| Cognito MAU | `AmazonCognito` | `USE1-CognitoEssentialsMAU` |
| HTTP API requests | `AmazonApiGateway` | `USE1-ApiGatewayHttpRequest` |
| DynamoDB on-demand | `AmazonDynamoDB` | `ReadRequestUnits`, `WriteRequestUnits` |
| Lambda | `AWSLambda` | `Request`, `Lambda-GB-Second` |
| EFS | `AmazonEFS` | `USE1-TimedStorage-ByteHrs` |
| CloudWatch Logs | `AmazonCloudWatch` | `USE1-DataProcessing-Bytes` |
| CloudWatch alarms (the rejected §4.1 option) | `AmazonCloudWatch` | `USE1-AlarmMonitorUsage` |
| AWS WAF | `awswaf` | Web ACL, rule and request charges. A `Scope: CLOUDFRONT` ACL bills as `Global` rather than to a region, so filter on that rather than on `us-east-1` |

```bash
aws pricing get-products --region us-east-1 --service-code AmazonSageMaker \
  --filters Type=TERM_MATCH,Field=regionCode,Value=us-east-1 \
            Type=TERM_MATCH,Field=productFamily,Value='ML Instance' \
  --query 'PriceList' --output text | python3 -m json.tool
```

The Cognito free-tier rule is **not** expressible in the Price List API and was
taken from <https://aws.amazon.com/cognito/pricing/>.

### Re-deriving the platform lines from live metrics

The §1 platform lines should be **measured, not modelled** — that is what
corrected the DynamoDB write line by a factor of seven. Read actual consumption
rather than multiplying assumptions:

```bash
# Actual DynamoDB consumption. Pick hours with no admin activity to get the
# pure sweep baseline - writes should be at or near ZERO when nothing changed.
aws cloudwatch get-metric-statistics --namespace AWS/DynamoDB \
  --metric-name ConsumedWriteCapacityUnits \
  --dimensions Name=TableName,Value=gpu-guardian-admin-students \
  --start-time "$(date -u -d '6 hours ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time   "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 3600 --statistics Sum

# Actual sweep duration and memory - also the §4.3 timeout check.
aws logs filter-log-events \
  --log-group-name /aws/lambda/gpu-guardian-admin-backend \
  --filter-pattern '"REPORT RequestId"' \
  --start-time $(( ($(date +%s) - 7200) * 1000 )) \
  --query 'events[].message' --output text

# The $0.00 claims, verified rather than assumed.
aws ec2 describe-nat-gateways  --query 'NatGateways[].NatGatewayId'
aws ec2 describe-vpc-endpoints --query 'VpcEndpoints[].VpcEndpointId'
aws ec2 describe-addresses     --query 'Addresses[].PublicIp'
aws cloudwatch describe-alarms --query 'length(MetricAlarms)'
aws sagemaker describe-domain --domain-id <id> --query 'AppNetworkAccessType'
```

Re-check this document when the allowed `InstanceType` list changes, when a new
resource is added to any template, when `SweepMinutes` is changed, when the
Cognito user pool tier changes, or when class size grows by more than ~3×.

> **The §3 rates are now load-bearing, not just documentation.** Self-metering
> means the backend carries its own copy of that table and bills students against
> it. If AWS changes a Studio rate and the backend's table is not updated, the
> cap silently enforces the wrong number — under-billing (a student overruns their
> real $80) or over-billing (a student is suspended early, and the ledger will not
> agree with the invoice). The backend stamps every `GET /me/usage` response with
> `ratesAsOf` so a dispute can be traced to the table version that priced it.
> **Re-pull §3 and update the backend's table together, in the same change.**
