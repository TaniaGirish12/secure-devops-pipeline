# Security & Vulnerability Management

This document describes how vulnerabilities found by the pipeline (see
[README.md](README.md) for the architecture) are triaged, and what
automatically blocks a merge or a deploy.

## Severity thresholds that block the pipeline

| Stage | Tool | Blocks on | Enforcement |
|---|---|---|---|
| SAST | CodeQL | Alerts at error severity (critical/high-confidence security queries) | `codeql.yml` uploads to the Security tab; blocking requires making the check and a code-scanning alert threshold required in branch rules (the job itself does not fail) |
| SAST | SonarCloud | Quality Gate failure (default gate fails on new Critical/Blocker issues or coverage regression on new code) | `sonarcloud` job in `ci-cd-pipeline.yml` |
| Dependency scan | `npm audit` | Any **High** or **Critical** advisory | `npm audit --audit-level=high` (non-zero exit fails the job) |
| Dependency scan | Dependabot alerts | N/A — advisory, opens PRs automatically | Enabled in repo settings, not a CI gate |
| Container scan | Trivy | Any **HIGH** or **CRITICAL** CVE in OS packages or app dependencies baked into the image | `severity: CRITICAL,HIGH` + `exit-code: 1` in `container-scan` job |
| DAST | OWASP ZAP baseline | Any ZAP alert at **WARN**/**FAIL** threshold with `-a` (include alpha/beta rules) | `fail_action: true` in `dast-zap` job |

**Medium/Low findings do not block the pipeline.** They're recorded (Security
tab, SonarCloud dashboard, job summaries) and expected to be triaged and
scheduled, not treated as merge blockers — otherwise the gate becomes noise
and gets disabled.

## Worked example: seeded vulnerabilities and how they were fixed

The first commit (`git log --reverse`) pinned three dependencies to
known-vulnerable versions so the scanners had something real to catch:

| Package | Pinned version | Known issue |
|---|---|---|
| `lodash` | `4.17.15` | Prototype pollution (CVE-2020-8203). It is the merge function actually reachable from user input at `POST /api/settings`, see `src/utils.js` |
| `axios` | `0.21.0` | SSRF via redirect handling (CVE-2021-3749) |
| `minimist` | `1.2.5` | Prototype pollution via `constructor.prototype` (CVE-2021-44906) |

On that commit `npm audit` (2 high, 1 critical) and Trivy (47 HIGH/CRITICAL,
including npm's own bundled `tar`/`glob` in the `node:20-alpine` base image and
OpenSSL in Alpine) failed their jobs, which blocks `containerize` -> `deploy`.

The fixes, in the order a triage would apply them:

1. **Dependencies:** `lodash` upgraded to a patched release; `axios` and
   `minimist` removed because nothing imported them; `express` upgraded.
2. **Container:** base image moved to `node:22-alpine`, `apk upgrade` applied,
   and npm removed from the runtime stage (the app only needs `node`).
3. **DAST (OWASP ZAP baseline, 7 warnings):** added `helmet` for security
   headers, removed `X-Powered-By`, added `Permissions-Policy` and
   `Cache-Control: no-store`, and added a JSON 404 handler so Express's default
   error page no longer overrides the CSP. Unit tests assert these headers.
4. **Documented suppressions** in `.zap/rules.tsv` (see below).

Result: `npm audit`, Trivy (HIGH/CRITICAL) and the ZAP baseline all exit 0.

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
- **ZAP**: tune via the rules file `.zap/rules.tsv` (wired into the workflow
  with `rules_file_name`), one line per rule ID with the reason beside it. Two
  are currently ignored: `90005` (an alpha rule about the scanner's own
  request headers, not the app) and `10049` (informational note that
  responses are `no-store`, which is intentional for this API).

## Reporting a vulnerability in this project

This is a demo project, not a production service. If you spot an issue with
the pipeline configuration itself, open a GitHub issue describing it.
