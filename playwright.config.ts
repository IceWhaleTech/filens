import { defineConfig } from '@playwright/test';

const externalBaseURL = process.env.FILENS_E2E_BASE_URL;

export default defineConfig({
  testDir: './apps/demo/e2e',
  testMatch: ['**/*.e2e.ts'],
  timeout: 30000,
  use: {
    baseURL: externalBaseURL || 'http://127.0.0.1:4173/modules/filens/',
    trace: 'retain-on-failure'
  },
  webServer: externalBaseURL ? undefined : {
    command: `${process.platform === 'win32' ? 'npm.cmd' : 'npm'} run dev --workspace @filens/demo -- --host 127.0.0.1 --port 4173`,
    url: 'http://127.0.0.1:4173/modules/filens/',
    reuseExistingServer: true,
    timeout: 120000
  }
});
