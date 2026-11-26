#!/usr/bin/env bash
# Deterministic checks around the unit test agent.
#
# The gate (apply, test, old-code) runs in the threat detection job, before anything is
# published. Any non-zero exit fails that job, so nothing is pushed or commented.
# The baseline runs before the agent starts.
#
# Code from the pull request and from the agent never runs on the runner itself. It runs in a
# container that sees only the checkout: no secrets, no runner files, and no network once the
# dependencies are installed.
#
# Usage:
#   verify-agent-patch.sh baseline <package>      install, measure tests and coverage before the agent
#   verify-agent-patch.sh apply <patch-file>      apply the agent patch, check what it changes
#   verify-agent-patch.sh test <package>          install, check that no test disappeared, run
#                                                 tests with coverage, typecheck and Prettier
#   verify-agent-patch.sh old-code <package> <pr-base-sha>
#                                                 report how the new tests behave on the code
#                                                 from before the pull request
#
# Results go to the step summary and to $GATE_OUT (default $RUNNER_TEMP/gate-out). Containers
# can write only to its "box" subfolder.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
output="${GITHUB_OUTPUT:-/dev/null}"
out="${GATE_OUT:-${RUNNER_TEMP:-/tmp}/gate-out}"
# The only folder a container can write results to. The summary and the other files that the
# gate itself writes stay in $out, where code under test cannot reach them.
box_out="$out/box"
mkdir -p "$box_out"

# Print to the step summary and keep a copy for the pull request comment.
say() { tee -a "$summary" >> "$out/summary.md"; }

# Node versions from the Dockerfiles, pinned by digest.
image_for() {
  case "$1" in
    backend) echo "node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530" ;;
    frontend) echo "node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb" ;;
  esac
}

# box <bridge|none> <package> <command...>: run a command in the package folder, in a container.
# .git is read-only: code in the container must not be able to change the Git configuration or
# hooks, because Git commands run on the runner afterwards (core.fsmonitor would run there).
# The agent's own folders are read-only too: the baseline runs the pull request's tests before
# the agent starts, and they must not be able to rewrite its prompt, skills or scripts.
box() {
  local network="$1" pkg="$2"
  shift 2
  local protected=() dir
  for dir in .git .github .agents .claude; do
    [ -e "$PWD/$dir" ] && protected+=(-v "$PWD/$dir:/work/$dir:ro")
  done
  docker run --rm --network "$network" --user "$(id -u):$(id -g)" \
    -e HOME=/tmp/home -e CI=true \
    -v "$PWD:/work" ${protected[@]+"${protected[@]}"} -v "$box_out:/out" -v "$here:/gate:ro" \
    -w "/work/$pkg" \
    "$(image_for "$pkg")" "$@"
}

# Dependencies need the network; install scripts are disabled. Generating the Prisma client
# needs it too (Prisma downloads its engine), and it loads prisma.config.ts, so this one step
# runs project code with network access. The container holds no secrets.
install() {
  local pkg="$1"
  box bridge "$pkg" npm ci --ignore-scripts --no-audit --no-fund
  if [ "$pkg" = backend ]; then box bridge backend npm run db:generate; fi
}

# For the agent's own check "do my tests detect the change?": the source files of the package
# as they were before the pull request, and the commit the agent starts from.
export_old_sources() {
  local pkg="$1" merge_base file
  git rev-parse HEAD > "$out/agent-start.sha"
  [ -n "${PR_BASE:-}" ] || return 0
  git fetch --no-tags --quiet --unshallow origin 2> /dev/null || true
  git fetch --no-tags --quiet origin "$PR_BASE" 2> /dev/null || true
  merge_base=$(git merge-base "$PR_BASE" HEAD 2> /dev/null || echo "$PR_BASE")
  mkdir -p "$out/old-src"
  git diff --name-only --no-renames "$merge_base" HEAD -- "$pkg/src" \
    | grep -vE '\.test\.tsx?$|^frontend/src/test/' | while IFS= read -r file; do
    if git cat-file -e "$merge_base:$file" 2> /dev/null; then
      mkdir -p "$out/old-src/files/$(dirname "$file")"
      git show "$merge_base:$file" > "$out/old-src/files/$file"
      echo "$file" >> "$out/old-src/changed.txt"
    else
      echo "$file" >> "$out/old-src/added.txt"
    fi
  done || true
}

# Claude Code reads instruction files such as CLAUDE.md from the folders it works in. The agent's
# instructions come from the base branch, so such a file from the pull request, or one that a
# test created during the baseline, must not reach the agent.
guard_instruction_files() {
  local file
  while IFS= read -r file; do
    file="${file#./}"
    if git ls-files --error-unmatch -- "$file" > /dev/null 2>&1; then
      if [ -n "${PR_BASE:-}" ] && git diff --quiet "$PR_BASE" -- "$file" 2> /dev/null; then continue; fi
      echo "::error::The pull request adds or changes the agent instruction file $file. The agent does not run on such a pull request."
      exit 1
    fi
    echo "::warning::Removed the instruction file $file, which is not part of the repository."
    rm -f "$file"
  done < <(find . \( -name node_modules -o -name .git -o -path ./.github -o -path ./.agents -o -path ./.claude \) -prune \
    -o -type f \( -name CLAUDE.md -o -name CLAUDE.local.md -o -name AGENTS.md \) -print)
}

