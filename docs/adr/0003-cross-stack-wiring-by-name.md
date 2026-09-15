# 0003 — Wire the enforcement path across stacks by name, not by `Ref`

**Status:** Accepted

Consequence of [ADR-0001](0001-two-stacks-platform-and-per-student.md).

## Context

The admin backend lives in the platform stack. The things it must act on — each
student's execution role, their deny policy, their stop-app function — live in
per-student stacks that **do not exist yet** when the platform stack is deployed, and
whose count changes over the trimester.

The backend's role therefore needs permission to `iam:AttachRolePolicy` /
`DetachRolePolicy` on roles, and `lambda:InvokeFunction` on functions, that
CloudFormation cannot name for it. `Ref`, `GetAtt`, `Fn::ImportValue` and nested-stack
outputs all require the target to exist in, or be exported by, a stack the platform
template can see. None of them can.

The options were:

1. **Grant the backend unscoped IAM and Lambda permissions** — `Resource: '*'` on
   `AttachRolePolicy`. Correct-looking template, catastrophic permission: the backend
   could attach any policy to any role in the account.
2. **Update the backend's role each time a student is added**, appending the new
   ARNs. Turns every provision into an IAM policy edit, with a hard policy-size
   ceiling and a self-modifying-permissions problem.
3. **Fix the names, and scope by name pattern** using `ArnLike` conditions.

## Decision

Option 3. Per-student resources get **explicit, predictable names** under a
`gpu-guardian-*` prefix, and the backend's role scopes every dangerous action with an
`ArnLike` condition on the literal pattern:

| Condition on | Literal pattern |
|---|---|
| `iam:PassRole` / role targeting | `arn:aws:iam::*:role/gpu-guardian-*-exec-role` |
| `iam:PolicyARN` on attach/detach | `arn:aws:iam::*:policy/gpu-guardian-*-deny-new-apps` |
| `lambda:InvokeFunction` | `function:gpu-guardian-*-stop-app` |

The names are part of the security boundary. They are not cosmetic.

## Consequences

**Good:**

- The backend can act on students who did not exist when it was deployed, without
  ever holding account-wide IAM power. It can attach *that one policy shape* to
  *that one role shape*, and nothing else.
- No IAM churn per student. Adding the hundredth student changes no policy.

**Bad, and accepted:**

- **Renaming disarms enforcement silently.** If a resource is renamed, or its
  `*Name` property is removed so CloudFormation generates one, the `ArnLike`
  conditions stop matching. Deploys succeed. IAM raises nothing. The backend simply
  loses the ability to suspend anyone. This is T2 in
  [THREAT-MODEL.md](../THREAT-MODEL.md).
- It puts the design permanently at odds with cfn_nag's `W28`, which advises against
  explicit names because they block resource replacement. **This is the one finding
  class where complying with the scanner breaks the control.** Hence 14 `W28`
  suppressions, each carrying a `reason:` that says the name *is* the enforcement
  handle ([SECURITY-FINDINGS.md](../SECURITY-FINDINGS.md) §1).
- A student stack cannot be renamed to sidestep a naming collision. The prefix is
  fixed.

## Mitigations in place

- A `NAMES ARE LOAD-BEARING` block in the per-student template header.
- A `SECURITY-SCANNER TRIAGE` block above `Resources:` in both templates explaining
  `W28` once.
- A one-line `reason:` on every individual suppression, so it is visible at the point
  someone would delete it.
- "Names are load-bearing" in [ARCHITECTURE.md](../ARCHITECTURE.md).

No automated test asserts that the conditions match a real student's ARNs. That gap
is recorded in [QUALITY-FINDINGS.md](../QUALITY-FINDINGS.md).

## What would make us revisit this

- Moving to a single stack for the whole cohort ([ADR-0001](0001-two-stacks-platform-and-per-student.md))
  would make `Ref` available and delete this entire problem — at the cost of blast
  radius.
- Tag-based IAM conditions (`aws:ResourceTag`) on the relevant IAM and Lambda actions
  would be a stronger handle than a name, if support were complete for
  `AttachRolePolicy` on the policy ARN. Worth re-checking; a tag is metadata, whereas
  a name is load-bearing and therefore fragile.
