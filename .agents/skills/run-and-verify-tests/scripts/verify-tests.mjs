#!/usr/bin/env node
// Final verification for one package: whole test suite with coverage, typecheck and, for
// the frontend, Prettier on the given test files. Prints the Results and Coverage tables
// for report-results, so the reported numbers are always measured, never written by hand.
//
// Usage:
//   node .agents/skills/run-and-verify-tests/scripts/verify-tests.mjs <backend|frontend> \
//     --input <dir> [--source <file,...>] [test files...]
// Paths are relative to the repository root. Exit code 0 when every check passed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [pkg, ...rest] = process.argv.slice(2);
if (pkg !== 'backend' && pkg !== 'frontend') {
  console.error('Usage: verify-tests.mjs <backend|frontend> --input <dir> [--source <file,...>] [test files...]');
  process.exit(2);
}

let input = null;
let sources = [];
const tests = [];
for (let index = 0; index < rest.length; index += 1) {
  if (rest[index] === '--input') input = rest[++index];
  else if (rest[index] === '--source') sources = rest[++index].split(',').filter(Boolean);
  else tests.push(rest[index]);
}

// Only test files of this package may be passed on, so the script cannot run anything else.
const testPattern = pkg === 'backend' ? /^backend\/tests\/[\w./-]+\.test\.ts$/ : /^frontend\/src\/[\w./-]+\.test\.tsx?$/;
const invalid = tests.filter((file) => !testPattern.test(file) || file.includes('..'));
if (invalid.length) {
  console.error(`Not test files of ${pkg}: ${invalid.join(', ')}`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), `verify-${pkg}-`));
function run(name, args) {
  const result = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const log = join(work, `${name}.log`);
  writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  return { ok: result.status === 0, log };
}

// 1. Whole suite with coverage. The JSON report gives exact counts and failing test names.
const resultsFile = join(work, 'results.json');
const suite = run('tests', [
  'run', 'test:coverage', '--prefix', pkg, '--',
  '--coverage.reportOnFailure', '--reporter=default', '--reporter=json', `--outputFile.json=${resultsFile}`,
]);
const report = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')) : null;
const failing = report
  ? report.testResults.flatMap((file) => file.assertionResults.filter((test) => test.status === 'failed').map((test) => test.fullName))
  : [];

// 2. Types: Vitest does not check them, but the frontend build does.
const types = run('typecheck', ['run', 'typecheck', '--prefix', pkg]);

// 3. Formatting of the agent's own frontend test files (CI runs format:check).
const format = pkg === 'frontend' && tests.length
  ? run('prettier', ['exec', '--prefix', 'frontend', '--', 'prettier', '--check', ...tests])
  : null;

// 4. Coverage before (prepared input) and after (this run).
function summary(path) {
  return path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}
const before = summary(input && join(input, `${pkg}-coverage-before.json`));
const after = summary(join(pkg, 'coverage', 'coverage-summary.json'));
function pct(data, metric) {
  return data ? `${data[metric].pct}%` : 'not measured';
}
function row(scope, before, after) {
  return `| ${scope} | ${pct(before, 'lines')} | ${pct(after, 'lines')} | ${pct(before, 'branches')} | ${pct(after, 'branches')} |`;
}
function fileEntry(data, file) {
  return data && Object.entries(data).find(([key]) => key.endsWith(`/${file}`))?.[1];
}

const counts = report
  ? `${report.numPassedTests} passed, ${report.numFailedTests} failed (${report.numTotalTests} tests)`
  : 'no test report';
console.log('**Results**\n');
console.log('| Package | Check | Result |');
console.log('| --- | --- | --- |');
console.log(`| ${pkg} | \`npm run test:coverage --prefix ${pkg}\` | ${suite.ok ? 'passed' : 'failed'}: ${counts} |`);
console.log(`| ${pkg} | \`npm run typecheck --prefix ${pkg}\` | ${types.ok ? 'passed' : 'failed'} |`);
if (format) console.log(`| ${pkg} | Prettier on the test files | ${format.ok ? 'passed' : 'failed'} |`);

console.log('\n**Coverage**\n');
console.log('| Scope | Lines before | Lines after | Branches before | Branches after |');
console.log('| --- | --- | --- | --- | --- |');
console.log(row(`${pkg}, all files`, before?.total, after?.total));
for (const file of sources) console.log(row(`\`${file}\``, fileEntry(before, file), fileEntry(after, file)));
console.log('\nLines: share of code lines the tests ran. Branches: share of decision paths (both sides of each `if`, `?:` and `??`) they took.');

if (failing.length) console.log(`\nFailing tests:\n${failing.map((name) => `- ${name}`).join('\n')}`);
const broken = [suite, types, format].filter((check) => check && !check.ok).map((check) => check.log);
if (broken.length) console.log(`\nFull output of the failed checks: ${broken.join(', ')}`);
process.exit(broken.length ? 1 : 0);
