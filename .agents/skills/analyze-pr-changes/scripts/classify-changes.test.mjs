// Tests for classify-changes.mjs. Run: node --test .agents/skills/*/scripts/*.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('./classify-changes.mjs', import.meta.url).pathname;

// A fake repository (for "does the test file exist") and a fake input folder.
function setup(changed) {
  const repo = mkdtempSync(join(tmpdir(), 'classify-repo-'));
  const input = mkdtempSync(join(tmpdir(), 'classify-input-'));
  mkdirSync(join(repo, 'backend/tests'), { recursive: true });
  writeFileSync(join(repo, 'backend/tests/router.test.ts'), '');
  writeFileSync(join(input, 'changed-files.tsv'), changed.map(([status, path]) => `${status}\t${path}`).join('\n'));
  const summary = (pkg, files) =>
    JSON.stringify(Object.fromEntries([
      ['total', { lines: { pct: 50 }, branches: { pct: 40 } }],
      ...files.map((file) => [`/runner/work/repo/${pkg}/${file}`, { lines: { pct: 80 }, branches: { pct: 60 } }]),
    ]));
  writeFileSync(join(input, 'backend-coverage-before.json'), summary('backend', ['src/features/todos/router.ts', 'src/core/config.ts']));
  writeFileSync(join(input, 'frontend-coverage-before.json'), summary('frontend', ['src/lib/http.ts', 'src/App.tsx']));
  writeFileSync(join(input, 'backend-tests-before.status'), 'failed\n');
  return spawnSync(process.execPath, [script, input], { cwd: repo, encoding: 'utf8' });
}

function row(output, path) {
  return output.split('\n').find((line) => line.startsWith(`| \`${path}\``));
}

test('classifies files by path and coverage', () => {
  const { stdout, status } = setup([
    ['modified', 'backend/src/features/todos/router.ts'],
    ['modified', 'backend/src/features/todos/types.ts'],
    ['added', 'backend/tests/new.test.ts'],
    ['modified', 'frontend/src/lib/http.ts'],
    ['modified', 'frontend/src/App.test.tsx'],
    ['modified', 'frontend/package.json'],
    ['modified', 'backend/README.md'],
    ['modified', '.github/workflows/ci.yml'],
  ]);
  assert.equal(status, 0);
  assert.match(row(stdout, 'backend/src/features/todos/router.ts'), /\| source \|/);
  assert.match(row(stdout, 'backend/src/features/todos/types.ts'), /\| excluded \|/);
  assert.match(row(stdout, 'backend/tests/new.test.ts'), /\| test \|/);
  assert.match(row(stdout, 'frontend/src/App.test.tsx'), /\| test \|/);
  assert.match(row(stdout, 'frontend/package.json'), /\| dependencies \|/);
  assert.match(row(stdout, 'backend/README.md'), /\| docs \|/);
  assert.match(row(stdout, '.github/workflows/ci.yml'), /\| config \|/);
});

test('maps source files to test files and says whether they exist', () => {
  const { stdout } = setup([
    ['modified', 'backend/src/features/todos/router.ts'],
    ['modified', 'backend/src/core/config.ts'],
    ['modified', 'frontend/src/lib/http.ts'],
  ]);
  assert.match(row(stdout, 'backend/src/features/todos/router.ts'), /`backend\/tests\/router\.test\.ts` \| exists \| 80% \/ 60% \|/);
  assert.match(row(stdout, 'backend/src/core/config.ts'), /`backend\/tests\/config\.test\.ts` \| missing \|/);
  assert.match(row(stdout, 'frontend/src/lib/http.ts'), /`frontend\/src\/lib\/http\.test\.ts` \| missing \|/);
});

test('shows the test status before the agent', () => {
  const { stdout } = setup([['modified', 'backend/src/core/config.ts']]);
  assert.match(stdout, /\| backend \| failed \|/);
});

test('fails clearly without a changed-files list', () => {
  const input = mkdtempSync(join(tmpdir(), 'classify-empty-'));
  const result = spawnSync(process.execPath, [script, input], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No changed-files\.tsv/);
});
