# 0002 — Self-metered cap instead of AWS Budgets actions

**Status:** Accepted

Supersedes the approach in the two deleted first-draft templates, which each
contained an `AWS::Budgets::Budget` per student.

## Context

The product promise is that a student cannot overspend their allowance. The obvious
AWS-native mechanism is a per-student AWS Budget with a **budget action** that
attaches an IAM deny policy when a threshold is crossed. The first draft did exactly
that.

Two properties of AWS Budgets made it the wrong tool here:

- **Latency.** Budgets are driven by Cost Explorer data, which lands with a delay
  measured in hours — commonly 8–12, and never guaranteed. A `ml.g5.xlarge` left
  running is billed the whole time. The single most valuable thing this system can do
  is catch a notebook someone forgot on a Friday, and Budgets would catch it on
  Saturday.
- **Cost.** Action-enabled budgets are charged per budget-day
  ([COSTING.md](../COSTING.md) §4.1). At one budget per student that is roughly
  $3.04/student/month — for a 100-student cohort, more than $300/month spent to
  police a lab whose entire control plane otherwise costs $11.23/month, and only
  $2.21 of that has anything to do with metering. The cost control would cost more
  than everything it runs on.

There is also a tagging problem: budget filters need the spend attributed to the
student, and Studio app charges are not reliably tagged per UserProfile without extra
machinery.

## Decision

Meter it ourselves. A `usage_sync` job, invoked by EventBridge every `SweepMinutes`
(default 5, `MinValue: 2`):

1. Lists running Studio apps and attributes each to a UserProfile.
2. Accrues elapsed runtime since `lastSampledAt` into a `SESSION#` ledger row.
3. Prices it from a rate table baked into the handler (`RATES_ASOF = '2026-08-24'`).
4. Atomically `ADD`s the dollar delta to the `PERIOD#<YYYY-MM>` row and compares the
   returned total to the student's cap.
5. On breach, runs enforcement itself ([ADR-0006](0006-two-enforcement-layers.md)).

No `AWS::Budgets::Budget` exists anywhere in either template.

## Consequences

**Good:**

- Enforcement is **minutes** late instead of hours. That is the difference between
  the product working and not.
- It is free. DynamoDB on-demand at this volume plus a five-minute Lambda is about
  $1.04 of the $11.23/month control plane; the other $10.11 is a KMS key and the
  console's WAF, neither of which has anything to do with metering.
- Attribution is exact — the app's `UserProfileName` is the student, with no reliance
  on cost-allocation tags being enabled and propagated.
- The ledger is a first-class artifact: per-session history, per-period totals, and
  a `/me/usage` view students can see. Budgets gives none of that.

**Bad, and accepted:**

- **The cap fails open, not closed.** If the EventBridge rule is disabled or the
  function is unhealthy, nothing meters and nothing enforces — and nothing says so.
  This is T1 in [THREAT-MODEL.md](../THREAT-MODEL.md) and the single largest weakness
  in the design. Mitigation is three CloudWatch alarms and an SNS subscription; it is
  detective, not preventive.
- The prices are a **hard-coded rate table** with an as-of date. AWS changes prices;
  the ledger will silently drift until someone refreshes it. Savings Plans, Spot and
  private pricing are not modelled at all.
- The figure is an **estimate, not a bill.** It will not reconcile to the invoice
  penny-for-penny, and the console must not imply that it does.
- Only Studio app runtime is metered. Anything else a student manages to spend money
  on is invisible to the cap.

## What would make us revisit this

- AWS Budgets gaining near-real-time evaluation, or dropping the per-action charge.
- The lab spending enough that estimate-versus-invoice drift becomes a real dispute
  — at which point a coarse notify-only Budget alongside this (which does not need
  the paid action) is the cheap backstop.
- Any workload other than Studio apps needing to count against the cap.
