# 0004 — Load the backend handler from S3 rather than inline it

**Status:** Accepted

## Context

The admin backend is one Python file, currently 2,444 lines: fourteen HTTP routes,
three scheduled jobs, the ledger, the pricing table, and the enforcement path.

CloudFormation's `ZipFile` inline code property is capped at **4,096 characters**. The
handler is roughly two orders of magnitude past that. The alternatives were:

1. **Split the handler into a Lambda layer or several small functions** small enough
   to inline. Solves the limit by multiplying the deployment units.
2. **Build a deployment package** and reference it as `S3Bucket`/`S3Key` on
   `AWS::Lambda::Function::Code`, i.e. a build step producing a zip.
3. **Keep `ZipFile`, but make the inline code a loader** that fetches the real
   handler from S3 at cold start and `exec`s it.

Option 2 is the conventional answer. It was rejected because it makes the template
undeployable on its own: a customer receiving these templates would need a build
toolchain and a packaging step before `create-stack` would work at all, and the zip
would be an opaque artifact rather than a readable file.

## Decision

Option 3. The template's `ZipFile` is a ~40-line loader. At cold start it downloads
the handler source from `TemplatesBucket` at `BackendScriptS3Key` and executes it,
then delegates every invocation to the loaded module.

`scripts/01-admin-platform-api.py` is the readable, reviewable, diffable source of
truth, in the repository.

## Consequences

**Good:**

- The templates deploy from a plain `aws cloudformation deploy` with no build step.
- The handler is a normal Python file in git — greppable, lintable, reviewable
  line-by-line in a merge request. A zip is none of those.
- **Re-uploading the handler is a code deploy with no stack update.** No changeset,
  no risk to the domain, seconds instead of minutes. This is genuinely the fastest
  iteration loop of any option here.

**Bad, and accepted:**

- **Two non-obvious operational hazards**, both documented in
  [DEPLOYMENT.md](../DEPLOYMENT.md):
  1. A fresh upload does nothing until the function cold-starts. A warm container is
     still running the old code. A forced cold start —
     `update-function-configuration --description ...` — is **mandatory**, or the
     upload is a silent no-op that looks like a successful deploy.
  2. There is no build-time validation. `python3 -m py_compile` is the **only**
     pre-deploy gate; skip it and a syntax error surfaces as a 500 in production, at
     cold start, after the upload appeared to succeed.
- The function's code is not versioned by Lambda. `aws lambda get-function` shows the
  loader, not the handler, so "what version is running" is answered by the S3 object
  version and nothing else. Lambda aliases and `PublishVersion` are useless here.
- Cold start pays an S3 GET plus a parse of a 2,444-line module.
- The function needs `s3:GetObject` on the bucket, and the bucket becomes a runtime
  dependency: delete or corrupt the object and every invocation fails, including the
  metering job.

## What would make us revisit this

- Any need for the code artifact to be immutably versioned or rolled back — a CI
  pipeline shipping a zip is the right shape then, and the "no build step" argument
  no longer applies because there is a pipeline anyway.
- The handler outgrowing one file. The loader executes a single module; a package
  would need a different mechanism.
