#!/usr/bin/env node
// Ranks source files by how much untested logic they have, so the agent starts from
// numbers instead of reading the raw coverage JSON.
//
// Usage: node .agents/skills/find-coverage-gaps/scripts/rank-coverage-gaps.mjs [input-dir]
// Input dir (default /tmp/gh-aw/agent/coverage): packages.txt, max-files.txt,
// <package>-coverage-before.json. Prints Markdown tables to stdout.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

const input = process.argv[2] ?? '/tmp/gh-aw/agent/coverage';

function read(file) {
  const path = join(input, file);
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}

// Bootstrap and wiring: the agent instructions say not to unit test these.
const wiring = new Set([
  'backend/src/main.ts',
  'backend/src/factory.ts',
  'backend/src/core/lifespan.ts',
  'frontend/src/main.tsx',
  'frontend/src/app/AppProviders.tsx',
]);

// Priority groups from "What to test": logic first, then components with logic.
function group(path) {
  if (/(validators|mappers|router|repository|config|database)\.ts$|\/(utils|lib|hooks|api)\//.test(path)) {
    return 1;
  }
  if (/\/components\/|Page\.tsx$|App\.tsx$/.test(path)) return 2;
  return 3;
}

function testFileFor(path) {
  const name = basename(path).replace(/\.tsx?$/, '');
  if (path.startsWith('backend/')) return `backend/tests/${name}.test.ts`;
  return join(dirname(path), `${name}${extname(path) === '.tsx' ? '.test.tsx' : '.test.ts'}`);
}

const packages = (read('packages.txt') ?? 'backend\nfrontend').split('\n').filter(Boolean);
const limit = Number(read('max-files.txt') ?? 5);
const candidates = [];
const skipped = { wiring: [], complete: 0 };

for (const pkg of packages) {
  const summary = read(`${pkg}-coverage-before.json`);
  if (!summary) continue;
  for (const [key, data] of Object.entries(JSON.parse(summary))) {
    if (key === 'total') continue;
    const path = `${pkg}/${key.slice(key.lastIndexOf(`/${pkg}/`) + pkg.length + 2)}`;
    if (wiring.has(path)) {
      skipped.wiring.push(path);
      continue;
    }
    const missedBranches = data.branches.total - data.branches.covered;
    const missedLines = data.lines.total - data.lines.covered;
    if (!missedBranches && !missedLines) {
      skipped.complete += 1;
      continue;
    }
    candidates.push({ path, group: group(path), data, missedBranches, missedLines });
  }
}

// Logic before components, then more uncovered branches, then more uncovered lines.
candidates.sort(
  (a, b) => a.group - b.group || b.missedBranches - a.missedBranches || b.missedLines - a.missedLines,
);

console.log(`Top ${Math.min(limit, candidates.length)} of ${candidates.length} files with untested code:\n`);
console.log('| Rank | File | Group | Lines before | Branches before | Uncovered branches | Uncovered lines | Test file |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
candidates.slice(0, limit).forEach((file, index) => {
  const test = testFileFor(file.path);
  const state = existsSync(test) ? 'exists' : 'missing';
  console.log(
    `| ${index + 1} | \`${file.path}\` | ${file.group} | ${file.data.lines.pct}% | ${file.data.branches.pct}% | ` +
      `${file.missedBranches} | ${file.missedLines} | \`${test}\` (${state}) |`,
  );
});

console.log('\nGroups: 1 = validation, mapping, routes, data access, utilities, API clients, hooks; 2 = components; 3 = other.');
console.log(`Skipped: ${skipped.complete} fully covered files; bootstrap and wiring: ${skipped.wiring.join(', ') || 'none'}.`);
const rest = candidates.slice(limit).map((file) => `\`${file.path}\``);
if (rest.length) console.log(`Not chosen because of the limit: ${rest.join(', ')}.`);
