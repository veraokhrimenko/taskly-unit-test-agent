#!/usr/bin/env node
// Final verification for one package: whole test suite with coverage, typecheck and, for
// the frontend, Prettier on the given test files. Prints the Results and Coverage tables
// for report-results, so the reported numbers are always measured, never written by hand.
// It also applies the rules that the gate will apply to the patch, and shows how the new tests
// behave on the code from before the pull request, while the agent can still act on both.
//
// Usage:
//   node .agents/skills/run-and-verify-tests/scripts/verify-tests.mjs <backend|frontend> \
//     --input <dir> [--source <file,...>] [test files...]
// Paths are relative to the repository root. Exit code 0 when every check passed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
// Remove the summary of an earlier run first, so a crashed run cannot report old numbers.
const coverageFile = join(pkg, 'coverage', 'coverage-summary.json');
rmSync(coverageFile, { force: true });
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
const after = summary(coverageFile);
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
// A failed run with no failing test means a coverage threshold from the project's config is not met.
const thresholdsOnly = !suite.ok && report && report.numFailedTests === 0 && report.numTotalTests > 0;
console.log(`| ${pkg} | \`npm run test:coverage --prefix ${pkg}\` | ${suite.ok || thresholdsOnly ? 'passed' : 'failed'}: ${counts} |`);
console.log(`| ${pkg} | Coverage thresholds | ${thresholdsOnly ? 'failed: see the end of the test log' : suite.ok ? 'passed' : 'not checked'} |`);
console.log(`| ${pkg} | \`npm run typecheck --prefix ${pkg}\` | ${types.ok ? 'passed' : 'failed'} |`);
if (format) console.log(`| ${pkg} | Prettier on the test files | ${format.ok ? 'passed' : 'failed'} |`);

console.log('\n**Coverage**\n');
console.log('| Scope | Lines before | Lines after | Branches before | Branches after |');
console.log('| --- | --- | --- | --- | --- |');
console.log(row(`${pkg}, all files`, before?.total, after?.total));
for (const file of sources) console.log(row(`\`${file}\``, fileEntry(before, file), fileEntry(after, file)));
console.log('\nLines: share of code lines the tests ran. Branches: share of decision paths (both sides of each `if`, `?:` and `??`) they took.');

