# 0001 — One shared platform stack, one stack per student

**Status:** Accepted

## Context

A cohort needs shared infrastructure — a Studio domain, a VPC, the admin console and
its API, the ledger — and per-student infrastructure: an execution role, a
UserProfile, a deny policy, a stop-app function. The per-student resources have to
appear and disappear as students are added and removed, mid-trimester, without
touching anyone else.

Three shapes were available:

1. **One stack for everything**, with students represented as a list parameter or a
   custom resource loop. Adding one student is an update to the stack that owns the
   whole cohort.
2. **Platform stack plus per-student stacks**, one per student, created by the
   backend from a template in S3.
3. **No CloudFormation for students** — the backend calls IAM and SageMaker APIs
   directly and tracks what it made.

## Decision

Shape 2. A platform stack owns everything shared. Each student gets their **own**
CloudFormation stack, created by the backend from a template stored in
`TemplatesBucket` at `StudentTemplateS3Key`.

## Consequences

**Good:**

- Blast radius is one student. A failed provision rolls back one stack; a failed
  update cannot take the cohort's Studio domain with it. Under shape 1, a bad
  student parameter puts the domain into `UPDATE_ROLLBACK_FAILED`.
- Removing a student is `DeleteStack`. Under shape 3 it is a hand-written unwind
  that has to get the order right, and any resource the code forgets is billed
  forever.
- Concurrency is free. Twenty students provision as twenty independent stacks.
  Under shape 1 they serialise behind one stack's update lock.
- The per-student template is auditable and reviewable on its own, and a customer
  can diff it.

**Bad, and accepted:**

- The enforcement path cannot use `Ref` across the boundary, which is
  [ADR-0003](0003-cross-stack-wiring-by-name.md) and the origin of the 14 `W28`
  suppressions.
- The template must be uploaded to S3 *before* the first student is added — a
  deployment ordering constraint that does not exist in shape 1, and a documented
  step in [DEPLOYMENT.md](../DEPLOYMENT.md).
- The backend needs CloudFormation create/delete rights over stack names not known
  until a student is added, hence a `Resource: '*'` statement
  ([SECURITY-FINDINGS.md](../SECURITY-FINDINGS.md) §3).
- Two templates drift unless changes are made in both. The per-student template is
  versioned only by whatever is in the bucket; re-uploading it changes what the
  *next* student gets and not what existing students have.

## What would make us revisit this

- If per-student resources ever needed to reference each other, the stack-per-student
  boundary would become the wrong cut.
- If a cohort grew past a few hundred, the CloudFormation stack count per region
  (and the provisioning API rate) would start to matter.
