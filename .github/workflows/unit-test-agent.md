---
on:
  pull_request:
    # Runs once when a pull request is opened or leaves draft, and again only on request:
    # add the label "unit-tests". Pushes do not start it.
    types: [opened, reopened, ready_for_review, labeled]
    names: [unit-tests]
    draft: false
    paths:
      - "backend/**"
      - "frontend/**"
      - "!**/*.md"

permissions:
  contents: read
  pull-requests: read

engine:
  id: claude
  model: claude-sonnet-5-5
strict: true
# One run at a time per pull request. A newer request waits: cancelling could stop a run
# between its push and its report.
# A run that only exists because some other label was added gets its own group, so it
# cannot cancel a real run.
concurrency:
  group: "gh-aw-${{ github.workflow }}-${{ github.event.pull_request.number }}-${{ (github.event.action == 'labeled' && github.event.label.name != 'unit-tests') && github.run_id || 'agent' }}"
  cancel-in-progress: false
timeout-minutes: 20
max-turns: 60

imports:
  - .github/agents/unit-test-engineer.md
  - shared/install-and-measure.md
  - shared/agent-common.md

skills:
  - .agents/skills/analyze-pr-changes
  - .agents/skills/write-backend-tests
  - .agents/skills/write-frontend-tests
  - .agents/skills/run-and-verify-tests
  - .agents/skills/report-results

steps:
  - name: Collect PR context
    env:
      GH_TOKEN: ${{ github.token }}
      REPO: ${{ github.repository }}
      PR_NUMBER: ${{ github.event.pull_request.number }}
    run: |
      set -euo pipefail
      out=/tmp/gh-aw/agent/pr
      mkdir -p "$out"
      echo "AGENT_INPUT_DIR=$out" >> "$GITHUB_ENV"
      gh api --paginate "repos/$REPO/pulls/$PR_NUMBER/files" \
        --jq '.[] | [.status, .filename] | @tsv' > "$out/changed-files.tsv"
      gh api -H "Accept: application/vnd.github.diff" "repos/$REPO/pulls/$PR_NUMBER" \
        > "$out/pr.diff" || echo "The diff could not be fetched (it may be too large, or the API failed); use the file list and read the files." > "$out/pr.diff"
      gh api "repos/$REPO/pulls/$PR_NUMBER" --jq '{title, body}' > "$out/pr.json"
      gh api --paginate "repos/$REPO/pulls/$PR_NUMBER/commits" --jq '.[].commit.message' > "$out/commits.txt"
      cut -f2 "$out/changed-files.tsv" | cut -d/ -f1 | grep -xE 'backend|frontend' | sort -u > "$out/packages.txt" || true

tools:
  bash:
    - "node .agents/skills/analyze-pr-changes/scripts/classify-changes.mjs:*"

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

      - name: Check that backend tests detect the change
        if: steps.patch.outputs.backend == 'true'
        continue-on-error: true
        env:
          PR_BASE: ${{ github.event.pull_request.base.sha }}
        run: bash "$RUNNER_TEMP/gate/verify-agent-patch.sh" old-code backend "$PR_BASE"

      - name: Verify frontend tests
        if: steps.patch.outputs.frontend == 'true'
        run: bash "$RUNNER_TEMP/gate/verify-agent-patch.sh" test frontend

      - name: Check that frontend tests detect the change
        if: steps.patch.outputs.frontend == 'true'
        continue-on-error: true
        env:
          PR_BASE: ${{ github.event.pull_request.base.sha }}
        run: bash "$RUNNER_TEMP/gate/verify-agent-patch.sh" old-code frontend "$PR_BASE"

      - name: Keep the gate's results for the pull request comment
        if: always() && steps.patch.outcome != 'skipped'
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: gate-summary
          path: ${{ runner.temp }}/gate-out/summary.md
          if-no-files-found: ignore

  add-comment:
    max: 1
    hide-older-comments: true
  push-to-pull-request-branch:
    allowed-files:
      - "backend/tests/*.test.ts"
      - "backend/tests/**/*.test.ts"
      - "frontend/src/**/*.test.ts"
      - "frontend/src/**/*.test.tsx"
---

# Unit test agent

A pull request changed code in this repository. Add or update unit tests for the changed behaviour, following the unit-test-engineer instructions.

## Inputs

The pull request context is prepared in `/tmp/gh-aw/agent/pr/` and described in the `analyze-pr-changes` skill. Use only these files to decide what changed.

## Task

1. Use `analyze-pr-changes` to decide which files need tests.
2. If no tests are needed, go to step 4.
3. Write the tests, then run, verify and commit them with `run-and-verify-tests`, and push them with `push_to_pull_request_branch`.
4. Post one comment on this pull request with `report-results`.
