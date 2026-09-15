# 0005 — Support both Identity Center instance types, with `AuthMode` immutable

**Status:** Accepted

## Context

SageMaker Studio authenticates users one of two ways, set by the domain's `AuthMode`:

- **`SSO`** — users come from IAM Identity Center and reach Studio via the access
  portal. This is what an institution with real students wants: existing university
  credentials, group membership managed in the directory, no separate password.
- **`IAM`** — the domain has no identity provider of its own; access is via a
  presigned domain URL minted by something that already knows who the caller is.

`SSO` requires an Identity Center **organization** instance. An **account** instance
— the kind you get in a standalone AWS account, and the kind the current live
deployment has — cannot back a SAML application or a Studio `SSO` domain at all.

So the platform could either target organization instances only (and be undeployable
in a plain sandbox account, which is where every demo and every trial happens), or
support both.

## Decision

Support both, selected by the `IdentityCenterInstanceType` parameter:

| Parameter value | Studio `AuthMode` | Identity source | How a student reaches a notebook |
|---|---|---|---|
| `ORGANIZATION` | `SSO` | IdC groups, a permission set, a SAML application | The IdC access portal tile |
| `ACCOUNT` | `IAM` | A Cognito user pool created by the platform stack | `GET /me/studio-url` mints a short-lived presigned URL |

In both modes the admin console is the same bundle and the API is the same, because
the console's own sign-in is **always** Cognito. `IdentityCenterInstanceType` changes
where *students* come from, not where admins come from.

`IdentityCenterInstanceType` has **no default value**.

## Consequences

**Good:**

- The platform deploys into a plain sandbox account with no Organization, which is
  the only way a trial or a demo happens.
- An institution that does have an organization instance gets the correct answer —
  real directory credentials, group-managed enrolment, no shared secrets.
- Admin authentication is one code path regardless of mode, so the authorization
  logic in `_dispatch_http` does not fork.

**Bad, and accepted:**

- **`AuthMode` is immutable.** Changing `IdentityCenterInstanceType` on a deployed
  platform replaces the Studio domain, every UserProfile in it, and the home EFS
  filesystem holding all student coursework. There is no migration path and no
  in-place conversion. This is T10 in [THREAT-MODEL.md](../THREAT-MODEL.md), and it is
  why the parameter has no default: any default would be a value someone accepts
  without thinking, and getting it wrong is discovered months later.
- `ACCOUNT` mode's presigned URL is a bearer credential for its validity window (T7).
  `ORGANIZATION` mode has no equivalent exposure. The two modes are **not** equally
  secure, and `ORGANIZATION` should be preferred wherever it is available.
- Two modes means two paths through provisioning — IdC group membership and a SAML
  assignment in one, a Cognito user in the other — and the `ACCOUNT` path is the one
  actually exercised in the live deployment. The `ORGANIZATION` path is the
  less-tested of the two.
- Conditional resources make both templates longer and harder to read.

## What would make us revisit this

- Identity Center account instances gaining the ability to back a Studio `SSO` domain
  — the fork would collapse to one mode.
- A decision to target only institutional deployments, which would let `ACCOUNT` mode
  and the presigned-URL path be deleted outright.
