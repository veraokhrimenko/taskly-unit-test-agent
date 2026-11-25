---
name: report-results
description: Use at the end of every run to write one clear report of the decisions, the tests written, the test results and the coverage change.
---

# Report results

Write exactly one report. In a pull request run, post it with `add_comment`. In a coverage task, use it as the pull request description. Always report, also when no tests were needed.

## Format

```markdown
### Unit test agent

**Decision:** <Tests added | Tests updated | No tests needed | Stopped>, <one sentence why>.

| File | Classification | Tests needed | Reason |
| --- | --- | --- | --- |

**Tests written**
- `<test file>`: <behaviour verified, in plain English>

**Results**
| Package | Command | Result |
| --- | --- | --- |
| backend | `npm test --prefix backend` | <passed> / <failed> |

**Coverage**
| Scope | Lines before | Lines after | Branches before | Branches after |
| --- | --- | --- | --- | --- |

**Suspected bugs and open issues:** <list, or "None">

**Skills used:** <in the order used>
```

## Rules

- Describe each test by the behaviour it checks, so a reviewer can judge it without opening the file.
- Only report numbers you measured in this run. For **Results** and **Coverage**, paste the tables printed by `verify-tests.mjs` (see `run-and-verify-tests`) without changing them. If something was not measured, write "not measured".
- Put long output (more than 20 lines) in a `<details>` block. Never paste whole logs.
- Never mention people with `@` and never include tokens, keys or environment variables.
- Do not add signatures, attribution lines or links such as "Generated with …". The workflow adds its own footer.
- Leave out sections that do not apply, except **Decision** and **Skills used**.