baseline() {
  local pkg="$1"
  export_old_sources "$pkg"
  install "$pkg"
  box none "$pkg" npm run test:coverage -- --coverage.reportOnFailure \
    --reporter=default --reporter=json "--outputFile.json=/out/$pkg-results-before.json" \
    > "$out/$pkg-tests-before.log" 2>&1 && local code=0 || local code=$?

  # "failed" means failing tests. Coverage thresholds are reported separately, because the
  # agent can fix them by adding tests.
  local passed failed total
  read -r passed failed total <<< "$(box none "$pkg" node /gate/gate-report.mjs counts "/out/$pkg-results-before.json")"
  if [ "$code" -eq 0 ]; then
    echo passed > "$out/$pkg-tests-before.status"
  elif [ "${failed:-1}" -eq 0 ] && [ "${total:-0}" -gt 0 ]; then
    echo passed > "$out/$pkg-tests-before.status"
    echo failed > "$out/$pkg-thresholds-before.status"
  else
    echo failed > "$out/$pkg-tests-before.status"
  fi
  cp "$pkg/coverage/coverage-summary.json" "$out/$pkg-coverage-before.json" 2>/dev/null || true
  guard_instruction_files
}

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
  git cat-file -e "$base^{commit}" 2> /dev/null || git fetch --no-tags --depth=1 origin "$base"
  git checkout --quiet --detach "$base"
  git -c user.name=verify -c user.email=verify@localhost am --quiet "$patch"

  local changed
  changed=$(git diff --name-only --no-renames "$base"..HEAD)

  {
    echo "### Agent patch"
    echo
    printf '%s\n' "$changed" | sed 's/^/- `/; s/$/`/'
    echo
  } | say

  # The patch rules: test files only, nothing deleted, no test renamed or switched off, no
  # assertion removed. The same module that the agent runs before it commits. It only reads
  # files, so it runs on the runner. Exit code 3 means a broken rule; any other failure of the
  # check is a failure of the gate.
  local problems code
  problems=$(node "$here/patch-rules.mjs" "$base") && code=0 || code=$?
  if [ "$code" -ne 0 ]; then
    if [ "$code" -eq 3 ]; then echo "::error::Agent patch breaks the patch rules:"; else echo "::error::The patch rules could not be checked (exit $code)"; fi
    printf '%s\n' "$problems"
    exit 1
  fi

  # Tell the next steps which packages to verify, and where the agent started.
  echo "$base" > "$out/agent-base"
  echo "agent_base=$base" >> "$output"
  printf '%s\n' "$changed" | grep -q '^backend/' && echo "backend=true" >> "$output"
  printf '%s\n' "$changed" | grep -q '^frontend/' && echo "frontend=true" >> "$output"
  return 0
}

# Every test that existed in the files the agent changed must still exist.
check_tests_kept() {
  local pkg="$1" base="$2"
  local changed modified
  changed=$(git diff --name-only --no-renames --diff-filter=AM "$base"..HEAD -- "$pkg" | sed "s#^$pkg/##")
  modified=$(git diff --name-only --no-renames --diff-filter=M "$base"..HEAD -- "$pkg" | sed "s#^$pkg/##")
  echo '[]' > "$box_out/$pkg-names-before.json"
  echo '[]' > "$box_out/$pkg-names-after.json"
  [ -n "$changed" ] || return 0

  # shellcheck disable=SC2086
  box none "$pkg" npx vitest list "--json=/out/$pkg-names-after.json" $changed > /dev/null
  [ -n "$modified" ] || return 0

  local file removed="" code=0
  # Put the old versions back for a moment to list their tests.
  for file in $modified; do
    git checkout --quiet "$base" -- "$pkg/$file" || { echo "::error::Cannot read the old version of $pkg/$file"; return 1; }
  done
  # shellcheck disable=SC2086
  if box none "$pkg" npx vitest list "--json=/out/$pkg-names-before.json" $modified > /dev/null 2>&1; then
    for file in $modified; do
      git checkout --quiet HEAD -- "$pkg/$file" || { echo "::error::Cannot restore $pkg/$file"; return 1; }
    done
    removed=$(box none "$pkg" node /gate/gate-report.mjs removed "/out/$pkg-names-before.json" "/out/$pkg-names-after.json") && code=0 || code=$?
  else
    # The old version cannot be collected (for example it imports removed code): read its titles.
    echo '[]' > "$box_out/$pkg-names-before.json"
    mkdir -p "$box_out/old-tests"
    local copies=""
    for file in $modified; do
      cp "$pkg/$file" "$box_out/old-tests/$(basename "$file")"
      copies="$copies /out/old-tests/$(basename "$file")"
      git checkout --quiet HEAD -- "$pkg/$file" || { echo "::error::Cannot restore $pkg/$file"; return 1; }
    done
    # shellcheck disable=SC2086
    removed=$(box none "$pkg" node /gate/gate-report.mjs static-removed "/out/$pkg-names-after.json" \
      --rules /gate/patch-rules.mjs --before-out "/out/$pkg-names-before.json" $copies) && code=0 || code=$?
  fi

  if [ "$code" -eq 3 ]; then
    echo "::error::Agent patch removes or renames existing tests in $pkg:"
    printf '%s\n' "$removed"
    return 1
  elif [ "$code" -ne 0 ]; then
    echo "::error::The check that existing tests are kept failed for $pkg (exit $code)"
    return 1
  fi
}

