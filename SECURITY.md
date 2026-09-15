# Security

## Reporting a vulnerability

**Do not open a public issue or merge request for a security issue.**

Report it privately to
[AWS Security](https://aws.amazon.com/security/vulnerability-reporting/), or by email to
aws-security@amazon.com. Include:

- What the issue is, and which file or resource it affects.
- The impact you believe it has. For this project the questions that matter most are:
  *can a student spend beyond their cap?*, *can a student reach another student's
  notebooks or profile?*, and *can a non-admin reach an admin route?*
- Reproduction steps, ideally against a disposable account.

## What to expect

This is a sample project with no on-call rotation and no formal SLA. Realistic
expectations, not aspirational ones:

| | |
|---|---|
| Acknowledgement | Within a few business days. |
| Assessment | Within two weeks for anything affecting the cap or cross-student isolation; best effort otherwise. |
| Fix | Committed to `main`. There are no releases or patch versions to backport to. |
| Disclosure | Recorded in [CHANGELOG.md](CHANGELOG.md) and, if it changes a design decision, in [docs/adr/](docs/adr/). |

## Supported versions

| Version | Supported |
|---|---|
| `main` | Yes |
| Anything else | No |

There are no tags, no releases, and no version branches. The deployable artifact is
whatever is on `main`, and a deployed platform is only as current as the last time
someone re-uploaded the handler and re-deployed the stack. **Redeploying is the only
patch mechanism.**

## Security posture of this project

Read this before deciding what counts as a vulnerability here.

**This is a teaching lab, deployed to a non-production AWS account, with a synthetic
cohort.** The threats it is designed against are documented in full — including the ones
it does not mitigate — in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Every scanner
finding and its disposition is in
[docs/SECURITY-FINDINGS.md](docs/SECURITY-FINDINGS.md).

What is deliberately accepted, so a report of it is not news:

- **The cap fails open, not closed.** Enforcement happens only while the metering job
  runs. Disable the EventBridge rule and the cap silently stops existing. Detection is
  three CloudWatch alarms and an SNS subscription — nothing preventive. This is the
  design's central weakness and is stated as such everywhere
  ([ADR-0002](docs/adr/0002-self-metered-cap-instead-of-aws-budgets.md)).
- **No customer-managed KMS keys.** DynamoDB, CloudWatch Logs and Lambda environment
  variables are encrypted under AWS-managed keys. Nothing sensitive is stored — a
  roster, dollar totals, instance types.
- **`Resource: '*'` on `DenyNewAppsPolicy` is intentional and must not be narrowed.** It
  is a `Deny`; the wildcard is what makes it cover ARN shapes nobody thought of.
- **No VPC flow logs**, valid only while the Studio domain runs
  `AppNetworkAccessType: PublicInternetOnly` and the sole ENI in the subnet is the EFS
  mount target.
- **`GET /init` is unauthenticated by necessity.** It returns branding and public
  sign-in coordinates; a Cognito hosted-UI client id is public to every browser anyway.
- **A presigned Studio URL is a bearer credential** for its short validity window in
  `ACCOUNT` identity mode. `ORGANIZATION` mode avoids this and is preferred where
  available ([ADR-0005](docs/adr/0005-two-identity-modes.md)).
- **Deleting the platform leaves the home EFS filesystem behind**, because
  `AWS::SageMaker::Domain` exposes no CloudFormation property for retention. Student
  notebooks survive a teardown that looked complete.

What is genuinely worth reporting:

- Any path by which a student reaches another student's notebooks, execution role,
  UserProfile, or ledger rows.
- Any path by which a non-admin reaches an admin route. Note that the JWT authorizer
  proves sign-in only — **group membership is checked in handler code**, so a route with
  no matching branch in `_dispatch_http` is the failure mode to look for.
- Any way a student detaches their own deny policy or otherwise self-unsuspends.
- Any way to write the `PERIOD#<YYYY-MM>` ledger row without being the backend function.
- Credentials, account ids or real personal data committed to the repository.

## Out of scope

- What a student runs inside their own notebook. They have a Python kernel and internet
  egress; that is the product. Spend is bounded by their cap, not prevented.
- A student burning their entire cap quickly. The cap is on dollars, not on pace.
- Anything requiring an admin to be dishonest. Admin authority is the trust anchor: an
  admin can raise caps, release holds and terminate students, with no second approver.
- Vulnerabilities in AWS services themselves.
- Findings from an automated scanner with no accompanying exploitation path. Check
  [docs/SECURITY-FINDINGS.md](docs/SECURITY-FINDINGS.md) first — it is probably already
  dispositioned there, with a reason.

## Licensing

Released under MIT No Attribution — see [LICENSE](LICENSE). The software is provided
"as is", with no warranty. In particular, nothing in this repository is a guarantee
that the cost cap will hold; deploy it to an account whose spend you are willing to
be responsible for.
