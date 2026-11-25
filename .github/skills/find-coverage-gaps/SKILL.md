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

1. Run `node .github/skills/find-coverage-gaps/scripts/rank-coverage-gaps.mjs`. It reads the files above, drops fully covered files and bootstrap and wiring, and ranks the rest: logic before components, then more uncovered branches, then more uncovered lines. Use its ranking; do not parse the coverage JSON by hand.
2. Check the ranking against "What to test" in the unit-test-engineer instructions. You may skip a ranked file with a reason (for example markup without logic) and take the next one.
3. Choose the top files, up to the limit in `max-files.txt`. For each one, read the source and its existing test file (if any) and list the untested behaviours you will cover.

## Output

Keep this table for `report-results`:

| File | Lines / branches before | Priority | Untested behaviour | Test file |
| --- | --- | --- | --- | --- |

Also list the files you skipped on purpose and why, in one line each.
