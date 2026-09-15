# Documentation

Everything written about SageMaker GPU Guardian, and which document answers which
question. Start with the root [README.md](../README.md) for what the system is; start
here for where the detail lives.

## Contents

### Deploying and operating it

| | |
|---|---|
| [SETUP.md](SETUP.md) | Prerequisites, every CloudFormation parameter, and the one decision you cannot reverse. Read before the first deploy. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | The commands: deploy, upload artifacts, add a student, operate, tear down, troubleshoot. |

### Understanding it

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How it works, resource by resource, and the trade-offs it makes. |
| [adr/](adr/) | Architecture decision records — why the design is shaped this way, including the decisions that look wrong without context. |
| [COSTING.md](COSTING.md) | What it costs, measured rather than modelled, with the commands to re-check every figure. |
| [cost-summary.html](cost-summary.html) | The same costing on one page, for a non-technical reader. |

### Reviewing it

| | |
|---|---|
| [THREAT-MODEL.md](THREAT-MODEL.md) | Trust boundaries, assets, and threats T1–T11. The adversary is a legitimate authenticated student who wants their GPU to stay on. |
| [SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) | Every scanner finding raised against the repository and what happened to it. |
| [QUALITY-FINDINGS.md](QUALITY-FINDINGS.md) | Code-quality findings, and the two gaps no scanner reports. |

### Historical

| | |
|---|---|
| [PROPOSAL.md](PROPOSAL.md) | The original pitch. Predates the current design — kept for provenance, not accuracy. |
| [diagrams/](diagrams/) | Editable draw.io sources for the architecture diagrams. |

## Where the authoritative description lives

Not here. **Both CloudFormation templates carry a long header comment** describing
what the stack builds, in what order, and what breaks if you change it — plus a
`SECURITY-SCANNER TRIAGE` block above `Resources:` and a `reason:` on every
suppression. That is the primary record, because it is what a reviewer reads at the
point of change.

If a document here and a comment in a template disagree, **the template wins.** These
files summarise and cross-link; they do not replace it.

## Reading order

**Deploying it for the first time:** root [README.md](../README.md) →
[SETUP.md](SETUP.md) → [DEPLOYMENT.md](DEPLOYMENT.md).

**Reviewing it:** [ARCHITECTURE.md](ARCHITECTURE.md) →
[THREAT-MODEL.md](THREAT-MODEL.md) → [adr/](adr/) →
[SECURITY-FINDINGS.md](SECURITY-FINDINGS.md).

**Deciding whether to fund it:** [cost-summary.html](cost-summary.html) →
[COSTING.md](COSTING.md).

**Changing the templates:** the template header, then
[adr/0003](adr/0003-cross-stack-wiring-by-name.md) and
[adr/0006](adr/0006-two-enforcement-layers.md) — between them they cover every
suppression whose removal would break the cost control.

## What these documents deliberately do not claim

Stated here once so it is not mistaken for an omission:

- **Cap enforcement has never run end-to-end.** No student has launched JupyterLab
  against the live deployment, so no `SESSION#` ledger row has ever been written and
  `_enforce_breach` has never fired. Everything written about enforcement describes
  the design. See [QUALITY-FINDINGS.md](QUALITY-FINDINGS.md#the-real-quality-gap).
- **There are no automated tests** for the 2,444-line backend handler.
- **The cap fails open, not closed.** It works only while the metering job is healthy
  ([THREAT-MODEL.md](THREAT-MODEL.md) T1, [adr/0002](adr/0002-self-metered-cap-instead-of-aws-budgets.md)).
- **The dollar figures are estimates, not a bill.** Prices come from a rate table
  baked into the handler with an as-of date, and will drift.

## Related

- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to change this repository.
- [SECURITY.md](../SECURITY.md) — reporting a vulnerability, and the security posture.
- [CHANGELOG.md](../CHANGELOG.md) — what changed, and when.
