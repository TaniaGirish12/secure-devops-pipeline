# Secure DevOps Pipeline — Project 19

A small Node.js/Express app used as the deployment target for a CI/CD
pipeline that integrates security checks at every stage: source → build/test
→ lint → SAST → dependency scan → containerize → container scan → DAST →
deploy → alerting.

This was built for a Software Security course assignment ("Build a Secure
CI/CD Pipeline"). The app itself is intentionally minimal — the pipeline is
the point.

## Architecture

```
push / PR to main
        │
        ▼
 ┌─────────────┐   ┌────────┐   ┌──────────────────┐
 │ Build & Test │──▶│  Lint  │──▶│ SAST: CodeQL      │  (own workflow, codeql.yml)
 └─────────────┘   └────────┘   │ SAST: SonarCloud   │
        │                       └──────────────────┘
        ▼
 ┌──────────────────────┐
 │ Dependency scan       │  npm audit --audit-level=high
 │ (+ Dependabot alerts) │
 └──────────────────────┘
        │
        ▼
 ┌─────────────────────┐
 │ Containerize & push  │  docker build → ghcr.io
 └─────────────────────┘
        │
        ├──────────────┐
        ▼              ▼
 ┌──────────────┐  ┌──────────────────┐
 │ Container scan│  │ DAST: OWASP ZAP  │  run the built image, attack it live
 │ (Trivy)        │  │ baseline scan    │
 └──────────────┘  └──────────────────┘
        │              │
        └──────┬───────┘
               ▼
         ┌──────────┐
         │  Deploy   │  Render (or simulated `docker run` in CI)
         └──────────┘
               │
               ▼
       ┌────────────────┐
       │ Report & notify │  job summary + PR comment + Slack on failure
       └────────────────┘
```

Every job after `containerize` depends on the ones before it passing, so a
high/critical finding anywhere in the chain blocks `deploy`. See
[SECURITY.md](SECURITY.md) for the exact thresholds and triage process.

## Repo layout

```
src/               Express app (app.js, server.js, utils.js)
test/              Jest + Supertest unit tests
Dockerfile         Multi-stage, non-root, healthcheck
.github/workflows/ ci-cd-pipeline.yml (main pipeline), codeql.yml (SAST)
.github/dependabot.yml
sonar-project.properties
SECURITY.md        Vulnerability management process
```

## Tool roles

| Tool | Stage | Role |
|---|---|---|
| **GitHub Actions** | orchestration | Runs every stage below on push/PR to `main` |
| **ESLint** | lint | Static code-quality/style checks (`eslint:recommended`) |
| **CodeQL** | SAST | GitHub's semantic code scanner — injection, prototype pollution, ReDoS, etc. Runs as its own workflow (`codeql.yml`) so it can hold `security-events: write` independently and run on a weekly schedule too |
| **SonarCloud** | SAST | Code smells, maintainability, duplicated code, coverage-on-new-code, quality gate |
| **npm audit** | dependency scan | Flags known-vulnerable npm packages by CVE, fails on High/Critical |
| **Dependabot** | dependency scan | Out-of-band: opens PRs to bump vulnerable/outdated deps (npm, Docker base image, GitHub Actions) on a weekly cadence |
| **Docker + GHCR** | containerize | Builds the app image, publishes it to `ghcr.io/<owner>/<repo>` |
| **Trivy** | container scan | Scans the built image (OS packages + app deps) for CRITICAL/HIGH CVEs before it's allowed to deploy |
| **OWASP ZAP (baseline)** | DAST | Runs the actual container and attacks it over HTTP — catches runtime issues static tools can't (headers, error verbosity, live endpoints) |
| **Render** | deploy | Free-tier deploy target, triggered via a deploy hook; falls back to a simulated `docker run` inside the CI job if no Render account is connected |
| **GitHub job summaries / PR comments / Slack webhook** | alerting | Every run gets a summary table; PRs get a comment; Slack fires only on failure |

## Running locally

```bash
npm install
npm test          # unit tests (Jest + Supertest)
npm run lint       # ESLint
npm start          # serves on http://localhost:3000
```

Try it:

```bash
curl http://localhost:3000/health
curl "http://localhost:3000/api/greet?name=Ada"
curl -X POST http://localhost:3000/api/settings -H 'content-type: application/json' -d '{"theme":"dark"}'
```

### Run it containerized

```bash
docker build -t secure-devops-demo .
docker run --rm -p 3000:3000 secure-devops-demo
curl http://localhost:3000/health
```

### Run the same scans locally that CI runs

```bash
npm audit --audit-level=high                 # dependency scan
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image secure-devops-demo       # container scan
docker run --rm -t owasp/zap2docker-stable \
  zap-baseline.py -t http://host.docker.internal:3000  # DAST (app must be running)
```

## One-time repo setup (for anyone forking/running this on real GitHub)

1. **Branch protection / PR-based workflow**
   Settings → Branches → add a rule for `main`: require a pull request
   before merging, require status checks to pass (`Build & Unit Tests`,
   `Lint (ESLint)`, `CodeQL SAST / Analyze`, `SAST (SonarCloud)`,
   `Dependency Scan (npm audit)`), require branches to be up to date.

2. **Dependabot alerts**
   Settings → Code security and analysis → enable **Dependabot alerts**
   and **Dependabot security updates**. `.github/dependabot.yml` in this
   repo already configures the update PRs themselves.

3. **Secrets** (Settings → Secrets and variables → Actions → New repository secret)

   | Secret | Required for | Notes |
   |---|---|---|
   | `SONAR_TOKEN` | SonarCloud job | Create a SonarCloud org + project, generate a token under My Account → Security |
   | `SONAR_HOST_URL` | SonarCloud job | Optional — defaults to `https://sonarcloud.io` if unset |
   | `RENDER_DEPLOY_HOOK_URL` | Deploy job | Render service → Settings → Deploy Hook. If unset, the deploy job **simulates** the deploy by running the built container instead of failing |
   | `SLACK_WEBHOOK_URL` | Notify job | Slack → Incoming Webhooks app. If unset, the Slack step is skipped (no failure) |

   `GITHUB_TOKEN` (GHCR push, PR comments, SARIF upload) is provided
   automatically by Actions — no setup needed.

4. **sonar-project.properties**
   Replace `YOUR_SONARCLOUD_PROJECT_KEY` and `YOUR_SONARCLOUD_ORG` with
   the values SonarCloud shows when you create the project.

## Interpreting scan results

- **PR comment / job summary** (`Report & Notify` job) — the fastest way
  to see pass/fail per stage without opening each job.
- **Security tab** (repo → Security → Code scanning alerts) — CodeQL and
  Trivy both upload SARIF here, with file/line-level detail.
- **SonarCloud dashboard** — code smells, duplication, coverage trend,
  and the Quality Gate status, linked from the `sonarcloud` job.
- **`npm audit` job summary** — vulnerability counts by severity; run
  `npm audit` locally for the full advisory text and fix suggestions.
- **ZAP** — the action attaches a Markdown report as a workflow
  artifact; look for `FAIL`/`WARN` rows.

See [SECURITY.md](SECURITY.md) for what severity blocks what, and the
triage process for anything that gets flagged.
