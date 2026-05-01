#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FIELD_SEPARATOR = '\x1f';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function prodAssetDir() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'vibe-kanban');
    case 'win32':
      return path.join(
        process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
        'vibe-kanban'
      );
    default:
      return path.join(home, '.local', 'share', 'vibe-kanban');
  }
}

function detectAssetDir(explicitAssetDir) {
  if (explicitAssetDir) {
    return path.resolve(explicitAssetDir);
  }

  const candidates = [
    path.join(__dirname, '..', 'dev_assets'),
    prodAssetDir(),
    path.join(os.homedir(), '.local', 'share', 'ai.bloop.vibe-kanban'),
  ];

  for (const candidate of candidates) {
    const dbExists = fs.existsSync(path.join(candidate, 'db.sqlite'));
    const configExists = fs.existsSync(path.join(candidate, 'config.json'));
    if (dbExists || configExists) {
      return candidate;
    }
  }

  return candidates[0];
}

function normalizeNullable(value) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseBoolean(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

function runQuery(dbPath, query) {
  const result = spawnSync(
    'sqlite3',
    ['-separator', FIELD_SEPARATOR, dbPath, query],
    { encoding: 'utf8' }
  );

  if (result.error) {
    throw new Error(`Failed to execute sqlite3: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'sqlite3 query failed');
  }

  const lines = result.stdout
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  return lines.map((line) => {
    const [id, setup, dev, cleanup, copyFiles, parallel] =
      line.split(FIELD_SEPARATOR);
    return {
      id,
      setup_script: normalizeNullable(setup),
      dev_script: normalizeNullable(dev),
      cleanup_script: normalizeNullable(cleanup),
      copy_files: normalizeNullable(copyFiles),
      parallel_setup_script: parseBoolean(parallel),
    };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`
Usage:
  node scripts/migrate-project-settings-to-config.js [--db <db.sqlite>] [--config <config.json>] [--dry-run]

Defaults:
  db:     <asset_dir>/db.sqlite
  config: <asset_dir>/config.json
`);
    return;
  }

  const assetDir = detectAssetDir(args['assets-dir']);
  const dbPath = path.resolve(args.db || path.join(assetDir, 'db.sqlite'));
  const configPath = path.resolve(
    args.config || path.join(assetDir, 'config.json')
  );
  const dryRun = Boolean(args['dry-run']);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const rows = runQuery(
    dbPath,
    "SELECT id, setup_script, dev_script, cleanup_script, copy_files, parallel_setup_script FROM projects;"
  );

  const configRaw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configRaw);
  const previous = config.project_settings || {};
  const next = { ...previous };

  for (const row of rows) {
    next[row.id] = {
      setup_script: row.setup_script,
      dev_script: row.dev_script,
      cleanup_script: row.cleanup_script,
      copy_files: row.copy_files,
      parallel_setup_script: row.parallel_setup_script,
    };
  }

  config.project_settings = next;

  if (dryRun) {
    console.log(
      `Dry run complete. Would migrate ${rows.length} project settings from ${dbPath} into ${configPath}.`
    );
    return;
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(
    `Migrated ${rows.length} projects from DB to config: ${configPath}`
  );
}

try {
  main();
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exit(1);
}
