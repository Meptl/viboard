import { execSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

type DiscoveredPorts = { frontend: number; backend: number };

function discoverPorts(): DiscoveredPorts | null {
  try {
    const output = execSync('node scripts/setup-dev-environment.js get', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const candidate = lines[lines.length - 1];
    if (!candidate) return null;
    const parsed = JSON.parse(candidate) as Partial<DiscoveredPorts>;
    if (typeof parsed.frontend !== 'number' || typeof parsed.backend !== 'number') {
      return null;
    }
    return { frontend: parsed.frontend, backend: parsed.backend };
  } catch {
    return null;
  }
}

const discoveredPorts = discoverPorts();
const frontendPort = discoveredPorts ? String(discoveredPorts.frontend) : '3100';
const backendPort = discoveredPorts ? String(discoveredPorts.backend) : `${Number(frontendPort) + 1}`;
const baseURL = `http://127.0.0.1:${frontendPort}`;
const fixtureAssetDir = 'tests/fixtures/sparse_config';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    headless: true,
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `BACKEND_PORT=${backendPort} pnpm run prepare-db && FRONTEND_PORT=${frontendPort} BACKEND_PORT=${backendPort} VIBOARD_ASSET_DIR=${fixtureAssetDir} concurrently "BACKEND_PORT=${backendPort} VIBOARD_ASSET_DIR=${fixtureAssetDir} cargo run --bin server" "FRONTEND_PORT=${frontendPort} BACKEND_PORT=${backendPort} pnpm run frontend:dev"`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
