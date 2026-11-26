#!/usr/bin/env node
// The rules for a patch of test files, in one place. verify-tests.mjs applies them before the
// agent commits, and the gate applies them again after the agent has finished.
//
// Usage: node patch-rules.mjs <start-commit>
// Compares the working tree with the commit the agent started from. Prints one line per
// broken rule. Exit code 0: no rule broken. 3: at least one rule broken. Anything else: the
// check itself failed, and the caller must treat that as a failure too.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Test files the agent may add or change. Fixtures and helpers are not included.
export const allowedFile = /^backend\/tests\/.+\.test\.ts$|^frontend\/src\/.+\.test\.tsx?$/;

const switchedOff = /\b(?:it|test|describe|suite|bench)(?:\.[a-zA-Z]+)*\.(?:skip|only|todo|fails|skipIf|runIf)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\(/g;

function count(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

// Test titles in a source file. Titles with placeholders (it.each) cannot be compared.
export function titles(source) {
  const pattern = /\b(?:it|test)(?:\.each\([^)]*\))?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  return [...source.matchAll(pattern)].map((found) => found[2]).filter((title) => !/%|\$\{|\$[a-zA-Z]/.test(title));
}

// Rules for one test file. `before` is null for a new file.
export function fileProblems(file, before, now) {
  const problems = [];
  if (count(now, switchedOff) > count(before ?? '', switchedOff)) {
    problems.push(`\`${file}\` adds \`.skip\`, \`.only\` or \`.todo\``);
  }
  if (before === null) return problems;
  const expectsBefore = count(before, /expect\(/g);
  const expectsNow = count(now, /expect\(/g);
  if (expectsNow < expectsBefore) {
    problems.push(`\`${file}\` has fewer \`expect(\` calls than before (${expectsBefore} before, ${expectsNow} now)`);
  }
  for (const title of titles(before)) {
    if (!now.includes(title)) problems.push(`\`${file}\`: the existing test "${title}" was removed or renamed`);
  }
  return problems;
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

// Rules for everything that changed in the working tree since `start`.
export function patchProblems(start) {
  const problems = [];
  for (const line of git(['diff', '--name-status', '--no-renames', start]).split('\n').filter(Boolean)) {
    const [status, file] = line.split('\t');
    if (status === 'D') problems.push(`\`${file}\` was deleted`);
    else if (!allowedFile.test(file)) problems.push(`\`${file}\` is not a test file and may not change`);
    else {
      const before = status === 'A' ? null : git(['show', `${start}:${file}`]);
      problems.push(...fileProblems(file, before, readFileSync(file, 'utf8')));
    }
  }
  // New files count only inside the two packages: the workflow itself leaves folders such as
  // .claude/ in the checkout.
  for (const file of git(['ls-files', '--others', '--exclude-standard', '--', 'backend', 'frontend']).split('\n').filter(Boolean)) {
    if (!allowedFile.test(file)) problems.push(`\`${file}\` is not a test file and may not be added`);
    else if (existsSync(file)) problems.push(...fileProblems(file, null, readFileSync(file, 'utf8')));
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const start = process.argv[2];
  if (!start) {
    console.error('usage: patch-rules.mjs <start-commit>');
    process.exit(2);
  }
  const problems = patchProblems(start);
  for (const problem of problems) console.log(problem);
  process.exit(problems.length ? 3 : 0);
}
