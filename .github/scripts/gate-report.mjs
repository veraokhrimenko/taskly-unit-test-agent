#!/usr/bin/env node
// Helpers for verify-agent-patch.sh. They read Vitest JSON files and print plain results,
// so the shell script does not parse JSON itself.
//
//   gate-report.mjs counts <results.json>                    "<passed> <failed> <total>"
//   gate-report.mjs removed <before.json> <after.json>       tests that existed before and are gone
//   gate-report.mjs static-removed <after.json> <file>...    the same, from test titles in source files
//   gate-report.mjs old-code <results.json> <before.json> <after.json>
//                                                            how each new test behaves on the old code
import { existsSync, readFileSync } from 'node:fs';

const [command, ...args] = process.argv.slice(2);

function json(path) {
  return path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

// `vitest list --json` gives [{ name, file }]; one key per test.
function listed(path) {
  return new Set((json(path) ?? []).map((test) => `${test.file} > ${test.name}`));
}

if (command === 'counts') {
  const report = json(args[0]);
  console.log(report ? `${report.numPassedTests} ${report.numFailedTests} ${report.numTotalTests}` : '0 0 0');
} else if (command === 'removed') {
  const after = listed(args[1]);
  const gone = [...listed(args[0])].filter((name) => !after.has(name));
  for (const name of gone) console.log(name.replace(/^\/work\//, ''));
  process.exit(gone.length ? 1 : 0);
} else if (command === 'static-removed') {
  // Fallback when the old version of a test file cannot be collected: read the titles from
  // its source. Titles with placeholders (it.each) cannot be matched and are skipped.
  const after = [...listed(args[0])];
  const gone = [];
  for (const file of args.slice(1)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\b(?:it|test)(?:\.each\([^)]*\))?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const title = match[2];
      if (/%|\$\{|\$[a-zA-Z]/.test(title)) continue;
      if (!after.some((name) => name.endsWith(title))) gone.push(title);
    }
  }
  for (const title of gone) console.log(title);
  process.exit(gone.length ? 1 : 0);
} else if (command === 'old-code') {
  const report = json(args[0]);
  const before = args[1] && existsSync(args[1]) ? listed(args[1]) : new Set();
  const added = [...listed(args[2])].filter((name) => !before.has(name));
  // Result of every test on the old code, by the same key as the listing.
  const results = new Map();
  const brokenFiles = new Set();
  for (const file of report?.testResults ?? []) {
    if (!file.assertionResults.length) brokenFiles.add(file.name);
    for (const test of file.assertionResults) {
      results.set(`${file.name} > ${[...test.ancestorTitles, test.title].join(' > ')}`, test);
    }
  }
  const groups = { detects: [], passes: [], needsNewCode: [], inconclusive: [] };
  for (const name of added) {
    const file = name.slice(0, name.indexOf(' > '));
    const title = name.slice(name.indexOf(' > ') + 3);
    const result = results.get(name);
    // The file could not be loaded on the old code: it needs something the pull request adds.
    if (brokenFiles.has(file)) groups.needsNewCode.push(title);
    // No result for this test at all (no report, or the test is missing from it): the cause is unknown.
    else if (!result) groups.inconclusive.push(title);
    else if (result.status === 'passed') groups.passes.push(title);
    else if (result.failureMessages.some((message) => /AssertionError|expected/i.test(message))) groups.detects.push(title);
    else groups.needsNewCode.push(title);
  }
  if (!added.length) {
    console.log('No new tests to check.');
  } else {
    console.log(`Of ${added.length} new tests, on the code from before the pull request:`);
    console.log(`- ✅ ${groups.detects.length} fail on an assertion, so they detect the change`);
    console.log(`- ➖ ${groups.needsNewCode.length} cannot run, because they need code that the pull request adds`);
    console.log(`- ⚠️ ${groups.passes.length} also pass, so they do not depend on the change (expected for a refactor)`);
    if (groups.inconclusive.length) {
      console.log(`- ❔ ${groups.inconclusive.length} inconclusive: the run on the old code gave no result for them`);
    }
    if (groups.passes.length) {
      console.log('\nAlso pass on the old code:\n');
      console.log('```');
      for (const title of groups.passes) console.log(title);
      console.log('```');
    }
  }
} else {
  console.error('usage: gate-report.mjs counts|removed|static-removed|old-code ...');
  process.exit(2);
}
