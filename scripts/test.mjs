#!/usr/bin/env node
/**
 * The registry's test gate: every kit's own Node unit tests, then the Godot
 * addon's tests, then the Python device client's pytest suite (run with uv,
 * which builds a locked venv from examples/python/uv.lock; a machine without
 * uv fails the gate with an install hint instead of skipping the suite). Kits are discovered, not listed: any kits/** /package.json
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

const uv = spawnSync('uv', ['--version'], { encoding: 'utf-8' });
if (uv.status !== 0) {
  console.log('\n=== examples/python\nuv is not installed, so the Python device client tests cannot run.'
    + ' Install it (https://docs.astral.sh/uv/getting-started/installation/) and re-run the gate.');
  failed.push('examples/python (uv missing)');
} else if (!run('examples/python', 'uv', ['run', '--locked', '--extra', 'test', 'pytest', '-q'], join(ROOT, 'examples', 'python'))) {
  failed.push('examples/python');
}

if (failed.length) {
  console.log(`\nFAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('\nall registry suites passed');
