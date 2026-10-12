#!/usr/bin/env node
/**
 * The registry's test gate: every kit's own Node unit tests, then the Godot
 * addon's tests. Kits are discovered, not listed: any kits/** /package.json
 * with a `test` script runs, so a new kit is covered the moment it ships tests
 * (the old gate named only kits/realtime, and four other kits' suites never ran).
 *
 * `gipity test` suites (tests/api/*, the servicenow and contacts tests) run on
 * the platform against a deployed app, not here.
 *
 * Run from the registry root: node scripts/test.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

/** Directories under `dir` holding a package.json with a `test` script. */
export function kitsWithTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const sub = join(dir, entry.name);
    const pkg = join(sub, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf-8')).scripts?.test) found.push(sub);
    found.push(...kitsWithTests(sub));
  }
  return found.sort();
}

function run(label, cmd, args, cwd) {
  process.stdout.write(`\n=== ${label}\n`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  return r.status === 0;
}

const failed = [];
for (const kit of kitsWithTests(join(ROOT, 'kits'))) {
  const name = relative(ROOT, kit);
  if (!run(name, 'npm', ['test', '--silent'], kit)) failed.push(name);
}
if (!run('examples/godot', 'node', ['tests/run_tests.mjs'], join(ROOT, 'examples', 'godot'))) failed.push('examples/godot');

if (failed.length) {
  console.log(`\nFAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('\nall registry suites passed');
