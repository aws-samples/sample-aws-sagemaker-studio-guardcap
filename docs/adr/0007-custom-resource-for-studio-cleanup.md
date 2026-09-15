# 0007 — Custom resource for Studio cleanup; leave EFS behind

**Status:** Accepted

## Context

`AWS::SageMaker::Domain` and `AWS::SageMaker::UserProfile` cannot be deleted while
anything is running inside them. `DeleteUserProfile` fails if the profile has apps;
`DeleteDomain` fails if it has profiles or spaces. CloudFormation does not know this
and does not clean up — it calls `Delete`, gets an error, and the stack sits in
`DELETE_FAILED` until a human goes and deletes apps by hand.

For a per-student stack that is deleted every time a student is removed, that is not
an edge case; it is the normal path.

Separately: deleting a Studio domain leaves its **home EFS filesystem** behind.
Retention is controlled by a `RetentionPolicy` parameter on the `DeleteDomain` **API
call**, and `AWS::SageMaker::Domain` exposes **no CloudFormation property for it** —
setting one fails validation. So there is no declarative way to ask CloudFormation to
delete the filesystem.

## Decision

A **custom resource** backed by a Lambda function, invoked on stack `Delete`, which
walks the dependency order — delete apps, wait, delete spaces, wait, then let
CloudFormation delete the profile and domain.

And, deliberately: **do not attempt to delete the EFS filesystem.** The teardown
sequence for the orphans is documented, not automated.

## Consequences

**Good:**

- Removing a student is one `DeleteStack` that actually completes, including when they
  left a notebook running — which is exactly the population this product selects for.
- The ordering and the waits live in code that can be read, rather than in a runbook
  someone follows at 5pm.

**Bad, and accepted:**

- **Deleting the platform stack always leaves billable orphans**: the home EFS
  filesystem, its mount-target ENI, and two SageMaker-created
  `security-group-for-*-nfs-*` groups. The two security groups reference each other,
  so both must have their rules revoked before either can be deleted, and the ENI
  blocks subnet deletion — so the VPC delete fails with `DependencyViolation` until
  all of it is cleaned up by hand. The full discover-and-delete sequence is in
  [DEPLOYMENT.md](../DEPLOYMENT.md); the risk of walking away from it is T11 in
  [THREAT-MODEL.md](../THREAT-MODEL.md).
- Leaving the EFS filesystem also means **student coursework survives a teardown** the
  operator may believe deleted it. That cuts both ways: it is a data-retention
  surprise, and it is also the only thing standing between a mis-click and lost work.
- The cleanup function has no reserved concurrency, for the same reason as
  [ADR-0006](0006-two-enforcement-layers.md): a throttle here means a stack wedged in
  `DELETE_IN_PROGRESS` until the CloudFormation timeout, which is a far worse outcome
  than a visible failure.
- Custom resources fail in the worst possible way — if the function never responds to
  the CloudFormation callback URL, the stack hangs for an hour. Every path in the
  function must respond, including its error paths.

## What would make us revisit this

- `AWS::SageMaker::Domain` gaining a `RetentionPolicy` property. Then EFS cleanup
  becomes declarative and most of the manual teardown in
  [DEPLOYMENT.md](../DEPLOYMENT.md) disappears.
- The platform holding real coursework, at which point "leaves EFS behind" stops being
  an annoyance and becomes a data-lifecycle requirement needing an explicit,
  deliberate answer plus backups.
