# Contributing

## Code of Conduct

This project has adopted the
[Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct).
For more information see the
[Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.

## Scope

This repository is a self-contained GPU notebook lab: two CloudFormation templates, one
Python Lambda handler, and one Vite/Cloudscape console. Contributions that fit:

- Fixes and improvements to the cost control — the metering job, the ledger, the
  enforcement path.
- Operational hardening: alarms, retention, teardown, error handling.
- Console usability and accessibility.
- Documentation that makes a non-obvious decision or failure mode legible.
- **Tests.** There are none. This is the single most valuable contribution available;
  see [docs/QUALITY-FINDINGS.md](docs/QUALITY-FINDINGS.md#the-real-quality-gap).

Out of scope:

- Multi-region or multi-account topologies. One platform stack, one region, one account.
- Alternative notebook backends. This is SageMaker Studio.
- An i18n framework for the console. It is a single-tenant admin tool per institution;
  the 77 `jsx-not-internationalized` findings are suppressed deliberately.
- Anything that requires a build pipeline before the templates will deploy
  ([ADR-0004](docs/adr/0004-handler-loaded-from-s3.md)).

## Read this before you change anything

**Names are load-bearing.** The admin backend reaches into per-student stacks using
`ArnLike` conditions on literal name patterns (`gpu-guardian-*-exec-role`,
`gpu-guardian-*-deny-new-apps`, `gpu-guardian-*-stop-app`). Rename a resource, or remove
a `*Name` property so CloudFormation generates one, and **enforcement stops working
silently** — the deploy succeeds, IAM raises nothing, and the backend simply loses the
ability to suspend anybody. [ADR-0003](docs/adr/0003-cross-stack-wiring-by-name.md).

**Never "fix" a scanner finding in `cloudformation/` without reading the
`SECURITY-SCANNER TRIAGE` block above `Resources:` first.** Several suppressions protect
the cost control itself. In particular: `DenyNewAppsPolicy` uses `Resource: '*'` because
it is a `Deny` and the wildcard *is* the security property. Suppress the finding; keep
the wildcard. [docs/SECURITY-FINDINGS.md](docs/SECURITY-FINDINGS.md).

**Two properties of the Studio domain are one-way doors.** `AuthMode` (set indirectly by
`IdentityCenterInstanceType`) and `KmsKeyId` are immutable; changing either replaces the
domain, every UserProfile, and the home EFS filesystem holding all student coursework.
Do not change how either is derived without saying so explicitly in the merge request.

## Prerequisites

| | |
|---|---|
| Python | 3.11+, matching the Lambda runtime. `python3 -m py_compile` is the only pre-deploy gate on the handler. |
| Node.js | 20+ for the console. Install with `npm ci` in `app/`, so the committed lockfile is what resolves. |
| AWS CLI | v2, with credentials for a **non-production** account. |
| `cfn-lint` | For template changes. |

## Branching and commits

Branch from `main`. One logical change per branch.

Commit messages: a short imperative subject line describing the change. If the change
touches enforcement, naming, or an immutable property, say so in the body — that is what
a reviewer needs to know first.

## Code style

Match the surrounding code. Specifically:

**Python** (`scripts/01-admin-platform-api.py`) follows the house style already in the
file: numbered top-level sections, one class per domain concern, a `preflight()` boto3
credential and IAM check, and aligned columns in tabular literals such as the rate
table. New code goes in the section it belongs to rather than at the end.

**CloudFormation** — every resource that a scanner flags carries an inline `Metadata`
suppression with a one-line `reason:`, at the resource, so it is visible to whoever
would delete it. Recurring classes are explained once in the `SECURITY-SCANNER TRIAGE`
block. Do not move a reason out of the template into a document: the template is the
authoritative record.

**Comments** — default to none. Add one only when the *why* is not recoverable from the
code, which in this repository usually means: an AWS limitation, an immutable property,
or a decision a linter will argue with.

**Do not name files in comments or `Description` prose.** Refer to artifacts by role
("the per-student template", "the backend handler"), so a customer renaming a file does
not falsify the documentation.

**No emojis**, in code, comments, documentation or commit messages.

**Inclusive language** — use primary/main, replica/secondary, allowlist, denylist.

## Before you open a merge request

```bash
# Templates
cfn-lint cloudformation/*.yaml
#   Two W1030 warnings on IdentityCenterInstanceArn / IdentityStoreId are expected and
#   pre-existing; the rule cannot be satisfied without hard-coding an ARN.

# Backend handler — the only gate that exists. A syntax error otherwise surfaces
# as a 500 at cold start, in production, after the upload appeared to succeed.
python3 -m py_compile scripts/01-admin-platform-api.py

# The four inline handlers in the templates. Nothing else compiles them, and a name
# that is read but never bound is invisible to cfn-lint — see the script's docstring
# for the invocation that shipped that way.
python3 scripts/02-check-inline-handlers.py

# Console
cd app && npm ci && npm run typecheck && npm run lint && npm run build
```

If you changed a template, re-run the security scan and **add a row to the scan history
table** in [docs/SECURITY-FINDINGS.md](docs/SECURITY-FINDINGS.md#scan-history) — date,
total, per-scanner counts, and what it covered.

## Merge request checklist

- [ ] `cfn-lint` clean apart from the two known `W1030`s.
- [ ] `py_compile` passes on the handler, and `02-check-inline-handlers.py` is clean.
- [ ] `npm run typecheck`, `npm run lint` and `npm run build` pass.
- [ ] No resource renamed — or, if one was, every `ArnLike` condition that targets it
      was updated in the same change.
- [ ] Any new scanner finding either fixed, or suppressed inline with a written reason.
- [ ] Any new API route has a corresponding authorization branch in `_dispatch_http`.
      The JWT authorizer proves sign-in only; group membership is checked in code.
- [ ] `CHANGELOG.md` updated under `[Unreleased]`.
- [ ] A new ADR in [docs/adr/](docs/adr/) if the change makes a decision that will look
      wrong to someone without the context.
- [ ] No secrets, account ids, or real student data in the diff.

## What is not automated

Stated plainly so nobody assumes CI caught it: there is **no CI pipeline, no test
suite, and no automated deployment**. Every check above is run by hand. Cap enforcement
has never been exercised end-to-end. If your change touches `_sync_usage_one`,
`_enforce_breach` or `UsageLedger.add_to_period`, the only verification available is
reading it carefully and running the cap-drop test in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) against a disposable account.

## Reporting a security issue

Do not open a merge request. See [SECURITY.md](SECURITY.md).

## License

This project is released under MIT No Attribution ([LICENSE](LICENSE)). By contributing,
you agree that your contribution is licensed under the same terms.
