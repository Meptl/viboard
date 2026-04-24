#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const electronOutDir = path.join(rootDir, 'dist-electron');
const frontendCacheDir = path.join(rootDir, '.cache', 'build-electron');
const frontendInputsHashFile = path.join(frontendCacheDir, 'frontend-inputs.sha256');

function run(cmd, args, options = {}) {
  const isWindowsPnpm = process.platform === 'win32' && cmd === 'pnpm';
  const command = isWindowsPnpm ? 'cmd.exe' : cmd;
  const commandArgs = isWindowsPnpm ? ['/d', '/s', '/c', 'pnpm', ...args] : args;
  const renderedCommand = `${command} ${commandArgs.join(' ')}`.trim();
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });

  if (result.status !== 0 || result.error || result.signal) {
    console.error(
      [
        `Command failed: ${renderedCommand}`,
        `status=${String(result.status)}`,
        `signal=${result.signal ?? 'none'}`,
        `error=${result.error ? result.error.message : 'none'}`,
      ].join(' | ')
    );
  }

  if (result.error) {
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function backendBinaryName() {
  return process.platform === 'win32' ? 'server.exe' : 'server';
}

function backendBinaryPath() {
  return path.join(rootDir, 'target', 'release', backendBinaryName());
}

function ensureBackendBinaryExists() {
  const backendPath = backendBinaryPath();
  if (!fs.existsSync(backendPath)) {
    console.error(`Expected backend binary at ${backendPath}, but it was not found.`);
    process.exit(1);
  }
}

function collectFilesRecursively(relativePath, output) {
  const fullPath = path.join(rootDir, relativePath);
  if (!fs.existsSync(fullPath)) {
    return;
  }

  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    output.push(relativePath);
    return;
  }

  for (const entry of fs.readdirSync(fullPath, { withFileTypes: true })) {
    const childRelativePath = path.join(relativePath, entry.name);
    if (
      entry.isDirectory() &&
      (entry.name === 'dist' ||
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === '.vite')
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      collectFilesRecursively(childRelativePath, output);
    } else if (entry.isFile()) {
      output.push(childRelativePath);
    }
  }
}

function computeFrontendInputsHash() {
  const files = [];
  const frontendInputRoots = ['frontend', 'shared/types.ts', 'pnpm-lock.yaml'];

  for (const inputRoot of frontendInputRoots) {
    collectFilesRecursively(inputRoot, files);
  }

  files.sort();

  const hash = crypto.createHash('sha256');
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(rootDir, relativePath)));
    hash.update('\0');
  }

  return hash.digest('hex');
}

function shouldBuildFrontend() {
  if (process.env.FORCE_FRONTEND_BUILD === '1') {
    return true;
  }

  const frontendDistDir = path.join(rootDir, 'frontend', 'dist');
  if (!fs.existsSync(frontendDistDir)) {
    return true;
  }

  const currentHash = computeFrontendInputsHash();
  if (!fs.existsSync(frontendInputsHashFile)) {
    return true;
  }

  const previousHash = fs.readFileSync(frontendInputsHashFile, 'utf8').trim();
  return previousHash !== currentHash;
}

function persistFrontendInputsHash() {
  const currentHash = computeFrontendInputsHash();
  fs.mkdirSync(frontendCacheDir, { recursive: true });
  fs.writeFileSync(frontendInputsHashFile, `${currentHash}\n`, 'utf8');
}

function writeBuilderConfig() {
  const iconPath = path.join(rootDir, 'docs', 'logo', 'v-768.png');
  const backendPath = backendBinaryPath();

  const config = {
    appId: 'ai.bloop.vibekanban',
    productName: 'Viboard',
    directories: {
      output: electronOutDir,
      buildResources: path.join(rootDir, 'docs', 'logo'),
    },
    files: [
      {
        from: rootDir,
        to: '.',
        filter: ['electron/**', 'package.json'],
      },
    ],
    extraResources: [
      {
        from: backendPath,
        to: `bin/${backendBinaryName()}`,
      },
    ],
    extraMetadata: {
      main: 'electron/main.cjs',
    },
    linux: {
      target: ['AppImage', 'deb'],
      category: 'Development',
      icon: iconPath,
    },
    mac: {
      target: ['dmg', 'zip'],
      icon: iconPath,
    },
    win: {
      target: ['nsis', 'zip'],
      icon: iconPath,
    },
  };

  const configPath = path.join(rootDir, '.electron-builder.generated.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

function main() {
  const builderArgs = process.argv.slice(2);
  const skipFrontendBuild = process.env.SKIP_FRONTEND_BUILD === '1';
  const skipRustBuild = process.env.SKIP_RUST_BUILD === '1';

  const needsFrontendBuild = !skipFrontendBuild && shouldBuildFrontend();

  if (needsFrontendBuild) {
    run('pnpm', ['--dir', 'frontend', 'run', 'build']);
    persistFrontendInputsHash();
  } else if (!skipFrontendBuild) {
    console.log(
      'Skipping frontend build because frontend inputs are unchanged. Set FORCE_FRONTEND_BUILD=1 to force rebuilding.'
    );
  }

  if (!skipRustBuild) {
    run('cargo', ['build', '--release', '--bin', 'server']);
  }

  ensureBackendBinaryExists();

  const builderConfigPath = writeBuilderConfig();
  run('pnpm', [
    'exec',
    'electron-builder',
    '--config',
    builderConfigPath,
    '--publish',
    'never',
    ...builderArgs,
  ]);
}

main();
