#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

const OPENCLAW_CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json');

function printHelp() {
  console.log(`Usage:
  node scripts/setup-openclaw-gateway-origins.js [options]

Options:
  --dev                 Development preset: include ports 3000-3100
  --dry-run             Print proposed changes without writing
  --help                Show this help

Notes:
  - OpenClaw does exact origin matching for gateway.controlUi.allowedOrigins.
  - Wildcards like http://localhost:* and port ranges are not supported by OpenClaw.
`);
}

function parseArgs(argv) {
  const args = {
    ports: new Set(),
    dryRun: false,
    dev: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }

    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (arg === '--dev') {
      args.dev = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.dev) {
    for (let p = 3000; p <= 3100; p += 1) args.ports.add(p);
  }

  if (args.ports.size === 0) {
    args.ports.add(3000);
  }

  return args;
}

function ensureConfigShape(parsed) {
  const config = parsed && typeof parsed === 'object' ? parsed : {};
  config.gateway = config.gateway && typeof config.gateway === 'object' ? config.gateway : {};
  config.gateway.controlUi =
    config.gateway.controlUi && typeof config.gateway.controlUi === 'object'
      ? config.gateway.controlUi
      : {};

  const existing = config.gateway.controlUi.allowedOrigins;
  config.gateway.controlUi.allowedOrigins = Array.isArray(existing)
    ? existing.filter(value => typeof value === 'string' && value.trim())
    : [];

  return config;
}

async function main() {
  let parsedArgs;
  try {
    parsedArgs = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    printHelp();
    process.exit(1);
  }

  if (parsedArgs.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(OPENCLAW_CONFIG)) {
    console.error(`OpenClaw config not found: ${OPENCLAW_CONFIG}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = fs.readFileSync(OPENCLAW_CONFIG, 'utf8');
  } catch (err) {
    console.error(`Failed to read ${OPENCLAW_CONFIG}: ${err.message}`);
    process.exit(1);
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error(`Invalid JSON in ${OPENCLAW_CONFIG}: ${err.message}`);
    process.exit(1);
  }

  const config = ensureConfigShape(json);
  const currentOrigins = new Set(config.gateway.controlUi.allowedOrigins);

  const requestedOrigins = [];
  const sortedPorts = [...parsedArgs.ports].sort((a, b) => a - b);
  const hosts = ['localhost', '127.0.0.1'];
  for (const host of hosts) {
    for (const port of sortedPorts) {
      requestedOrigins.push(`http://${host}:${port}`);
    }
  }

  const added = requestedOrigins.filter(origin => !currentOrigins.has(origin));
  for (const origin of requestedOrigins) currentOrigins.add(origin);

  config.gateway.controlUi.allowedOrigins = [...currentOrigins].sort();

  if (parsedArgs.dryRun) {
    console.log(`[dry-run] Would add ${added.length} origin(s) to ${OPENCLAW_CONFIG}`);
    if (added.length > 0) {
      for (const origin of added) console.log(`  + ${origin}`);
    }
    return;
  }

  console.log(`Planned update: ${added.length} new origin(s) in ${OPENCLAW_CONFIG}`);
  if (added.length > 0) {
    for (const origin of added) console.log(`  + ${origin}`);
  }

  const isInteractive = stdin.isTTY && stdout.isTTY;
  if (!isInteractive) {
    console.error('Interactive confirmation required. Re-run from a terminal or use --dry-run first.');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const applyAnswer = await rl.question('Apply these changes? [Y/n] ');
  const shouldApply = !/^(n|no)$/i.test(applyAnswer.trim());
  if (!shouldApply) {
    rl.close();
    console.log('No changes applied.');
    return;
  }

  try {
    fs.writeFileSync(OPENCLAW_CONFIG, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  } catch (err) {
    rl.close();
    console.error(`Failed to write ${OPENCLAW_CONFIG}: ${err.message}`);
    process.exit(1);
  }

  console.log(`Updated ${OPENCLAW_CONFIG}`);
  if (added.length === 0) {
    console.log('No changes needed; all requested origins were already present.');
  } else {
    console.log(`Added ${added.length} origin(s):`);
    for (const origin of added) console.log(`  + ${origin}`);
  }
  const restartAnswer = await rl.question('Restart OpenClaw gateway now? [Y/n] ');
  const shouldRestart = !/^(n|no)$/i.test(restartAnswer.trim());
  rl.close();

  if (!shouldRestart) {
    console.log('Restart skipped. Run manually: openclaw gateway restart');
    return;
  }

  try {
    execSync('openclaw gateway restart', { stdio: 'inherit' });
    console.log('OpenClaw gateway restarted.');
  } catch (err) {
    console.error(`Failed to restart OpenClaw gateway: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
