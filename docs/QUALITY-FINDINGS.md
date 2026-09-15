# Quality Findings — Disposition

Code-quality findings raised against this repository, and what happened to them.
Infrastructure and IAM findings are dispositioned separately in
[SECURITY-FINDINGS.md](SECURITY-FINDINGS.md), which also carries the scan history
shared by both documents.

**Current state:** 85 findings on the last scan on record, all `semgrep`, all
`WARNING` or `INFO`, all in the console SPA. 77 of them are one rule
(`jsx-not-internationalized`), suppressed with per-line markers after that scan was
exported. No Python or CloudFormation quality findings have ever been raised.

## Findings

### 1. `jsx-not-internationalized` — 77 findings, suppressed

| | |
|---|---|
| **Scanner** | semgrep |
| **Severity** | WARNING |
| **Files** | 22 files under `app/src/` |
| **Disposition** | **suppressed — not applicable** |

The rule wants every user-visible JSX string routed through an i18n library such
as `i18next`. This console is a single-tenant administrative tool for one
institution's staff and students, deployed per platform, with its
institution-specific text supplied as CloudFormation parameters and served from
`GET /init` at runtime. Adding an i18n framework would introduce a dependency and a
translation workflow to solve a problem the deployment model does not have.

Remediated in two passes:

- `941089b` — genuine fixes where the rule pointed at something real:
  `<html lang="en">` and document metadata in `app/index.html`, Cloudscape's
  `I18nProvider` wired up in `app/src/providers.tsx` (with `locale="en"` and only
  the `en` message bundle imported, not the 720 kB `all.all`), and locale-aware
  formatting in the tables that render dollars and dates — `AlarmEventsTable`,
  `StudentsAtRisk`, `StudentUsagePanel`, `SpendHistoryTable`, `StudentsTable`.
- `dd2f794` — the remaining 77 marked with `// nosemgrep: jsx-not-internationalized`
  / `{/* nosemgrep: ... */}` at the exact line, so the reason is visible to whoever
  next edits the string rather than buried in a config file.

**Verify:** `grep -rn "nosemgrep" app/src | wc -l` — 77 markers across 22 files,
matching the finding count exactly.

**Note on the numbers:** commit `dd2f794` landed *after* the last scan export, so
no scan on record shows the reduction. Expected next result is 85 → 8. That is a
prediction; re-run Probe before quoting it.

### 2. `package-dependencies-check` — 6 findings, false positive

| | |
|---|---|
| **Scanner** | semgrep |
| **Severity** | WARNING |
| **File** | `app/package.json` lines 20, 28–32 |
| **Disposition** | **false positive** |

The rule warns that "dependencies with variant versions may lead to dependency
hijack and confusion attacks" and asks for exact versions or a lockfile. The six
lines it flags are:

```
20:    "swr": "2.5.1"
28:    "eslint": "9.39.5",
29:    "eslint-plugin-react-hooks": "7.1.1",
30:    "globals": "17.11.0",
31:    "typescript": "5.9.3",
32:    "typescript-eslint": "8.68.0",
```

Every one is already an exact pin, and `app/package-lock.json` is committed. The
finding does not describe the current file.

What the rule *would* have a point about, and is accepted: seven entries do still
carry caret ranges — three Cloudscape runtime packages (`@cloudscape-design/*`, kept
floating deliberately so design-token and accessibility fixes arrive without a
version bump) and four dev-only `@types`/`@eslint` packages that never reach the
built bundle. All seven are resolved to exact versions by the committed lockfile,
which is what `npm ci` installs from.

### 3. `missing-template-string-indicator` — 2 findings, false positive

| | |
|---|---|
| **Scanner** | semgrep |
| **Severity** | INFO |
| **File** | `app/src/components/me/StudentUsagePanel.tsx:207` |
| **Disposition** | **false positive** |

"This looks like a JavaScript template string. Are you missing a `$` in front of
`{...}`?" — it is JSX interpolation inside a plain string, not a template literal
with a missing sigil. Reported twice for the same line. Left unsuppressed: it is
`INFO`, and a suppression comment would be noisier than the finding.

## The real quality gap

None of the above is the thing most worth fixing. Two gaps matter more than any
finding on this page, and no scanner reports either:

1. **There are no automated tests.** Not a single unit test exists for a
   2,444-line backend handler that attaches IAM deny policies and deletes running
   notebooks. The handler does carry a local development harness
   (`if __name__ == "__main__":`) with a `preflight()` credential/IAM check and
   commented-out job invocations, which is a manual smoke test — not a suite.
   Anything that changes `_sync_usage_one`, `_enforce_breach` or
   `UsageLedger.add_to_period` is verified by reading it.

2. **Cap enforcement has never run end-to-end.** No student has launched
   JupyterLab against this deployment, so no `SESSION#` ledger row has ever been
   written and `_enforce_breach` has never fired. Everything the documentation says
   about enforcement describes the design, not observed behaviour. The outstanding
   verification is the cap-drop test:
   [DEPLOYMENT.md](DEPLOYMENT.md#checking-the-meter-is-actually-running).

Both are recorded here rather than in a backlog because a quality document that
lists three false positives and omits "untested" would be misleading.

## If you re-scan

- Record the scan in the history table in
  [SECURITY-FINDINGS.md](SECURITY-FINDINGS.md#scan-history).
- A new `jsx-not-internationalized` finding means a JSX string was added without a
  marker. Add the marker at the line; do not add a config-wide exclusion, which
  would hide the rule from anyone who later decides i18n *is* in scope.
- Do not "fix" a finding in `cloudformation/` without reading the
  `SECURITY-SCANNER TRIAGE` block above `Resources:` first. Several suppressions
  there protect the cost control itself.
