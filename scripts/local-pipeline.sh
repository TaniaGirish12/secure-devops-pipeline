#!/usr/bin/env bash
# Runs the pipeline's stages on this machine, in the same order and with the same
# gates as .github/workflows/ci-cd-pipeline.yml, and prints a pass/fail table.
#
# Needs: Node/npm and a running Docker. CodeQL (GitHub-only) and SonarCloud (needs an
# account token) are not run here and are listed as skipped.
#
#   ./scripts/local-pipeline.sh
#
# Per-stage logs and the ZAP HTML report are written to ./reports/.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.docker/bin:$PATH"

IMAGE="secure-devops-demo:local"
CONTAINER="app-under-test"
PORT=3000
REPORTS="reports"
mkdir -p "$REPORTS"

SUMMARY=""
FAILED=0

record() { # name, status
  SUMMARY="${SUMMARY}$(printf '%-34s %s' "$1" "$2")"$'\n'
  [ "$2" = "FAIL" ] && FAILED=1
}

stage() { # name, logfile-slug, command...
  local name="$1" slug="$2"; shift 2
  printf '>> %s ... ' "$name"
  if "$@" >"$REPORTS/$slug.log" 2>&1; then
    echo PASS; record "$name" PASS
  else
    echo "FAIL (see $REPORTS/$slug.log)"; record "$name" FAIL
  fi
}

stop_app() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap stop_app EXIT

start_app() {
  stop_app
  docker run -d --rm --name "$CONTAINER" -p "$PORT:3000" "$IMAGE" >/dev/null || return 1
  for _ in $(seq 1 20); do
    curl -sf "http://localhost:$PORT/health" >/dev/null && return 0
    sleep 2
  done
  return 1
}

# --- 1. Build & unit tests, lint, dependency scan -----------------------------
stage "Build & unit tests"          build-test   bash -c 'npm ci && npm test'
stage "Lint (ESLint)"               lint         npm run lint
stage "Dependency scan (npm audit)" npm-audit    npm audit --audit-level=high

# --- 2. Containerize ----------------------------------------------------------
stage "Containerize (docker build)" docker-build docker build --pull -t "$IMAGE" .

# --- 3. Container scan (Trivy) -------------------------------------------------
stage "Container scan (Trivy)"      trivy        docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image \
  --skip-version-check -q --severity CRITICAL,HIGH --exit-code 1 "$IMAGE"

# --- 4. DAST (OWASP ZAP baseline) ---------------------------------------------
dast() {
  start_app || { echo "app did not become healthy"; return 1; }
  local work; work="$(mktemp -d)"
  mkdir -p "$work/.zap" && cp .zap/rules.tsv "$work/.zap/" && chmod -R a+w "$work"
  docker run --rm --add-host=host.docker.internal:host-gateway \
    -v "$work:/zap/wrk/:rw" ghcr.io/zaproxy/zaproxy:stable \
    zap-baseline.py -t "http://host.docker.internal:$PORT" \
    -J report_json.json -w report_md.md -r report_html.html -a -c .zap/rules.tsv
  local rc=$?
  cp "$work/report_html.html" "$REPORTS/zap-report.html" 2>/dev/null || true
  rm -rf "$work"
  stop_app
  return $rc
}
stage "DAST (OWASP ZAP baseline)"   zap          dast

# --- 5. Deploy (simulated, as in the workflow when no Render hook is set) ------
deploy_sim() {
  start_app || return 1
  curl -sf "http://localhost:$PORT/health" && stop_app
}
stage "Deploy (simulated docker run)" deploy     deploy_sim

record "SAST: CodeQL"               "SKIPPED (GitHub-only)"
record "SAST: SonarCloud"           "SKIPPED (needs SONAR_TOKEN)"

echo
echo "================ Local pipeline summary ================"
printf '%s' "$SUMMARY"
echo "========================================================"
[ "$FAILED" -eq 0 ] && echo "ALL RUN STAGES PASSED" || echo "SOME STAGES FAILED"
exit "$FAILED"
