# 0008 — One console bundle, configured at runtime by `GET /init`

**Status:** Accepted

## Context

The console is a static SPA served from S3 behind CloudFront. It needs to know, before
it can draw a login page: the Cognito domain and client id to authenticate against,
which identity mode the platform is in, and the institution's own name and branding —
all of which are CloudFormation parameters or stack outputs, and none of which are
known when the bundle is built.

Vite bakes `import.meta.env.NEXT_PUBLIC_*` values in at **build** time. The
straightforward approach is therefore to build the bundle per deployment, with every
value in the environment. That means: a build per institution, a rebuild whenever the
institution changes its display name, and a bundle whose contents depend on which
shell someone ran `npm run build` in.

## Decision

One bundle. Exactly **one** build-time variable — `NEXT_PUBLIC_API_BASE_URL`, which is
the only thing the SPA needs to know before it can ask anything. Everything else comes
from an unauthenticated `GET /init` on first load:

```
GET /init  ->  { institutionName, identityMode, cognitoDomain, cognitoClientId, ... }
```

`GET /init` is the only unauthenticated route on the API. It is matched in
`_dispatch_http` **before any authorization check**, because by definition the caller
has no token yet. It returns branding and public sign-in coordinates only — nothing
per-student, no counts, no roster — with `Cache-Control: public, max-age=300`.

## Consequences

**Good:**

- Rebranding is a stack update, not a rebuild-and-redeploy. Change
  `InstitutionName`, and the next page load reflects it.
- The bundle is deployment-independent. The same artifact works against any platform
  stack, which makes the build reproducible and the artifact cacheable.
- Identity mode ([ADR-0005](0005-two-identity-modes.md)) is a runtime branch rather
  than a compile-time one, so one bundle serves both `ORGANIZATION` and `ACCOUNT`
  deployments.
- No secret is ever baked into a public bundle, because there is nothing to bake.

**Bad, and accepted:**

- **The API is a hard dependency of the login page.** If `/init` is down the console
  cannot render a sign-in form at all — it degrades to an error, not to a
  partially-working page. With a baked bundle, sign-in would still work while the API
  was unavailable.
- One extra round trip before first paint, and a visible loading state that has to be
  designed rather than avoided.
- An unauthenticated invocation path into the backend function exists by construction.
  It fingerprints the deployment (institution name, identity mode) to an anonymous
  caller, and rate limiting is the API Gateway account default. Accepted as low
  severity — T8 in [THREAT-MODEL.md](../THREAT-MODEL.md) — because a hosted-UI client
  id is public to every browser that loads the page anyway.
- `NEXT_PUBLIC_API_BASE_URL` still has to be right at build time, and getting it wrong
  produces a console that loads and then fails opaquely. It is the one value with no
  runtime escape hatch.
- The prefix is `NEXT_PUBLIC_*` for historical reasons — the console was briefly a
  Next.js app. It is Vite now. The prefix is kept because renaming it would break every
  documented build command for no functional gain.

## What would make us revisit this

- A requirement for the console to work while the API is unavailable.
- Anything genuinely sensitive needing to reach the SPA before sign-in, which would
  mean `/init` can no longer be unauthenticated and the whole shape changes.
