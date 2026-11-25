// Tests for rank-coverage-gaps.mjs. Run: node --test .agents/skills/*/scripts/*.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('./rank-coverage-gaps.mjs', import.meta.url).pathname;

function entry(lines, branches) {
  const pct = (covered, total) => (total ? Math.round((covered / total) * 10000) / 100 : 100);
  return {
    lines: { total: lines[1], covered: lines[0], pct: pct(...lines) },
    branches: { total: branches[1], covered: branches[0], pct: pct(...branches) },
  };
}

function run({ maxFiles = 3, frontend = {}, backend = {} }) {
  const input = mkdtempSync(join(tmpdir(), 'rank-input-'));
  writeFileSync(join(input, 'packages.txt'), 'backend\nfrontend\n');
  writeFileSync(join(input, 'max-files.txt'), `${maxFiles}\n`);
  for (const [pkg, files] of Object.entries({ backend, frontend })) {
    const summary = { total: entry([0, 1], [0, 1]) };
    for (const [file, data] of Object.entries(files)) summary[`/runner/work/repo/${pkg}/${file}`] = data;
    writeFileSync(join(input, `${pkg}-coverage-before.json`), JSON.stringify(summary));
  }
  return spawnSync(process.execPath, [script, input], { encoding: 'utf8' });
}

function ranked(stdout) {
  return stdout.split('\n').filter((line) => /^\| \d+ \|/.test(line)).map((line) => line.split('|')[2].trim().replaceAll('`', ''));
}

test('ranks logic before components, then by uncovered branches and lines', () => {
  const { stdout, status } = run({
    maxFiles: 4,
    backend: {
      'src/features/todos/router.ts': entry([5, 10], [1, 7]),
      'src/core/config.ts': entry([0, 10], [0, 2]),
    },
    frontend: {
      'src/features/todos/components/TodoList.tsx': entry([0, 20], [0, 9]),
      'src/lib/http.ts': entry([0, 10], [0, 5]),
    },
  });
  assert.equal(status, 0);
  assert.deepEqual(ranked(stdout), [
    'backend/src/features/todos/router.ts',
    'frontend/src/lib/http.ts',
    'backend/src/core/config.ts',
    'frontend/src/features/todos/components/TodoList.tsx',
  ]);
});

test('skips fully covered files and bootstrap code', () => {
  const { stdout } = run({
    backend: {
      'src/main.ts': entry([0, 10], [0, 2]),
      'src/factory.ts': entry([0, 10], [0, 0]),
      'src/features/todos/mappers.ts': entry([10, 10], [4, 4]),
      'src/api/health.ts': entry([0, 5], [0, 0]),
    },
  });
  assert.deepEqual(ranked(stdout), ['backend/src/api/health.ts']);
  assert.match(stdout, /Skipped: 1 fully covered files; bootstrap and wiring: backend\/src\/main\.ts, backend\/src\/factory\.ts\./);
});

test('respects the file limit and lists the rest', () => {
  const { stdout } = run({
    maxFiles: 1,
    frontend: {
      'src/lib/http.ts': entry([0, 10], [0, 5]),
      'src/features/todos/hooks/useTodosQuery.ts': entry([0, 3], [0, 0]),
    },
  });
  assert.deepEqual(ranked(stdout), ['frontend/src/lib/http.ts']);
  assert.match(stdout, /Not chosen because of the limit: `frontend\/src\/features\/todos\/hooks\/useTodosQuery\.ts`\./);
});
