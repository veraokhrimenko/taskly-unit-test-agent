---
# Shared preparation for the unit test agent workflows (imported, not a workflow itself).
# Runs after the pull request branch is checked out and before the agent starts.
# The importing workflow must first write the input folder to AGENT_INPUT_DIR (in GITHUB_ENV)
# and the packages to prepare to "$AGENT_INPUT_DIR/packages.txt".
pre-agent-steps:
  - name: Install dependencies and measure tests and coverage before the agent
    run: |
      set -euo pipefail
      out="${AGENT_INPUT_DIR:?AGENT_INPUT_DIR is not set}"
      # The pull request's code runs in a container without network, never on the runner itself.
      for pkg in $(cat "$out/packages.txt"); do
        GATE_OUT="$out" bash .github/scripts/verify-agent-patch.sh baseline "$pkg"
      done
---
