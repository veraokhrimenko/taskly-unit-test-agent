---
# Settings shared by the unit test agent workflows (imported, not a workflow itself).
# Each workflow adds the bash command for its own analysis script.
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
    - "node .agents/skills/run-and-verify-tests/scripts/verify-tests.mjs:*"

network:
  allowed:
    - defaults

safe-outputs:
  # Publish as a GitHub App instead of GITHUB_TOKEN, so CI runs on the agent's commits without manual approval.
  github-app:
    app-id: ${{ vars.TEST_AGENT_APP_ID }}
    private-key: ${{ secrets.TEST_AGENT_APP_PRIVATE_KEY }}
---
