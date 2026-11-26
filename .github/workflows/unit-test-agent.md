---
on:
  pull_request:
    types: [opened, synchronize, reopened]
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
        > "$out/pr.diff" || echo "Diff too large for the API; use the file list." > "$out/pr.diff"
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

      - name: Check that backend tests detect the change
        if: steps.patch.outputs.backend == 'true'
        continue-on-error: true
        env:
          PR_BASE: ${{ github.event.pull_request.base.sha }}
          AGENT_BASE: ${{ steps.patch.outputs.agent_base }}
        run: bash "$RUNNER_TEMP/verify-agent-patch.sh" old-code backend "$PR_BASE" "$AGENT_BASE"

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

      - name: Check that frontend tests detect the change
        if: steps.patch.outputs.frontend == 'true'
        continue-on-error: true
        env:
          PR_BASE: ${{ github.event.pull_request.base.sha }}
          AGENT_BASE: ${{ steps.patch.outputs.agent_base }}
        run: bash "$RUNNER_TEMP/verify-agent-patch.sh" old-code frontend "$PR_BASE" "$AGENT_BASE"

  add-comment:
    max: 1
    hide-older-comments: true
  push-to-pull-request-branch:
    allowed-files:
      - "backend/tests/**"
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
