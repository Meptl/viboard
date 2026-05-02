#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PID_FILE = path.join(ROOT, ".dev-test-fixture.json");
const LOG_DIR = path.join(ROOT, ".dev-test-fixture-logs");

function isPidRunning(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readState() {
  if (!fs.existsSync(PID_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.writeFileSync(PID_FILE, JSON.stringify(state, null, 2));
}

function getPort(kind) {
  const output = execSync(`node scripts/setup-dev-environment.js ${kind}`, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  return Number(output);
}

function spawnLogged(name, cmd, args, env, logFile) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const stream = fs.createWriteStream(logFile, { flags: "a" });
  stream.write(`\n[${new Date().toISOString()}] starting: ${cmd} ${args.join(" ")}\n`);

  const child = spawn(cmd, args, {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  child.unref();

  return child.pid;
}

function start() {
  const existing = readState();
  if (
    existing &&
    isPidRunning(existing.backendPid) &&
    isPidRunning(existing.frontendPid)
  ) {
    console.log(JSON.stringify({ status: "already_running", ...existing }, null, 2));
    return;
  }

  const shouldPrepareDb = process.argv.includes("--prepare-db");

  const frontendPort = getPort("frontend");
  const backendPort = getPort("backend");
  const viboardAssetDir = "tests/fixtures/sparse_config";

  if (shouldPrepareDb) {
    execSync("pnpm run prepare-db", {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
  }

  const now = Date.now();
  const backendLog = path.join(LOG_DIR, `backend-${now}.log`);
  const frontendLog = path.join(LOG_DIR, `frontend-${now}.log`);

  const backendPid = spawnLogged(
    "backend",
    "cargo",
    ["run", "--bin", "server"],
    {
      ...process.env,
      BACKEND_PORT: String(backendPort),
      VIBOARD_ASSET_DIR: viboardAssetDir,
    },
    backendLog
  );

  const frontendPid = spawnLogged(
    "frontend",
    "pnpm",
    ["run", "frontend:dev"],
    {
      ...process.env,
      FRONTEND_PORT: String(frontendPort),
      BACKEND_PORT: String(backendPort),
    },
    frontendLog
  );

  const state = {
    frontendPort,
    backendPort,
    viboardAssetDir,
    frontendPid,
    backendPid,
    frontendLog,
    backendLog,
    startedAt: new Date().toISOString(),
  };

  writeState(state);
  console.log(JSON.stringify({ status: "started", ...state }, null, 2));
}

function stop() {
  const state = readState();
  if (!state) {
    console.log(JSON.stringify({ status: "not_running" }, null, 2));
    return;
  }

  const killed = [];
  const failed = [];

  for (const [name, pid] of [
    ["backend", state.backendPid],
    ["frontend", state.frontendPid],
  ]) {
    if (!isPidRunning(pid)) continue;
    try {
      // Kill the detached process group so child processes are terminated too.
      process.kill(-pid, "SIGTERM");
      killed.push({ name, pid });
    } catch {
      failed.push({ name, pid });
    }
  }

  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }

  console.log(JSON.stringify({ status: "stopped", killed, failed }, null, 2));
}

function status() {
  const state = readState();
  if (!state) {
    console.log(JSON.stringify({ status: "not_running" }, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        status: "state_found",
        ...state,
        backendRunning: isPidRunning(state.backendPid),
        frontendRunning: isPidRunning(state.frontendPid),
      },
      null,
      2
    )
  );
}

const command = process.argv[2] || "start";
if (command === "start") {
  start();
} else if (command === "stop") {
  stop();
} else if (command === "status") {
  status();
} else {
  console.error("Usage: node scripts/dev-test-fixture.js [start|stop|status] [--prepare-db]");
  process.exit(1);
}
