#!/usr/bin/env bash
# Deterministic gate for the unit test agent.
# Runs in the threat detection job, before safe outputs are published.
# Any non-zero exit fails the detection job, so nothing is pushed or commented.
#
# Usage:
#   verify-agent-patch.sh apply <patch-file>   apply the agent patch, check changed files
#   verify-agent-patch.sh test <package>       install, run tests with coverage, typecheck,
#                                              and for the frontend the Prettier check that CI runs
#   verify-agent-patch.sh old-code <package> <pr-base-sha> <agent-base-sha>
#                                              report whether the new tests fail on the code before the PR
set -euo pipefail

summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
output="${GITHUB_OUTPUT:-/dev/null}"

apply_patch() {
  # The agent produces one patch. More than one would mean that only some were checked.
  if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
    echo "::error::Expected exactly one patch file, got: $*"
    exit 1
  fi
  local patch="$1"
  local base
  base=$(grep -m1 '^X-GH-AW-Base-Commit: ' "$patch" | cut -d' ' -f2)
  if [ -z "$base" ]; then
    echo "::error::Patch has no X-GH-AW-Base-Commit header"
    exit 1
  fi

  # Apply the patch exactly onto the commit the agent worked from.
  git fetch --no-tags --depth=1 origin "$base"
  git checkout --quiet --detach "$base"
  git -c user.name=verify -c user.email=verify@localhost am --quiet "$patch"

  # Only test files may change, and no test file may be deleted.
  local changed deleted disallowed
  changed=$(git diff --name-only --no-renames "$base"..HEAD)
  deleted=$(git diff --name-only --no-renames --diff-filter=D "$base"..HEAD)
  disallowed=$(printf '%s\n' "$changed" | grep -vE '^backend/tests/.+|^frontend/src/.+\.test\.tsx?$' || true)

  {
    echo "### Agent patch"
    echo
    printf '%s\n' "$changed" | sed 's/^/- `/; s/$/`/'
    echo
  } >> "$summary"

  if [ -n "$disallowed" ]; then
    echo "::error::Agent patch changes non-test files: $(echo $disallowed)"
    exit 1
  fi
  if [ -n "$deleted" ]; then
    echo "::error::Agent patch deletes test files: $(echo $deleted)"
    exit 1
  fi

  # Tell the next steps which packages to verify, and where the agent started.
  echo "agent_base=$base" >> "$output"
  printf '%s\n' "$changed" | grep -q '^backend/' && echo "backend=true" >> "$output"
  printf '%s\n' "$changed" | grep -q '^frontend/' && echo "frontend=true" >> "$output"
  return 0
}

test_package() {
  local pkg="$1"
  npm ci --prefix "$pkg" --ignore-scripts --no-audit --no-fund
  if [ "$pkg" = backend ]; then npm run db:generate --prefix backend; fi

  local tests=passed typecheck=passed format="not run"
  npm run test:coverage --prefix "$pkg" || tests=failed
  npm run typecheck --prefix "$pkg" || typecheck=failed
  if [ "$pkg" = frontend ]; then
    format=passed
    npm run format:check --prefix frontend || format=failed
  fi

  local lines="n/a"
  if [ -f "$pkg/coverage/coverage-summary.json" ]; then
    lines=$(node -e "console.log(require('./$pkg/coverage/coverage-summary.json').total.lines.pct + '%')")
  fi

  {
    echo "### $pkg ($(node --version))"
    echo
    echo "| Check | Result |"
    echo "| --- | --- |"
    echo "| Tests | $tests |"
    echo "| Typecheck | $typecheck |"
    echo "| Prettier | $format |"
    echo "| Line coverage after | $lines |"
    echo
  } >> "$summary"

  [ "$tests" = passed ] && [ "$typecheck" = passed ] && [ "$format" != failed ]
}

old_code_check() {
  local pkg="$1" pr_base="$2" agent_base="$3"
  local tests sources src result

  # New or changed test files from the agent, relative to the package.
  tests=$(git diff --name-only --no-renames --diff-filter=AM "$agent_base"..HEAD -- "$pkg" | sed "s#^$pkg/##")
  # Source files changed by the pull request itself.
  git fetch --no-tags --depth=1 origin "$pr_base"
  sources=$(git diff --name-only --no-renames "$pr_base" "$agent_base" -- "$pkg/src")

  if [ -z "$tests" ] || [ -z "$sources" ]; then
    result="not applicable (no source change in this package)"
  else
    # Put the changed source files back to their state before the pull request.
    for src in $sources; do
      if git cat-file -e "$pr_base:$src" 2>/dev/null; then git checkout --quiet "$pr_base" -- "$src"; else rm -f "$src"; fi
    done
    # shellcheck disable=SC2086
    if npm test --prefix "$pkg" -- $tests > /dev/null 2>&1; then
      result="⚠️ the new tests also pass on the code before this pull request, so they may not test the change (expected for refactoring)"
    else
      result="✅ the new tests fail on the code before this pull request, so they detect the change"
    fi
    # Restore the pull request version of the source files.
    git checkout --quiet HEAD -- "$pkg/src"
    git clean -fdq -- "$pkg/src"
  fi

  {
    echo "**$pkg: do the new tests detect the change?** $result"
    echo
  } >> "$summary"
}

case "${1:-}" in
  apply) shift; apply_patch "$@" ;;
  test) test_package "${2:?package required}" ;;
  old-code) old_code_check "${2:?package required}" "${3:?pr base sha required}" "${4:?agent base sha required}" ;;
  *) echo "usage: $0 apply <patch> | test <package> | old-code <package> <pr-base> <agent-base>" >&2; exit 2 ;;
esac
