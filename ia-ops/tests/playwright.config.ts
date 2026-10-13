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
  /* El webServer[] levanta 8 servidores de Vite (host + 7 microfrontends)
   * desde cero en cada run. Con 2+ workers, varios archivos de test arrancan a
   * la vez contra esos servidores mientras Vite todavía está compilando
   * módulos bajo demanda por primera vez, y un click puede dispararse antes de
   * que la vista termine de montar.
   *
   * Un solo worker SIEMPRE, no solo en CI. Antes el límite se aplicaba con
   * `process.env.CI ? 1 : undefined`, así que en local la suite corría en
   * paralelo y fallaba un test distinto en cada ejecución por timeout —con 3
   * microfrontends la carrera se ganaba casi siempre; con 7 ya no. Además,
   * que local y CI usen la misma concurrencia es lo que hace reproducible un
   * fallo de CI en la máquina de quien lo tiene que arreglar. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  /* El reporter json alimenta scripts/certificar-sla.mjs (HT-37): la
   * certificación se calcula sobre los resultados reales de la corrida, no
   * sobre lo que alguien copie a mano en un documento. */
  reporter: [['list'], ['html'], ['json', { outputFile: 'reportes/playwright.json' }]],

  /* 15 s en vez de los 5 s por defecto. Cada vista monta su microfrontend por
   * Module Federation con React.lazy, y la PRIMERA vez que se abre una pestaña
   * el servidor de Vite todavía tiene que compilar ese remoto bajo demanda:
   * la primera aserción sobre su contenido espera la descarga del remoteEntry,
   * la del chunk y esa compilación. Con 5 s el grid del operador fallaba por
   * los pelos aunque la app funcionara. */
  expect: { timeout: 15_000 },
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

  /* Los microfrontends federados que el host resuelve en local, segun
   * src/frontend/public/remotes.local.json. Tras el refactor de HT-39 ya no son
   * tres: el login vive en mf-auth y el grid del operador en
   * mf-gestion-incidentes, asi que arrancar solo mapa, dashboard y chatbot
   * dejaba la mitad de la app sin montar.
   *
   * mf-panel-riesgo queda fuera a proposito: hoy es un scaffold de Vite sin
   * Module Federation (HU-08 en curso), no expone remoteEntry.js y esperarlo
   * colgaria el arranque. El host lo degrada con RemoteBoundary, y
   * mapa.spec.ts cubre ese camino. */
  webServer: [
    {
      command: 'npm --prefix ../../src/frontend run dev -- --host 0.0.0.0',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    ...[
      ['mf-gestion-incidentes', 5173],
      ['mf-mapa-urbano', 5174],
      ['mf-dashboard', 5175],
      ['mf-historial-reportes', 5176],
      ['mf-auth', 5177],
      ['mf-ajustes', 5178],
      ['mf-chatbot', 3003],
    ].map(([nombre, puerto]) => ({
      command: `npm --prefix ../../${nombre} run dev -- --host 0.0.0.0`,
      url: `http://localhost:${puerto}/remoteEntry.js`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    })),
  ],
});
