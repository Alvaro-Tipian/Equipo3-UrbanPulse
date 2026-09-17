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
  /* En CI, el webServer[] levanta 4 servidores de Vite (host + 3
   * microfrontends) desde cero en cada run. Con 2+ workers, varios archivos
   * de test arrancan a la vez contra esos servidores mientras Vite todavía
   * está compilando módulos bajo demanda por primera vez, y un click puede
   * dispararse antes de que la vista termine de montar (visto: la suite de
   * dashboard fallaba en paralelo pero pasaba siempre en secuencial). Un
   * solo worker evita esa carrera a costa de una ejecución algo más lenta. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['list'], ['html']],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Guarda el video solo de los tests que fallan, como evidencia para sustentación. */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers (Chromium estándar para CI rápido) */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Permite apuntar a un binario de Chromium ya instalado (p. ej. en
        // sandboxes/CI donde `npx playwright install` no está disponible)
        // sin afectar a quienes corren `npx playwright install` normalmente.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? {
              launchOptions: {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
                args: ['--disable-background-networking', '--disable-component-update'],
              },
            }
          : {}),
      },
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
