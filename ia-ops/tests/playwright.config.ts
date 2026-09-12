import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only (máximo 1 reintento para evitar esperas excesivas) */
  retries: process.env.CI ? 1 : 0,
  /* Paralelismo en CI */
  workers: process.env.CI ? 2 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['list'], ['html']],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers (Chromium estándar para CI rápido) */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  webServer: [
    {
      command: 'npm --prefix ../../src/frontend run dev -- --host 0.0.0.0',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm --prefix ../../mf-mapa-urbano run dev -- --host 0.0.0.0',
      url: 'http://localhost:5174/remoteEntry.js',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm --prefix ../../mf-dashboard run dev -- --host 0.0.0.0',
      url: 'http://localhost:5175/remoteEntry.js',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm --prefix ../../mf-chatbot run dev -- --host 0.0.0.0',
      url: 'http://localhost:3003/remoteEntry.js',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
