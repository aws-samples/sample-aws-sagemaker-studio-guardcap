# SageMaker GPU Guardian

A GPU notebook lab on AWS where every student gets their own SageMaker Studio
environment and a hard dollar cap that is enforced automatically — nobody has to
notice that a student went over budget and cut off their access by hand.

Deploy one platform stack. After that, students are added from a web console,
which creates one CloudFormation stack per student.

## Documentation

Index and reading orders: [docs/README.md](docs/README.md).

| | |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Prerequisites, every parameter, and the one decision you cannot reverse |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploy, operate, tear down, troubleshoot |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works, resource by resource, and the trade-offs it makes |
| [docs/adr/](docs/adr/) | Why the design is shaped this way, including the decisions that look wrong without context |
| [docs/COSTING.md](docs/COSTING.md) | What it costs, measured rather than modelled |
| [docs/cost-summary.html](docs/cost-summary.html) | The costing on one page, for a non-technical reader |
| [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) | Trust boundaries and threats. The adversary is a legitimate student who wants their GPU to stay on |
| [docs/SECURITY-FINDINGS.md](docs/SECURITY-FINDINGS.md) | Every scanner finding raised, and what happened to it |
| [docs/QUALITY-FINDINGS.md](docs/QUALITY-FINDINGS.md) | Code-quality findings, and the two gaps no scanner reports |
| [docs/PROPOSAL.md](docs/PROPOSAL.md) | The original pitch. Historical — predates the current design |

Also: [CONTRIBUTING.md](CONTRIBUTING.md) before changing anything,
[SECURITY.md](SECURITY.md) for reporting a vulnerability and for what is deliberately
accepted, [CHANGELOG.md](CHANGELOG.md) for what changed,
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [LICENSE](LICENSE) for the terms.

## Repository layout

```
cloudformation/
  03-Sagemaker-Gpu-Platform-Base.yaml   the platform. You deploy this once.
  04-Sagemaker-Gpu-Student.yaml         one student. The console deploys this.
scripts/
  01-admin-platform-api.py              the backend handler, loaded from S3
app/                                    the admin + student console (Vite, Cloudscape)
docs/
  adr/                                  architecture decision records
  diagrams/                             editable draw.io sources
```

Both templates carry a long header comment describing what they build and why;
that is the authoritative description of each stack.

## What it costs

At 100 students, `us-east-1` on-demand: the entire control plane is **$11.23 a
month** — of which $9.02 is the WAF in front of the admin console and $1.00 one
KMS key, both fixed charges that do not scale with headcount — per-student
standing cost is **$0.67**, and **98% of the bill is GPU hours students actually
consume**. Control the GPU hours and you control the bill. Full derivation, including how to re-check every figure against the AWS
Price List API, is in [docs/COSTING.md](docs/COSTING.md).

## How the cap works

The platform meters itself. Every few minutes it lists running Studio apps,
accrues their runtime onto a per-session DynamoDB ledger row, prices it, and sums
the month. When a student crosses their cap it attaches a deny policy — blocking
new notebooks — and deletes the ones already running, which is what actually
stops the meter.

This replaced an AWS Budgets design. The trade, stated plainly: it costs nothing
instead of $3.04/student/month and is minutes late instead of up to twelve hours
late, **but it only works while the metering job is healthy**. This cap fails
silent, not closed. Three CloudWatch alarms exist to tell you when it has —
subscribe to them and mean it. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#how-the-cap-is-actually-enforced) and
[docs/COSTING.md](docs/COSTING.md) §4.

## Getting started

Read [docs/SETUP.md](docs/SETUP.md) first — `IdentityCenterInstanceType` sets the
Studio domain's `AuthMode`, which is immutable, and getting it wrong means
rebuilding the domain and destroying every student's home directory. Then follow
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) in order.

## License

MIT No Attribution. See [LICENSE](LICENSE).
