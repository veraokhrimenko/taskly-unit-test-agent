// Tests for patch-rules.mjs. Run: node --test .agents/skills/*/scripts/*.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileProblems, titles } from './patch-rules.mjs';

const script = new URL('./patch-rules.mjs', import.meta.url).pathname;
const original = "it('accepts a title', () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n";

// A small repository with one test file, one fixture and one source file, committed.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'patch-rules-'));
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
  mkdirSync(join(dir, 'backend/tests'), { recursive: true });
  mkdirSync(join(dir, 'backend/src'), { recursive: true });
  writeFileSync(join(dir, 'backend/tests/a.test.ts'), original);
  writeFileSync(join(dir, 'backend/tests/fixture.ts'), 'export const x = 1;\n');
  writeFileSync(join(dir, 'backend/src/a.ts'), 'export const a = 1;\n');
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'start');
  const check = () => spawnSync(process.execPath, [script, 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return { dir, check };
}

test('reads plain test titles and skips titles with placeholders', () => {
  assert.deepEqual(titles("it('one', () => {}); test(\"two\", () => {}); it.each([1])('n %s', () => {});"), ['one', 'two']);
});

test('accepts a new test file and a new test in an existing file', () => {
  const { dir, check } = repo();
  writeFileSync(join(dir, 'backend/tests/b.test.ts'), "it('new', () => { expect(1).toBe(1); });\n");
  writeFileSync(join(dir, 'backend/tests/a.test.ts'), `${original}it('more', () => { expect(3).toBe(3); });\n`);
  const result = check();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('exits with 3 and names each broken rule', () => {
  const cases = [
    [(dir) => writeFileSync(join(dir, 'backend/tests/a.test.ts'), original.replace("it('", "it.skip('")), /adds `\.skip`/],
    [(dir) => writeFileSync(join(dir, 'backend/tests/a.test.ts'), original.replace('  expect(2).toBe(2);\n', '')), /fewer `expect\(` calls/],
    [(dir) => writeFileSync(join(dir, 'backend/tests/a.test.ts'), original.replace('accepts a title', 'renamed')), /"accepts a title" was removed or renamed/],
    [(dir) => rmSync(join(dir, 'backend/tests/a.test.ts')), /was deleted/],
    [(dir) => writeFileSync(join(dir, 'backend/tests/fixture.ts'), 'export const x = 2;\n'), /fixture\.ts` is not a test file and may not change/],
    [(dir) => writeFileSync(join(dir, 'backend/src/new.ts'), 'export {};\n'), /new\.ts` is not a test file and may not be added/],
  ];
  for (const [change, expected] of cases) {
    const { dir, check } = repo();
    change(dir);
    const result = check();
    assert.equal(result.status, 3, result.stdout + result.stderr);
    assert.match(result.stdout, expected);
  }
});

test('ignores new files outside the packages, such as the workflow\'s own folders', () => {
  const { dir, check } = repo();
  mkdirSync(join(dir, '.claude/skills'), { recursive: true });
  writeFileSync(join(dir, '.claude/skills/SKILL.md'), 'x\n');
  assert.equal(check().status, 0);
});

test('does not treat a prisma model named todo as a switched-off test', () => {
  assert.deepEqual(fileProblems('a.test.ts', null, 'expect(database.todo.findFirst).toHaveBeenCalled();'), []);
});

test('fails with another exit code when the check itself cannot run', () => {
  const { check, dir } = repo();
  const result = spawnSync(process.execPath, [script, 'no-such-commit'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.notEqual(result.status, 3);
  assert.equal(check().status, 0);
});
