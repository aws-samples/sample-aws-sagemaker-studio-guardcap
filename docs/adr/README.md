# Architecture Decision Records

Decisions whose rationale is not recoverable from the code, recorded at the point
they were made so that the next person can tell a deliberate choice from an
accident.

Format is MADR-lite: **Context**, **Decision**, **Consequences**, and — the reason
these exist at all — **What would make us revisit this**. Numbering is sequential
and never reused. A superseded ADR is not deleted; its status changes and it names
its successor.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-two-stacks-platform-and-per-student.md) | One shared platform stack, one stack per student | Accepted |
| [0002](0002-self-metered-cap-instead-of-aws-budgets.md) | Self-metered cap instead of AWS Budgets actions | Accepted |
| [0003](0003-cross-stack-wiring-by-name.md) | Wire the enforcement path across stacks by name, not by `Ref` | Accepted |
| [0004](0004-handler-loaded-from-s3.md) | Load the backend handler from S3 rather than inline it | Accepted |
| [0005](0005-two-identity-modes.md) | Support both Identity Center instance types, with `AuthMode` immutable | Accepted |
| [0006](0006-two-enforcement-layers.md) | Enforce with two layers, and let the second one fail loudly | Accepted |
| [0007](0007-custom-resource-for-studio-cleanup.md) | Custom resource for Studio cleanup; leave EFS behind | Accepted |
| [0008](0008-single-console-bundle-configured-at-runtime.md) | One console bundle, configured at runtime by `GET /init` | Accepted |

## When to write one

Write an ADR when a choice is (a) hard to reverse, (b) likely to look wrong to
someone who does not know what was tried, or (c) something a linter, scanner or
well-meaning refactor will actively push back against. Most of the records here are
(c).

Do not write one for a decision the code already explains.
