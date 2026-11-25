---
name: find-coverage-gaps
description: Use at the start of a coverage run to choose which existing source files most need unit tests, and why.
---

# Find coverage gaps

## Inputs

All in `/tmp/gh-aw/agent/coverage/`, prepared before you start:

- `packages.txt`: the packages in scope (`backend`, `frontend`).
- `<package>-coverage-before.json`: Vitest coverage summary. Keys are absolute file paths; match them by the part after `<package>/`, for example `src/lib/http.ts`.
- `<package>-tests-before.status` and `<package>-tests-before.log`: the test result before your work.

The task says how many source files you may choose at most.

## Steps

1. List every file in the coverage summaries with its line, branch and function coverage.
2. Drop files the unit-test-engineer instructions say to skip: excluded from coverage, generated, types, constants, re-exports, bootstrap and wiring.
3. Rank the rest:
   - First by priority group from "What to test": validation, mapping, branching, error handling, API responses and hooks before components with logic.
   - Then by the size of the gap: uncovered branches matter more than uncovered lines.
4. Choose the top files, up to the limit in the task. For each one, read the source and its existing test file (if any) and list the untested behaviours you will cover.

## Output

Keep this table for `report-results`:

| File | Lines / branches before | Priority | Untested behaviour | Test file |
| --- | --- | --- | --- | --- |

Also list the files you skipped on purpose and why, in one line each.
