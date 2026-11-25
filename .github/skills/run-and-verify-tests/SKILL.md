---
name: run-and-verify-tests
description: Use after writing or updating tests to run them, fix failures in the tests (never in the code), check coverage and types, and commit the result.
---

# Run and verify tests

Run every command from the repository root with `--prefix`. Paths after `--` are relative to the package.

## Steps

1. Run only the new or changed test files first:
   - `npm test --prefix backend -- tests/<name>.test.ts`
   - `npm test --prefix frontend -- src/<path>/<Name>.test.tsx`
2. If a test fails, decide why before changing anything:
   - **The test is wrong** (wrong import, wrong mock, wrong selector, wrong setup): fix the test.
   - **The expectation is right and the code does something else**: this may be a bug. Do not change the code and do not change the expectation to match it. Remove this test from your changes and report it as a suspected bug.
   - **The environment is broken** (missing module, timeout): stop and report it.
   You get at most two fix attempts per failing test.
3. Run the whole package suite to make sure nothing else broke: `npm test --prefix <package>`.
4. Run coverage and types:
   - `npm run test:coverage --prefix <package>`
   - `npm run typecheck --prefix <package>`
5. Read `<package>-coverage-before.json` from the input folder named in the task (`/tmp/gh-aw/agent/pr/` in a pull request run) and compare it with `<package>/coverage/coverage-summary.json`: total lines and branches before and after, and line coverage of each file you wrote tests for. Report "not measured" only if the before file does not exist.

## Commit

Commit only when steps 3 and 4 pass:

- Stage your test files by path. Never use `git add -A` or `git add .`.
- `git commit -m "test: <what is now tested>"`
- Push with `push_to_pull_request_branch`, or in a coverage task follow the task's instructions.

If tests were already failing before your work (`<package>-tests-before.status` in the input folder is `failed`), do not push or open a pull request. Report the failing tests instead.

Keep the results (commands, passed and failed counts, coverage before and after, suspected bugs) for `report-results`.