// 5. The rules the gate applies to the patch. A patch that breaks one is rejected after the
// run, when nothing can be fixed any more, so they are checked here first.
function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}
function lines(path) {
  return path && existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : [];
}
function count(text, pattern) {
  return (text.match(pattern) ?? []).length;
}
// Test titles in a source file. Titles with placeholders (it.each) cannot be compared.
function titles(source) {
  const pattern = /\b(?:it|test)(?:\.each\([^)]*\))?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  return [...source.matchAll(pattern)].map((match) => match[2]).filter((title) => !/%|\$\{|\$[a-zA-Z]/.test(title));
}
const start = lines(input && join(input, 'agent-start.sha'))[0] ?? 'HEAD';
const switchedOff = /\b(?:it|test|describe|suite|bench)(?:\.[a-zA-Z]+)*\.(?:skip|only|todo|fails|skipIf|runIf)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\(/g;
const problems = [];
const oldTitles = new Map();
for (const file of tests) {
  if (!existsSync(file)) {
    problems.push(`\`${file}\` does not exist`);
    continue;
  }
  const now = readFileSync(file, 'utf8');
  const old = git(['show', `${start}:${file}`]);
  oldTitles.set(file, new Set(old ? titles(old) : []));
  if (count(now, switchedOff) > count(old ?? '', switchedOff)) problems.push(`\`${file}\` adds \`.skip\`, \`.only\` or \`.todo\``);
  if (!old) continue;
  const before = count(old, /expect\(/g);
  const after = count(now, /expect\(/g);
  if (after < before) problems.push(`\`${file}\` has fewer \`expect(\` calls than before (${before} before, ${after} now)`);
  for (const title of oldTitles.get(file)) {
    if (!now.includes(title)) problems.push(`\`${file}\`: the existing test "${title}" was removed or renamed`);
  }
}
const allowed = /^backend\/tests\/.+\.test\.ts$|^frontend\/src\/.+\.test\.tsx?$/;
for (const line of (git(['diff', '--name-status', '--no-renames', start]) ?? '').split('\n').filter(Boolean)) {
  const [status, file] = line.split('\t');
  if (status === 'D') problems.push(`\`${file}\` was deleted`);
  else if (!allowed.test(file)) problems.push(`\`${file}\` is not a test file and may not change`);
}
// New files count only inside the two packages: the workflow itself leaves folders such as
// .claude/ in the checkout.
for (const file of (git(['ls-files', '--others', '--exclude-standard', '--', 'backend', 'frontend']) ?? '').split('\n').filter(Boolean)) {
  if (!allowed.test(file)) problems.push(`\`${file}\` is not a test file and may not be added`);
}
console.log(`\n**Patch rules:** ${problems.length ? 'failed. The gate will reject the patch:' : 'passed'}`);
for (const problem of problems) console.log(`- ${problem}`);

// 6. Do the new tests depend on the change? Run them on the source files from before the pull
// request, which the workflow saved in the input folder, and put the current files back.
const oldSources = input ? join(input, 'old-src') : null;
const inPackage = (file) => file.startsWith(`${pkg}/src/`) && !file.includes('..');
const changedSources = lines(oldSources && join(oldSources, 'changed.txt')).filter(inPackage);
const addedSources = lines(oldSources && join(oldSources, 'added.txt')).filter(inPackage);
if (tests.length && (changedSources.length || addedSources.length)) {
  const current = new Map();
  const oldResults = join(work, 'old-code.json');
  try {
    for (const file of [...changedSources, ...addedSources]) {
      if (existsSync(file)) current.set(file, readFileSync(file));
    }
    for (const file of changedSources) writeFileSync(file, readFileSync(join(oldSources, 'files', file)));
    for (const file of addedSources) rmSync(file, { force: true });
    run('old-code', ['test', '--prefix', pkg, '--', ...tests.map((file) => file.slice(pkg.length + 1)), '--reporter=json', `--outputFile.json=${oldResults}`]);
  } finally {
    for (const [file, content] of current) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }
  const old = existsSync(oldResults) ? JSON.parse(readFileSync(oldResults, 'utf8')) : null;
  const groups = { fail: [], unloadable: [], pass: [], unknown: [] };
  for (const file of tests) {
    const result = old?.testResults.find((entry) => entry.name.endsWith(`/${file}`));
    const known = oldTitles.get(file) ?? new Set();
    const added = titles(readFileSync(file, 'utf8')).filter((title) => !known.has(title));
    for (const title of added) {
      const test = result?.assertionResults.find((entry) => entry.title === title);
      if (result && !result.assertionResults.length) groups.unloadable.push(title);
      else if (!test) groups.unknown.push(title);
      else if (test.status === 'passed') groups.pass.push(`${file}: ${title}`);
      else groups.fail.push(title);
    }
  }
  console.log('\n**Do the new tests detect the change?** On the code from before the pull request:\n');
  console.log('| New tests | Count |');
  console.log('| --- | --- |');
  console.log(`| Run and fail, so they detect the change | ${groups.fail.length} |`);
  console.log(`| Cannot be loaded, because their file needs code that the pull request adds | ${groups.unloadable.length} |`);
  console.log(`| Also pass, so they do not depend on the change | ${groups.pass.length} |`);
  if (groups.unknown.length) console.log(`| No result | ${groups.unknown.length} |`);
  if (groups.pass.length) {
    console.log('\nAlso pass on the old code. For each one, make it depend on the change, or say in the report why it is still worth keeping:');
    for (const name of groups.pass) console.log(`- ${name}`);
  }
}

if (failing.length) console.log(`\nFailing tests:\n${failing.map((name) => `- ${name}`).join('\n')}`);
const broken = [suite, types, format].filter((check) => check && !check.ok).map((check) => check.log);
if (broken.length) console.log(`\nFull output of the failed checks: ${broken.join(', ')}`);
process.exit(broken.length || problems.length ? 1 : 0);