test_package() {
  local pkg="$1"
  install "$pkg"

  local base="" kept="passed"
  [ -f "$out/agent-base" ] && base=$(cat "$out/agent-base")
  if [ -n "$base" ]; then check_tests_kept "$pkg" "$base" || kept=failed; fi

  local tests=passed thresholds=passed typecheck=passed format="not run"
  local passed=0 failed=0 total=0
  box none "$pkg" npm run test:coverage -- --coverage.reportOnFailure \
    --reporter=default --reporter=json "--outputFile.json=/out/$pkg-results.json" && local code=0 || local code=$?
  read -r passed failed total <<< "$(box none "$pkg" node /gate/gate-report.mjs counts "/out/$pkg-results.json")"
  if [ "$code" -ne 0 ]; then
    if [ "${failed:-1}" -eq 0 ] && [ "${total:-0}" -gt 0 ]; then thresholds=failed; else tests=failed; fi
  fi
  box none "$pkg" npm run typecheck || typecheck=failed
  if [ "$pkg" = frontend ]; then
    format=passed
    box none frontend npm run format:check || format=failed
  fi

  local lines="n/a"
  if [ -f "$pkg/coverage/coverage-summary.json" ]; then
    lines=$(box none "$pkg" node -e "console.log(require('./coverage/coverage-summary.json').total.lines.pct + '%')")
  fi

  {
    echo "### $pkg"
    echo
    echo "| Check | Result |"
    echo "| --- | --- |"
    echo "| Tests | $tests: $passed passed, $failed failed ($total tests) |"
    echo "| Existing tests kept | $kept |"
    echo "| Coverage thresholds | $thresholds |"
    echo "| Typecheck | $typecheck |"
    echo "| Prettier | $format |"
    echo "| Line coverage after | $lines |"
    echo
  } | say

  [ "$tests" = passed ] && [ "$kept" = passed ] && [ "$thresholds" = passed ] \
    && [ "$typecheck" = passed ] && [ "$format" != failed ]
}

old_code_check() {
  local pkg="$1" pr_base="$2"
  local base tests merge_base sources src result
  [ -f "$out/agent-base" ] || return 0
  base=$(cat "$out/agent-base")

  # New or changed test files from the agent, relative to the package.
  tests=$(git diff --name-only --no-renames --diff-filter=AM "$base"..HEAD -- "$pkg" | sed "s#^$pkg/##")

  # Source files the pull request itself changed, compared with the point where its branch
  # left the base branch. Test files and test helpers stay as they are now.
  git fetch --no-tags --quiet --unshallow origin 2> /dev/null || true
  git fetch --no-tags --quiet origin "$pr_base" 2> /dev/null || true
  merge_base=$(git merge-base "$pr_base" "$base" 2> /dev/null || echo "$pr_base")
  sources=$(git diff --name-only --no-renames "$merge_base" "$base" -- "$pkg/src" \
    | grep -vE '\.test\.tsx?$|^frontend/src/test/' || true)

  if [ -z "$tests" ] || [ -z "$sources" ]; then
    result="Not applicable: the pull request changes no source file in this package."
  else
    # Put the changed source files back to their state before the pull request.
    for src in $sources; do
      if git cat-file -e "$merge_base:$src" 2> /dev/null; then git checkout --quiet "$merge_base" -- "$src"; else rm -f "$src"; fi
    done
    # shellcheck disable=SC2086
    box none "$pkg" npm test -- $tests --reporter=json "--outputFile.json=/out/$pkg-old-code.json" > /dev/null 2>&1 || true
    result=$(box none "$pkg" node /gate/gate-report.mjs old-code "/out/$pkg-old-code.json" "/out/$pkg-names-before.json" "/out/$pkg-names-after.json")
    # Restore the pull request version of the source files.
    git checkout --quiet HEAD -- "$pkg/src"
    git clean -fdq -- "$pkg/src"
  fi

  {
    echo "**$pkg: do the new tests detect the change?**"
    echo
    echo "$result"
    echo
  } | say
}

usage() {
  echo "usage: $0 baseline <package> | apply <patch> | test <package> | old-code <package> <pr-base>" >&2
  exit 2
}

command="${1:-}"
case "$command" in
  apply) shift; apply_patch "$@" ;;
  baseline | test | old-code)
    case "${2:-}" in backend | frontend) ;; *) usage ;; esac
    case "$command" in
      baseline) baseline "$2" ;;
      test) test_package "$2" ;;
      old-code) old_code_check "$2" "${3:?pr base sha required}" ;;
    esac
    ;;
  *) usage ;;
esac
