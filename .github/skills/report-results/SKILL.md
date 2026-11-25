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

**Coverage (lines / branches)**
| Package | Before | After |
| --- | --- | --- |

**Suspected bugs and open issues:** <list, or "None">

**Skills used:** <in the order used>
