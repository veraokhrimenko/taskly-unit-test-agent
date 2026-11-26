// Tests for gate-report.mjs. Run: node --test .github/scripts/*.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('./gate-report.mjs', import.meta.url).pathname;
const file = '/work/backend/tests/health.test.ts';

// Runs "old-code" with the given new test titles and an optional Vitest report of the old code.
function oldCode(titles, report) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-report-'));
  writeFileSync(join(dir, 'before.json'), '[]');
  writeFileSync(join(dir, 'after.json'), JSON.stringify(titles.map((name) => ({ name, file }))));
  if (report) writeFileSync(join(dir, 'old.json'), JSON.stringify(report));
  const result = spawnSync(process.execPath, [script, 'old-code', join(dir, 'old.json'), join(dir, 'before.json'), join(dir, 'after.json')], { encoding: 'utf8' });
  return result.stdout;
}

function result(title, status, failureMessages = []) {
  return { ancestorTitles: [], title, status, failureMessages };
}

test('sorts new tests by how they behave on the old code', () => {
  const stdout = oldCode(['detects', 'passes', 'crashes'], {
    testResults: [{
      name: file,
      assertionResults: [
        result('detects', 'failed', ['AssertionError: expected ok to be healthy']),
        result('passes', 'passed'),
        result('crashes', 'failed', ['TypeError: isShortTitle is not a function']),
      ],
    }],
  });
  assert.match(stdout, /✅ 2 run and fail/);
  assert.match(stdout, /➖ 0 cannot be loaded/);
  assert.match(stdout, /⚠️ 1 also pass/);
  assert.doesNotMatch(stdout, /inconclusive/);
});

test('counts every test of a file that cannot be loaded as needing new code', () => {
  const stdout = oldCode(['one', 'two'], { testResults: [{ name: file, assertionResults: [] }] });
  assert.match(stdout, /➖ 2 cannot be loaded/);
});

test('says inconclusive when there is no result for a test', () => {
  assert.match(oldCode(['one']), /❔ 1 inconclusive/);
  assert.match(oldCode(['one']), /➖ 0 cannot be loaded/);
  const missing = oldCode(['one', 'two'], { testResults: [{ name: file, assertionResults: [result('one', 'passed')] }] });
  assert.match(missing, /⚠️ 1 also pass/);
  assert.match(missing, /❔ 1 inconclusive/);
});

test('prints titles of passing tests without Markdown or HTML', () => {
  const title = 'ok ``` \n### Fake heading <b>x</b> @someone [link](http://x)';
  const stdout = oldCode([title], { testResults: [{ name: file, assertionResults: [result(title, 'passed')] }] });
  const line = stdout.split('\n').find((text) => text.startsWith('- ok'));
  assert.ok(line);
  assert.doesNotMatch(line, /[`#<>@\[\]]/);
});
