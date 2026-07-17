#!/usr/bin/env node
// servicenow kit - Phase 2 (real-time sync) ServiceNow-side setup. Creates the
// GipitySync Script Include, a Business Rule per configured table (loop-prevention
// wired to the same service account used for OAuth), and the webhook system
// properties - then stores the webhook secret as a Gipity secret.
//
// Run from your app's project directory, after running scripts/connect.mjs
// (Phase 1) and deploying (sn-webhook has to exist before ServiceNow can push to it):
//
//   node src/packages/servicenow/scripts/connect-realtime.mjs \
//     --instance https://you.service-now.com --username gipity.integration --tables incident,problem
//
// Same rule as connect.mjs: the service account password is used directly
// against YOUR instance and never sent anywhere else.
import { randomBytes } from 'crypto';
import { createInterface } from 'readline';
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { testAuth, basicAuthHeader } from './lib/servicenow-setup.js';
import { ensureWebhookProperties, ensureScriptInclude, ensureBusinessRule } from './lib/servicenow-realtime-setup.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--instance') out.instance = argv[++i];
    else if (a === '--username') out.username = argv[++i];
    else if (a === '--password') out.password = argv[++i];
    else if (a === '--tables') out.tables = argv[++i];
    else if (a === '--webhook-url') out.webhookUrl = argv[++i];
    else if (a === '--webhook-secret') out.webhookSecret = argv[++i];
    else if (a === '--no-secrets') out.noSecrets = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function prompt(query) {
  if (!process.stdin.isTTY) throw new Error(`Not a TTY - pass ${query.trim()} as a flag instead.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (answer) => { rl.close(); resolve(answer.trim()); }));
}

function promptHidden(query) {
  if (!process.stdin.isTTY) throw new Error(`Not a TTY - pass ${query.trim()} as a flag instead.`);
  return new Promise((resolve, reject) => {
    process.stdout.write(query);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let input = '';
    const onData = (char) => {
      if (char === '') { cleanup(); process.stdout.write('\n'); reject(new Error('Cancelled.')); return; }
      if (char === '\n' || char === '\r') { cleanup(); process.stdout.write('\n'); resolve(input); return; }
      if (char === '' || char === '\b') {
        if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
        return;
      }
      input += char;
      process.stdout.write('*');
    };
    const cleanup = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener('data', onData); };
    process.stdin.on('data', onData);
  });
}

/** Walks up from cwd looking for .gipity.json, mirroring the gipity CLI's own
 *  project-root search - used to auto-derive the webhook URL (apiBase +
 *  projectGuid) so the user doesn't have to know or paste it manually. */
function findGipityConfig(startDir) {
  let dir = startDir;
  for (let i = 0; i < 50; i++) {
    const candidate = join(dir, '.gipity.json');
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: node scripts/connect-realtime.mjs [--instance URL] [--username NAME] [--password PASS]\n'
      + '         [--tables incident,problem] [--webhook-url URL] [--webhook-secret SECRET] [--no-secrets]\n\n'
      + 'Sets up real-time sync: a Business Rule per table pushes changes to your deployed sn-webhook\n'
      + 'function via a Script Include. Run scripts/connect.mjs (Phase 1) and `gipity deploy` first -\n'
      + 'sn-webhook has to exist before ServiceNow can push to it. The webhook URL is auto-derived from\n'
      + '.gipity.json in this directory (or a parent) unless --webhook-url is given.',
    );
    return;
  }

  const instanceRaw = args.instance || await prompt('ServiceNow instance URL (e.g. https://you.service-now.com): ');
  const instance = instanceRaw.replace(/\/+$/, '');
  const username = args.username || await prompt('Dedicated service account username (same one used for connect.mjs): ');
  const password = args.password || await promptHidden('Password: ');
  const tablesRaw = args.tables || await prompt('Tables to sync, comma-separated (e.g. incident,problem): ');
  const tables = tablesRaw.split(',').map(t => t.trim()).filter(Boolean);

  if (!instance || !username || !password) throw new Error('Instance URL, username, and password are all required.');
  if (tables.length === 0) throw new Error('At least one table is required.');

  let webhookUrl = args.webhookUrl;
  if (!webhookUrl) {
    const config = findGipityConfig(process.cwd());
    if (!config?.apiBase || !config?.projectGuid) {
      throw new Error(
        'Could not find .gipity.json (or it is missing apiBase/projectGuid) - run this from your app\'s '
        + 'project directory, or pass --webhook-url explicitly.',
      );
    }
    webhookUrl = `${config.apiBase}/api/${config.projectGuid}/fn/sn-webhook`;
  }
  const webhookSecret = args.webhookSecret || randomBytes(32).toString('base64url');

  console.log(`\nChecking ${username}@${instance} ...`);
  await testAuth(fetch, instance, username, password);
  console.log('  Basic Auth OK.');
  const auth = basicAuthHeader(username, password);

  console.log(`  Webhook URL: ${webhookUrl}`);
  const propResult = await ensureWebhookProperties(fetch, instance, auth, { webhookUrl, webhookSecret });
  console.log(`  System properties: gipity.webhook.url ${propResult.url}, gipity.webhook.secret ${propResult.secret}.`);

  const siResult = await ensureScriptInclude(fetch, instance, auth);
  console.log(`  Script Include "GipitySync": ${siResult}.`);

  for (const table of tables) {
    const brResult = await ensureBusinessRule(fetch, instance, auth, { table, integrationUsername: username });
    console.log(`  Business Rule "Gipity Sync - ${table}": ${brResult}.`);
  }

  const toSet = { SERVICENOW_WEBHOOK_SECRET: webhookSecret };
  let stored = false;
  if (!args.noSecrets) {
    try {
      for (const [k, v] of Object.entries(toSet)) execFileSync('gipity', ['secrets', 'set', k, v], { stdio: 'ignore' });
      stored = true;
    } catch {
      // gipity CLI not on PATH, not logged in, or no linked project here -
      // fall through to printing the command. The ServiceNow-side setup
      // above already succeeded and is the expensive, hard-to-repeat part.
    }
  }

  console.log('');
  if (stored) {
    console.log('Secret set on this project.');
  } else {
    console.log('Run this to finish setup:\n');
    console.log(`  gipity secrets set SERVICENOW_WEBHOOK_SECRET ${webhookSecret}`);
  }
  console.log('\n`gipity deploy` (if you have not since adding sn-webhook), then update one of the');
  console.log(`configured tables (${tables.join(', ')}) in ServiceNow as a DIFFERENT user than `);
  console.log(`'${username}' and check sn_records for a row with origin='webhook'.`);
}

main().catch((err) => {
  console.error(`\nSetup failed: ${err.message}`);
  process.exit(1);
});
