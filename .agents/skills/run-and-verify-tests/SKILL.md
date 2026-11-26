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
3. When the new tests pass, run the final verification once per package you changed:

   ```
   node .agents/skills/run-and-verify-tests/scripts/verify-tests.mjs <package> --input <input folder> --source <source files, comma separated> <your test files>
   ```

   All paths are from the repository root. The input folder is named in the task (`/tmp/gh-aw/agent/pr/` in a pull request run). The script runs the whole suite with coverage, the typecheck, and Prettier on frontend test files, and prints the **Results** and **Coverage** tables with measured numbers. It also checks the **patch rules** that the gate applies after you finish (test files only, no deleted, renamed or skipped test, no fewer `expect(` calls in an existing file), and it shows how your new tests behave on the code from before the pull request. It exits with 1 if any check or rule failed and lists the failing tests and log files.
4. If the script reports a failure, go back to step 2. If a patch rule failed, change your tests so that the rule holds; a rejected patch publishes nothing. If the script lists tests that also pass on the old code, make each one depend on the change, or keep it only when it guards behaviour that must stay the same and say so in the report. Copy its two tables into the report as they are; never write the numbers yourself.

## Commit

Commit only when the verification script passes:

- Stage your test files by path. Never use `git add -A` or `git add .`.
- `git commit -m "test: <what is now tested>"`
- Push with `push_to_pull_request_branch`, or in a coverage task follow the task's instructions.

If tests were already failing before your work (`<package>-tests-before.status` in the input folder is `failed`), push or open a pull request only when every one of those failures is an **intended change** (see `analyze-pr-changes`) and you updated those tests. Otherwise do not push or open a pull request, and report the failing tests as obsolete, a possible breaking change or unrelated.

A coverage threshold that was not met before your work (`<package>-thresholds-before.status`) does not block the push: your tests should bring the changed code above it. If the script still reports the thresholds as failed, add the missing tests.

Keep the script's tables and any suspected bugs for `report-results`. If you wrote tests that you may not push, keep their code too.
