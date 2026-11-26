#!/usr/bin/env node
// Classifies the files changed in a pull request by path, so the agent can spend
// its reasoning on behaviour changes instead of on bookkeeping.
//
// Usage: node .agents/skills/analyze-pr-changes/scripts/classify-changes.mjs [input-dir]
// Input dir (default /tmp/gh-aw/agent/pr): changed-files.tsv, <package>-coverage-before.json,
// <package>-tests-before.status. Prints a Markdown table to stdout.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

const input = process.argv[2] ?? '/tmp/gh-aw/agent/pr';
const packages = ['backend', 'frontend'];

function read(file) {
  const path = join(input, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// Coverage summaries, parsed once, and the files each coverage run instrumented,
// relative to their package, for example src/lib/http.ts.
const summaries = {};
const covered = {};
for (const pkg of packages) {
  const summary = read(`${pkg}-coverage-before.json`);
  summaries[pkg] = summary ? JSON.parse(summary) : null;
  covered[pkg] = new Set(
    Object.keys(summaries[pkg] ?? {})
      .filter((key) => key !== 'total')
      .map((key) => key.slice(key.lastIndexOf(`/${pkg}/`) + pkg.length + 2)),
  );
}

function classify(path) {
  const pkg = packages.find((name) => path.startsWith(`${name}/`));
  const inner = pkg ? path.slice(pkg.length + 1) : path;
  if (/(^|\/)(package\.json|package-lock\.json)$/.test(path)) return { pkg, kind: 'dependencies' };
  if (extname(path) === '.md') return { pkg, kind: 'docs' };
  if (pkg === 'backend' && inner.startsWith('tests/')) return { pkg, kind: 'test' };
  if (/\.test\.tsx?$/.test(path)) return { pkg, kind: 'test' };
  if (pkg && inner.startsWith('src/') && /\.tsx?$/.test(path)) {
    // Not instrumented by coverage means excluded in the coverage config (types, constants, ...).
    return { pkg, kind: covered[pkg].has(inner) ? 'source' : 'excluded' };
  }
  return { pkg, kind: 'config' };
}

// Where the project keeps the test for a source file.
function testFileFor(pkg, path) {
  const name = basename(path).replace(/\.tsx?$/, '');
  const ext = extname(path) === '.tsx' ? '.test.tsx' : '.test.ts';
  return pkg === 'backend' ? `backend/tests/${name}.test.ts` : join(dirname(path), `${name}${ext}`);
}

function coverageOf(pkg, path) {
  if (!summaries[pkg]) return 'not measured';
  const entry = Object.entries(summaries[pkg]).find(([key]) => key.endsWith(`/${path}`));
  return entry ? `${entry[1].lines.pct}% / ${entry[1].branches.pct}%` : 'not measured';
}

const tsv = read('changed-files.tsv');
if (!tsv) {
  console.error(`No changed-files.tsv in ${input}`);
  process.exit(1);
}

const rows = tsv
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [status, path] = line.split('\t');
    const { pkg, kind } = classify(path);
    const testFile = kind === 'source' ? testFileFor(pkg, path) : '';
    const testState = testFile ? (existsSync(testFile) ? 'exists' : 'missing') : '';
    const coverage = kind === 'source' ? coverageOf(pkg, path) : '';
    return { path, status, kind, testFile, testState, coverage };
  });

console.log('| File | Status | Classification | Test file | Test file state | Lines / branches before |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const row of rows) {
  const test = row.testFile ? `\`${row.testFile}\`` : '';
  console.log(`| \`${row.path}\` | ${row.status} | ${row.kind} | ${test} | ${row.testState} | ${row.coverage} |`);
}

console.log('\n| Package | Tests before |');
console.log('| --- | --- |');
for (const pkg of packages) {
  const status = read(`${pkg}-tests-before.status`);
  if (status) console.log(`| ${pkg} | ${status.trim()} |`);
}
