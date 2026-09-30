// Runs the addon tests: mock server + headless Godot. Usage: node tests/run_tests.mjs
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockServer } from './mock_server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, 'project');
rmSync(join(project, 'addons'), { recursive: true, force: true });
mkdirSync(join(project, 'addons'), { recursive: true });
cpSync(join(here, '..', 'addons', 'gipity'), join(project, 'addons', 'gipity'), { recursive: true });
rmSync(join(homedir(), '.local/share/godot/app_userdata/gipity-addon-tests'), { recursive: true, force: true });

const { server, state, port } = await startMockServer();
const godot = process.env.GODOT || 'godot';
const run = (args) => new Promise(resolve => {
  const r = spawnSync(godot, args, { cwd: project, env: { ...process.env, MOCK_PORT: String(port) }, encoding: 'utf8', timeout: 120000 });
  resolve(r);
});
await run(['--headless', '--path', project, '--import']);
// spawnSync blocks the event loop, so run Godot async instead while the mock serves.
const { spawn } = await import('node:child_process');
const code = await new Promise(resolve => {
  const p = spawn(godot, ['--headless', '--path', project, '--script', 'res://test_runner.gd'], { cwd: project, env: { ...process.env, MOCK_PORT: String(port) }, stdio: 'inherit' });
  p.on('exit', c => resolve(c ?? 1));
});
server.close();

let failed = code;
const tb = state.submissions.find(s => s.board === 'arcade:score');
if (tb && tb.tiebreak === 61000 && tb.score === 4200) console.log('ok   the server received the tiebreak');
else { failed++; console.log('FAIL the server received the tiebreak', JSON.stringify(tb)); }
const queued = state.submissions.filter(s => s.board === 'oval-1:race');
if (queued.length === 1 && queued[0].score === 99999 && queued[0].gameVersion === '9.9.9-test') console.log('ok   the server received the flushed offline submission');
else { failed++; console.log('FAIL the server received the flushed offline submission', JSON.stringify(queued)); }

const versioned = state.submissions.filter(s => s.board === 'versioned:lap');
if (versioned[0]?.gameVersion === '9.9.9-test' && versioned[1]?.gameVersion === '1.9.0') console.log('ok   submit sends the default game version and honors an override');
else { failed++; console.log('FAIL submit sends the default game version and honors an override', JSON.stringify(versioned)); }
const unversioned = state.submissions.find(s => s.score === 77777);
if (unversioned && !('gameVersion' in unversioned)) console.log('ok   an empty game version is left out of the submit');
else { failed++; console.log('FAIL an empty game version is left out of the submit', JSON.stringify(unversioned)); }

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
