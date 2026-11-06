import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/lichii_test') throw new Error('Set TEST_DATABASE_URL to an isolated lichii_test PostgreSQL database.');

export default defineConfig({
  testDir: '.',
  testMatch: 'privacy.spec.ts',
  workers: 1,
  reporter: 'list',
  outputDir: '../test-results',
  use: {
    baseURL: 'http://lichii.example:3100',
    browserName: 'chromium',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/local/bin/chromium') ? '/usr/local/bin/chromium' : undefined),
      args: ['--host-resolver-rules=MAP lichii.example 127.0.0.1'],
    },
  },
  webServer: {
    command: 'npm start',
    cwd: '..',
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: false,
    env: {
      DATABASE_URL: databaseUrl,
      APP_ORIGIN: 'http://lichii.example:3100',
      PORT: '3100',
      NODE_ENV: 'test',
      TRUST_PROXY: 'false',
      COOKIE_SECRET: 'isolated-browser-test-cookie-secret-only',
      RATE_LIMIT_SECRET: 'isolated-browser-test-rate-limit-secret-only',
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
    },
  },
});
