// Tests for verify-tests.mjs. Run: node --test .agents/skills/*/scripts/*.test.mjs
// A fake "backend" package stands in for the real one, so no dependencies are installed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('./verify-tests.mjs', import.meta.url).pathname;

// The fake test:coverage script writes the files Vitest would write: the JSON results
// (path from --outputFile.json=...) and coverage/coverage-summary.json.
const fakeRunner = `
import { mkdirSync, writeFileSync } from 'node:fs';
const failed = process.env.FAKE_FAILED === '1';
const out = process.argv.find((arg) => arg.startsWith('--outputFile.json=')).split('=')[1];
writeFileSync(out, JSON.stringify({
  numTotalTests: 3, numPassedTests: failed ? 2 : 3, numFailedTests: failed ? 1 : 0,
  testResults: [{ assertionResults: [{ status: failed ? 'failed' : 'passed', fullName: 'rejects duplicates' }] }],
}));
if (process.env.FAKE_NO_COVERAGE !== '1') {
  mkdirSync('coverage', { recursive: true });
  writeFileSync('coverage/coverage-summary.json', JSON.stringify({
    total: { lines: { pct: 70 }, branches: { pct: 60 } },
    '/runner/repo/backend/src/router.ts': { lines: { pct: 100 }, branches: { pct: 100 } },
  }));
}
process.exit(failed ? 1 : 0);
`;

function setup() {
  const repo = mkdtempSync(join(tmpdir(), 'verify-repo-'));
  const input = mkdtempSync(join(tmpdir(), 'verify-input-'));
  mkdirSync(join(repo, 'backend'));
  writeFileSync(join(repo, 'backend/fake-vitest.mjs'), fakeRunner);
  writeFileSync(join(repo, 'backend/package.json'), JSON.stringify({
    name: 'fake-backend',
    private: true,
    scripts: { 'test:coverage': 'node fake-vitest.mjs', typecheck: 'node -e "process.exit(Number(process.env.FAKE_TYPES_FAILED || 0))"' },
  }));
  // A summary left by an earlier run (the baseline measurement writes the same file).
  mkdirSync(join(repo, 'backend/coverage'));
  writeFileSync(join(repo, 'backend/coverage/coverage-summary.json'), JSON.stringify({ total: { lines: { pct: 99 }, branches: { pct: 99 } } }));
  writeFileSync(join(input, 'backend-coverage-before.json'), JSON.stringify({
    total: { lines: { pct: 50 }, branches: { pct: 40 } },
    '/runner/repo/backend/src/router.ts': { lines: { pct: 80 }, branches: { pct: 50 } },
  }));
  return { repo, input };
}

function verify(args, env = {}) {
  const { repo, input } = setup();
  const finalArgs = args.map((arg) => (arg === '$INPUT' ? input : arg));
  return spawnSync(process.execPath, [script, ...finalArgs], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('prints measured results and coverage when every check passes', () => {
  const { stdout, status } = verify(['backend', '--input', '$INPUT', '--source', 'backend/src/router.ts', 'backend/tests/router.test.ts']);
  assert.equal(status, 0);
  assert.match(stdout, /\| backend \| `npm run test:coverage --prefix backend` \| passed: 3 passed, 0 failed \(3 tests\) \|/);
  assert.match(stdout, /\| backend \| `npm run typecheck --prefix backend` \| passed \|/);
  assert.match(stdout, /\| Scope \| Lines before \| Lines after \| Branches before \| Branches after \|/);
  assert.match(stdout, /\| backend, all files \| 50% \| 70% \| 40% \| 60% \|/);
  assert.match(stdout, /\| `backend\/src\/router\.ts` \| 80% \| 100% \| 50% \| 100% \|/);
});

test('lists failing tests and exits with 1', () => {
  const { stdout, status } = verify(['backend', '--input', '$INPUT'], { FAKE_FAILED: '1' });
  assert.equal(status, 1);
  assert.match(stdout, /failed: 2 passed, 1 failed \(3 tests\)/);
  assert.match(stdout, /Failing tests:\n- rejects duplicates/);
});

test('reports a failed typecheck', () => {
  const { stdout, status } = verify(['backend', '--input', '$INPUT'], { FAKE_TYPES_FAILED: '1' });
  assert.equal(status, 1);
  assert.match(stdout, /\| backend \| `npm run typecheck --prefix backend` \| failed \|/);
});

test('does not report coverage left by an earlier run when the suite writes none', () => {
  const { stdout, status } = verify(['backend', '--input', '$INPUT'], { FAKE_FAILED: '1', FAKE_NO_COVERAGE: '1' });
  assert.equal(status, 1);
  assert.match(stdout, /\| backend, all files \| 50% \| not measured \| 40% \| not measured \|/);
  assert.doesNotMatch(stdout, /99%/);
});

test('rejects anything that is not a test file of the package', () => {
  for (const args of [
    ['scripts'],
    ['backend', '--input', '$INPUT', 'backend/src/main.ts'],
    ['backend', '--input', '$INPUT', 'frontend/src/App.test.tsx'],
    ['backend', '--input', '$INPUT', 'backend/tests/../src/x.test.ts'],
  ]) {
    assert.equal(verify(args).status, 2, `expected exit 2 for ${args.join(' ')}`);
  }
});
