#!/usr/bin/env node
// servicenow kit - one-shot ServiceNow-side setup. Enables the client_credentials
// grant type, registers (or rotates) the OAuth application, verifies a real
// token exchange, and stores the resulting credentials as Gipity secrets.
//
// Run from your app's project directory, after `gipity add servicenow`:
//
//   node src/packages/servicenow/scripts/connect.mjs \
//     --instance https://you.service-now.com --username gipity.integration
//
// The service account password is used directly against YOUR ServiceNow
// instance and never sent anywhere else - not to Gipity, not logged, not
// stored. Only the derived Client ID/Secret (not the password) are offered to
// `gipity secrets set`.
//
// Prerequisite: a dedicated ServiceNow service account must already exist.
// Do NOT use the built-in `admin` account - see the kit README, setup step 1.
import { randomBytes } from 'crypto';
import { createInterface } from 'readline';
import { execFileSync } from 'child_process';
import {
  testAuth, getUserSysId, ensureGrantTypeProperty, createOrUpdateOAuthEntity,
  verifyClientCredentials, basicAuthHeader,
} from './lib/servicenow-setup.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--instance') out.instance = argv[++i];
    else if (a === '--username') out.username = argv[++i];
    else if (a === '--password') out.password = argv[++i];
    else if (a === '--name') out.name = argv[++i];
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

/** Masked password entry via raw stdin mode - deliberately not readline's
 *  private `_writeToOutput` (fragile across Node versions); this only relies
 *  on the public `setRawMode` API. */
function promptHidden(query) {
  if (!process.stdin.isTTY) throw new Error(`Not a TTY - pass ${query.trim()} as a flag instead.`);
  return new Promise((resolve, reject) => {
    process.stdout.write(query);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let input = '';
    const onData = (char) => {
      if (char === '') { cleanup(); process.stdout.write('\n'); reject(new Error('Cancelled.')); return; }
      if (char === '\n' || char === '\r') { cleanup(); process.stdout.write('\n'); resolve(input); return; }
      if (char === '' || char === '\b') {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: node scripts/connect.mjs [--instance URL] [--username NAME] [--password PASS] [--name "App Name"] [--no-secrets]\n\n'
      + 'Sets up the ServiceNow-side OAuth application for the servicenow kit and stores the\n'
      + 'resulting credentials as Gipity secrets on this project. Flags are prompted for if omitted\n'
      + '(password entry is masked). --no-secrets prints the gipity secrets set commands instead of running them.',
    );
    return;
  }

  const instanceRaw = args.instance || await prompt('ServiceNow instance URL (e.g. https://you.service-now.com): ');
  const instance = instanceRaw.replace(/\/+$/, '');
  const username = args.username || await prompt('Dedicated service account username (NOT admin - see README): ');
  const password = args.password || await promptHidden('Password: ');
  const name = args.name || 'Gipity Integration';

  if (!instance || !username || !password) throw new Error('Instance URL, username, and password are all required.');

  console.log(`\nChecking ${username}@${instance} ...`);
  await testAuth(fetch, instance, username, password);
  console.log('  Basic Auth OK.');

  const auth = basicAuthHeader(username, password);
  const userSysId = await getUserSysId(fetch, instance, auth, username);

  const propResult = await ensureGrantTypeProperty(fetch, instance, auth);
  console.log(`  Client Credentials grant type: ${propResult}.`);

  // Full rotation on every run (create or reuse) - simplest, most predictable
  // behavior, and safe since the new secret is pushed to Gipity in this same run.
  const clientId = `gipity_${randomBytes(6).toString('hex')}`;
  const clientSecret = randomBytes(32).toString('base64url');
  const entity = await createOrUpdateOAuthEntity(fetch, instance, auth, { name, clientId, clientSecret, userSysId });
  console.log(`  OAuth application "${name}": ${entity.reused ? 'reused existing, rotated credentials' : 'created'}.`);

  console.log('  Verifying a real token exchange...');
  await verifyClientCredentials(fetch, instance, clientId, clientSecret);
  console.log('  Verified: token issued and accepted by the Table API.\n');

  const toSet = {
    SERVICENOW_INSTANCE_URL: instance,
    SERVICENOW_CLIENT_ID: clientId,
    SERVICENOW_CLIENT_SECRET: clientSecret,
  };

  let stored = false;
  if (!args.noSecrets) {
    try {
      for (const [k, v] of Object.entries(toSet)) execFileSync('gipity', ['secrets', 'set', k, v], { stdio: 'ignore' });
      stored = true;
    } catch {
      // gipity CLI not on PATH, not logged in, or no linked project here -
      // fall through to printing the commands rather than failing the run;
      // the ServiceNow-side setup above already succeeded and is the
      // expensive, hard-to-repeat part.
    }
  }

  if (stored) {
    console.log('Secrets set on this project.');
  } else {
    console.log('Run these to finish setup:\n');
    for (const [k, v] of Object.entries(toSet)) console.log(`  gipity secrets set ${k} ${v}`);
  }
  console.log('\nStill required: add your instance hostname to fetch_domains for sn-pull and');
  console.log('sn-write in gipity.yaml (the kit can\'t know it ahead of time - see the kit');
  console.log('README), set SERVICENOW_TABLES, then `gipity deploy`.');
}

main().catch((err) => {
  console.error(`\nSetup failed: ${err.message}`);
  process.exit(1);
});
