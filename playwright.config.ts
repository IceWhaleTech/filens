import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/demo/e2e',
  testMatch: ['**/*.e2e.ts'],
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm.cmd run dev --workspace @filens/demo -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120000
  }
});
