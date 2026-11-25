---
on:
  workflow_dispatch:
    inputs:
      package:
        description: Package to improve
        type: choice
        options: [both, backend, frontend]
        default: both
      max_files:
        description: Maximum number of source files to test in this run
        type: choice
        options: ["3", "5", "8"]
        default: "5"

permissions:
  contents: read

engine:
  id: claude
  model: claude-sonnet-5-5
strict: true
timeout-minutes: 40
max-turns: 120

imports:
  - .github/agents/unit-test-engineer.md
  - shared/install-and-measure.md

skills:
  - .agents/skills/find-coverage-gaps
  - .agents/skills/write-backend-tests
  - .agents/skills/write-frontend-tests
  - .agents/skills/run-and-verify-tests
  - .agents/skills/report-results

steps:
  - name: Write the run scope
    env:
      PACKAGE: ${{ github.event.inputs.package }}
      MAX_FILES: ${{ github.event.inputs.max_files }}
    run: |
      set -euo pipefail
      out=/tmp/gh-aw/agent/coverage
      mkdir -p "$out"
      echo "AGENT_INPUT_DIR=$out" >> "$GITHUB_ENV"
      case "$PACKAGE" in
        backend|frontend) echo "$PACKAGE" > "$out/packages.txt" ;;
        *) printf 'backend\nfrontend\n' > "$out/packages.txt" ;;
      esac
      case "$MAX_FILES" in
        3|5|8) echo "$MAX_FILES" > "$out/max-files.txt" ;;
        *) echo 5 > "$out/max-files.txt" ;;
      esac

tools:
  edit:
  bash:
    - "git status"
    - "git diff:*"
    - "git log:*"
    - "git add:*"
    - "git commit:*"
    - "npm test:*"
    - "npm run test:coverage:*"
    - "npm run typecheck:*"
    - "npm exec --prefix frontend -- prettier --write:*"
    - "node .agents/skills/find-coverage-gaps/scripts/rank-coverage-gaps.mjs:*"
    - "node .agents/skills/run-and-verify-tests/scripts/verify-tests.mjs:*"

network:
  allowed:
    - defaults

safe-outputs:
  threat-detection:
    continue-on-error: false
    post-steps:
      - name: Require a successful agent run
        if: needs.agent.result != 'success'
        run: |
          echo "::error::The agent job did not succeed, so nothing will be published."
          exit 1

      - name: Apply agent patch and check changed files
        id: patch
        if: needs.agent.outputs.has_patch == 'true'
        run: |
          cp .github/scripts/verify-agent-patch.sh "$RUNNER_TEMP/verify-agent-patch.sh"
          bash "$RUNNER_TEMP/verify-agent-patch.sh" apply /tmp/gh-aw/aw-*.patch

      - name: Set up Node.js 24 for backend
        if: steps.patch.outputs.backend == 'true'
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: "24"
          cache: npm
          cache-dependency-path: backend/package-lock.json

      - name: Verify backend tests
        if: steps.patch.outputs.backend == 'true'
        run: bash "$RUNNER_TEMP/verify-agent-patch.sh" test backend

      - name: Set up Node.js 22 for frontend
        if: steps.patch.outputs.frontend == 'true'
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Verify frontend tests
        if: steps.patch.outputs.frontend == 'true'
        run: bash "$RUNNER_TEMP/verify-agent-patch.sh" test frontend

  create-pull-request:
    title-prefix: "[unit-test-agent] "
    draft: true
    allowed-files:
      - "backend/tests/**"
      - "frontend/src/**/*.test.ts"
      - "frontend/src/**/*.test.tsx"
---

# Coverage agent

Add unit tests for existing code that has no tests or weak tests, following the unit-test-engineer instructions.

## Inputs

The coverage data is prepared in `/tmp/gh-aw/agent/coverage/` and described in the `find-coverage-gaps` skill. `max-files.txt` holds the maximum number of source files you may test in this run.

## Task

1. Use `find-coverage-gaps` to choose the files to test.
2. Write the tests with `write-backend-tests` or `write-frontend-tests`.
3. Run, verify and commit them with `run-and-verify-tests`. Use `/tmp/gh-aw/agent/coverage/` as the input folder. Do not push.
4. Write the report with `report-results` and open one pull request with `create_pull_request`, using the report as the description.
