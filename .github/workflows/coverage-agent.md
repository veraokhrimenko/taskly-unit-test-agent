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
  - shared/agent-common.md

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
  bash:
    - "node .agents/skills/find-coverage-gaps/scripts/rank-coverage-gaps.mjs:*"

safe-outputs:
  threat-detection:
    continue-on-error: false
    post-steps:
      - name: Require a successful agent run
        if: needs.agent.result != 'success'
        run: |
          echo "::error::The agent job did not succeed, so nothing will be published."
          exit 1

      - name: Apply agent patch and check what it changes
        id: patch
        if: needs.agent.outputs.has_patch == 'true'
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha || github.sha }}
        run: |
          # The gate's scripts come from the base branch, like the agent's prompt and skills, so
          # a pull request cannot bring its own gate.
          mkdir -p "$RUNNER_TEMP/gate"
          git fetch --no-tags --quiet --depth=1 origin "$BASE_SHA"
          for file in verify-agent-patch.sh gate-report.mjs; do
            git show "$BASE_SHA:.github/scripts/$file" > "$RUNNER_TEMP/gate/$file"
          done
          # The patch rules live in the skill, so the agent and the gate use one implementation.
          git show "$BASE_SHA:.agents/skills/run-and-verify-tests/scripts/patch-rules.mjs" > "$RUNNER_TEMP/gate/patch-rules.mjs"
          bash "$RUNNER_TEMP/gate/verify-agent-patch.sh" apply /tmp/gh-aw/aw-*.patch

      - name: Verify backend tests
        if: steps.patch.outputs.backend == 'true'
        run: bash "$RUNNER_TEMP/gate/verify-agent-patch.sh" test backend

      - name: Verify frontend tests
        if: steps.patch.outputs.frontend == 'true'
        run: bash "$RUNNER_TEMP/gate/verify-agent-patch.sh" test frontend

      - name: Keep the gate's results for the pull request comment
        if: always() && steps.patch.outcome != 'skipped'
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: gate-summary
          path: ${{ runner.temp }}/gate-out/summary.md
          if-no-files-found: ignore

  create-pull-request:
    title-prefix: "[unit-test-agent] "
    draft: true
    allowed-files:
      - "backend/tests/*.test.ts"
      - "backend/tests/**/*.test.ts"
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
