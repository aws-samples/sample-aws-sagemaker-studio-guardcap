# 0006 — Enforce with two layers, and let the second one fail loudly

**Status:** Accepted

## Context

When a student crosses their cap, "suspend them" is two different problems:

- Stop them starting **new** compute.
- Stop the compute **already running**.

An IAM deny policy solves the first and does nothing about the second. A running
`ml.g5.xlarge` keeps billing no matter what policies are attached to the role that
started it. And the second case is the whole reason the product exists — the scenario
is a kernel left running over a weekend, not a student politely launching a new app
after being told to stop.

## Decision

Two independent layers, both applied on breach:

**Layer 1 — `DenyNewAppsPolicy`** (one per student, attached to their execution role
by the backend). Denies `sagemaker:CreateApp`, `CreateSpace` and `UpdateSpace` with
`Resource: '*'`. Blocks new compute.

**Layer 2 — `StopStudioAppFunction`** (one per student). Deletes the student's running
apps. This is what actually stops the meter.

And a rule about recording it: **`ON_HOLD` is written only if both layers succeeded.**
`_enforce_breach` checks the invoke result and refuses to write the hold otherwise.

## Consequences

### Two deliberate omissions that look like bugs

**`Delete*` is absent from the deny policy.** `DeleteApp` and `DeleteSpace` are *not*
denied. A suspended student — and teardown, and layer 2 itself — must still be able to
tear things down. Adding `Delete*` for symmetry would make a suspended student unable
to stop their own notebook, i.e. unable to stop spending.

**`Resource: '*'` on the deny policy must not be narrowed.** It is a `Deny`, and the
wildcard is the security property: it has to cover every app, space and *future* ARN
shape a suspended student could reach for. Scope it to named resources and a suspended
student launches from the shape you forgot. cfn_nag `W12`/`W11` and checkov
`CKV_AWS_111` all flag it, and all three are suppressed with that reason
([SECURITY-FINDINGS.md](../SECURITY-FINDINGS.md) §3, §4). This is the one scanner
finding in the repository where complying would directly weaken the cost control.

### Two more that look like oversights

**No reserved concurrency on the stop-app function** (cfn_nag `W92`, checkov
`CKV_AWS_115`). **No dead-letter queue on it either** (`CKV_AWS_116`) — even though
the backend function does have one.

Both are correctness decisions, and they follow directly from the rule above. The
failure mode being avoided is the ledger claiming a student is `ON_HOLD` while their
GPU is warm:

- A reserved-concurrency **throttle** would be an invocation that neither succeeded
  nor visibly failed at the right moment.
- A **dead-letter queue** would swallow a failed stop into a queue nobody watches,
  turning "enforcement failed, alarm, retry next sweep" into "enforcement is pending,
  indefinitely."

A visible failure is better than a queued one, because the metering job runs again in
`SweepMinutes` and will retry the whole breach path from a correct ledger state. The
alarms on the backend function surface the failure.

### Good

- The layers are independent. Layer 1 survives a Lambda outage; layer 2 works even if
  the policy attach failed. Neither depends on the other having worked.
- The ledger never lies about enforcement having happened.
- Retry is structural, not coded: the next sweep re-evaluates.

### Bad, and accepted

- Layer 2 is the layer that saves money, and it is a Lambda invocation — so an
  unhealthy function means a student over cap with a running GPU. Bounded by the alarm
  and the next sweep, not prevented.
- There is a window between the breach being detected and the app being deleted in
  which billing continues. It is seconds, but it is not zero.
- **Neither layer has ever fired.** No `SESSION#` ledger row has been written against
  the live deployment, so `_enforce_breach` has never run end-to-end. Everything above
  is design, not observed behaviour — see [QUALITY-FINDINGS.md](../QUALITY-FINDINGS.md)
  and the cap-drop test in [DEPLOYMENT.md](../DEPLOYMENT.md).

## What would make us revisit this

- The cap-drop test running and disagreeing with any of the above. Record the result
  here.
- Any change that makes the stop path retry-safe in a way a DLQ could observe without
  the ledger going stale — at which point the `CKV_AWS_116` suppression should be
  reconsidered rather than inherited.
