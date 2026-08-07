# Security & Vulnerability Management

This document describes how vulnerabilities found by the pipeline (see
[README.md](README.md) for the architecture) are triaged, and what
automatically blocks a merge or a deploy.

## Severity thresholds that block the pipeline

| Stage | Tool | Blocks on | Enforcement |
|---|---|---|---|
| SAST | CodeQL | Any finding tagged `error` (critical/high-confidence security queries) | `codeql.yml` uploads to the Security tab; repo should require the check to pass before merge |
| SAST | SonarCloud | Quality Gate failure (default gate fails on new Critical/Blocker issues or coverage regression on new code) | `sonarcloud` job in `ci-cd-pipeline.yml` |
| Dependency scan | `npm audit` | Any **High** or **Critical** advisory | `npm audit --audit-level=high` (non-zero exit fails the job) |
| Dependency scan | Dependabot alerts | N/A — advisory, opens PRs automatically | Enabled in repo settings, not a CI gate |
| Container scan | Trivy | Any **HIGH** or **CRITICAL** CVE in OS packages or app dependencies baked into the image | `severity: CRITICAL,HIGH` + `exit-code: 1` in `container-scan` job |
| DAST | OWASP ZAP baseline | Any ZAP alert at **WARN**/**FAIL** threshold with `-a` (include alpha/beta rules) | `fail_action: true` in `dast-zap` job |

**Medium/Low findings do not block the pipeline.** They're recorded (Security
tab, SonarCloud dashboard, job summaries) and expected to be triaged and
scheduled, not treated as merge blockers — otherwise the gate becomes noise
and gets disabled.

## Why this repo currently fails CI on purpose

`package.json` pins three dependencies to known-vulnerable versions so the
scanners have something real to catch:

| Package | Pinned version | Known issue |
|---|---|---|
| `lodash` | `4.17.15` | Prototype pollution (CVE-2020-8203), and it's the merge function actually reachable from user input at `POST /api/settings` in this app — see `src/utils.js` |
| `axios` | `0.21.0` | SSRF via redirect handling (CVE-2021-3749) |
| `minimist` | `1.2.5` | Prototype pollution via `constructor.prototype` (CVE-2021-44906) |

`npm audit` and Trivy will both report these as High/Critical and fail their
jobs, which in turn blocks `containerize` → `deploy`. That's the pipeline
doing exactly what it's supposed to do. To get a fully green run, bump the
three packages to their patched versions (`lodash@^4.17.21`,
`axios@^0.21.4` or later, `minimist@^1.2.6` or later) and re-run.

## Triage process

1. **Detect** — a scanner flags a finding in a PR check, a scheduled
   CodeQL run, or a Dependabot alert.
2. **Classify severity** — use the tool's own severity (CVSS-based for
   `npm audit`/Trivy/Dependabot, CodeQL's own risk rating, Sonar's
   severity levels). Don't re-guess it by hand.
3. **Route**:
   - **Critical/High** → merge/deploy is already blocked automatically.
     Fix (patch version bump, code change) or, if it's a confirmed false
     positive, suppress it explicitly and record why (see below) — never
     silently disable the check.
   - **Medium/Low** → file a follow-up issue, schedule normally, no gate.
4. **Fix** — patch the dependency, rewrite the vulnerable code path
   (e.g. replace `lodash.merge` with an object-spread that ignores
   `__proto__`/`constructor` keys), or upgrade the base image.
5. **Verify** — re-run the pipeline; the same job that caught it must go
   green before the change ships.
6. **Record** — for any suppressed/accepted finding, note the tool,
   finding ID, reason, and owner in the PR description so it's auditable
   later (don't just click "dismiss" with no trail).

## Suppressing a false positive

- **CodeQL**: dismiss the alert in the Security tab with a reason
  (`false positive`, `won't fix`, `used in tests`) — this is logged and
  reviewable, unlike deleting the workflow step.
- **npm audit**: prefer `npm audit fix`; if a fix genuinely isn't
  available yet, document the accepted risk in this file rather than
  lowering `--audit-level`.
- **Trivy**: use a `.trivyignore` file with the CVE ID and a comment
  explaining why (not currently present in this repo — add one only with
  a documented reason).
- **ZAP**: tune via a ZAP rules config (`-c` option) to downgrade a
  specific alert ID, with the reason in the same PR.

## Reporting a vulnerability in this project

This is a course/demo project, not a production service. If you spot an
issue with the pipeline configuration itself (as opposed to the
intentionally-seeded app vulnerabilities described above), open a GitHub
issue describing it.
