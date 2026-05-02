import { defineConfig, devices } from '@playwright/test';

const frontendPort = process.env.FRONTEND_PORT || process.env.PORT || '3100';
const backendPort = process.env.BACKEND_PORT || `${Number(frontendPort) + 1}`;
const baseURL = `http://127.0.0.1:${frontendPort}`;

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
  webServer: [
    {
      command: `BACKEND_PORT=${backendPort} pnpm run prepare-db && BACKEND_PORT=${backendPort} pnpm run backend:dev:watch`,
      url: `http://127.0.0.1:${backendPort}/api/info`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
    {
      command: `FRONTEND_PORT=${frontendPort} BACKEND_PORT=${backendPort} pnpm run frontend:dev`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
