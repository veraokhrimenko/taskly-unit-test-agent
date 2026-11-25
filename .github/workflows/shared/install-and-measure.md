---
# Shared preparation for the unit test agent workflows (imported, not a workflow itself).
# Runs after the pull request branch is checked out and before the agent starts.
# The importing workflow must first write the input folder to AGENT_INPUT_DIR (in GITHUB_ENV)
# and the packages to prepare to "$AGENT_INPUT_DIR/packages.txt".
pre-agent-steps:
  - name: Set up Node.js for the project
    uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
    with:
      node-version: "24"
      cache: npm
      cache-dependency-path: |
        backend/package-lock.json
        frontend/package-lock.json

  - name: Install dependencies and record coverage before the agent
    run: |
      set -euo pipefail
      out="${AGENT_INPUT_DIR:?AGENT_INPUT_DIR is not set}"
      for pkg in $(cat "$out/packages.txt"); do
        npm ci --prefix "$pkg" --ignore-scripts --no-audit --no-fund
        if [ "$pkg" = backend ]; then npm run db:generate --prefix backend; fi
        if npm run test:coverage --prefix "$pkg" -- --coverage.reportOnFailure > "$out/$pkg-tests-before.log" 2>&1; then
          echo passed > "$out/$pkg-tests-before.status"
        else
          echo failed > "$out/$pkg-tests-before.status"
        fi
        cp "$pkg/coverage/coverage-summary.json" "$out/$pkg-coverage-before.json" || true
      done
---
