import { defineConfig } from '@playwright/test';

const frontendPort = 22027;
const backendPort = 20263;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    browserName: 'chromium',
    baseURL: `http://127.0.0.1:${frontendPort}`,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `python -m uvicorn backend.app.main:app --host 127.0.0.1 --port ${backendPort}`,
      cwd: '..',
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        ETYMAE_TEST_MODE: '1',
        ETYMAE_DATABASE_PATH: 'backend/data/test.db',
      },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort}`,
      cwd: '.',
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        VITE_BACKEND_TARGET: `http://127.0.0.1:${backendPort}`,
        VITE_PORT: String(frontendPort),
      },
    },
  ],
});
