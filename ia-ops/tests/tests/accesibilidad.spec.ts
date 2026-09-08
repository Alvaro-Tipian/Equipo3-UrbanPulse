import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Pruebas de accesibilidad (guía QA, Fase 5, prueba #14) sobre las cuatro
// vistas de la aplicación. Usan axe-core para detectar violaciones contra
// las reglas WCAG 2.1 A y AA (contraste, roles ARIA, labels de formulario,
// estructura de encabezados, etc.).
//
// Reutilizan exactamente las mismas estrategias de sesión e interceptación
// de red que el resto de la suite: sesión de operador para Dashboard y
// Mapa, sesión de ciudadano para el Chat, y bloqueo de todo el tráfico que
// no sea localhost para que las vistas carguen de forma determinista.
//
// Solo se reportan violaciones de impacto "critical" o "serious": las de
// impacto "minor"/"moderate" (p. ej. contraste límite en un texto
// secundario) quedan registradas en el reporte HTML de Playwright para
// revisión, pero no rompen la suite.
//
// Esta suite encontró dos defectos nuevos, presentes en las cuatro vistas
// porque viven en componentes compartidos del shell:
//
//   D-15 — Contraste insuficiente en los elementos que usan --color-accent
//   (#A855F7). Afecta a la etiqueta de cada pestaña de navegación (CHAT,
//   MAPA, DASHBOARD) y a los botones "Iniciar sesión"/enviar del
//   formulario de autenticación. Regla axe: color-contrast (serious).
//
//   D-16 — El botón de enviar mensaje del chat es un ícono sin texto
//   accesible (sin aria-label ni texto visible), por lo que un lector de
//   pantalla no puede anunciar su función. Regla axe: button-name
//   (critical).
//
// Ambos son defectos de la aplicación, no de la prueba: se dejan
// documentados con test.fail() en los casos que los detectan, igual que
// D-14 en dashboard.spec.ts, para que la suite notifique en cuanto se
// corrijan.

const SEVERIDADES_BLOQUEANTES = ['critical', 'serious'];

const REPORTS_LIST_PATH = '**/webhook/urbanpulse/reports-list';
const KPIS_PATH = '**/webhook/urbanpulse/dashboard-kpis';

const SESION_OPERADOR = {
  success: true,
  username: 'qa-tester',
  role: 'Operador QA',
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

const SESION_CIUDADANO = {
  success: true,
  id: '11111111-1111-4111-8111-111111111111',
  email: 'qa-tester@ejemplo.com',
  role: 'ciudadano',
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

const SAMPLE_KPIS_RESPONSE = {
  kpis: {
    total_reportes: 128,
    reportes_ultimas_24h: 7,
    congestion_promedio: 42,
    puntos_congestionados: 3,
    total_puntos_monitoreo: 10,
    total_siniestros_fatales: 15,
    total_fallecidos_historico: 18,
  },
  charts: {
    reportes_por_tipo: [{ name: 'bache', value: 40 }],
    reportes_por_severidad: [{ name: 'alta', value: 30 }],
    tendencia_reportes_30d: [{ name: '01/09', value: 5 }],
    siniestros_por_distrito: [{ name: 'Miraflores', value: 4 }],
    siniestros_por_clase: [{ name: 'Choque', value: 10, fallecidos: 3 }],
  },
  generated_at: new Date().toISOString(),
};

const SAMPLE_REPORTS = [
  { latitude: -12.05, longitude: -77.03, incident_type: 'infraestructura_vial' },
];

// Reduce el listado de violaciones a lo mínimo necesario para diagnosticar
// un fallo directamente desde la consola, sin abrir el reporte HTML.
function resumenViolaciones(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations
    .filter((v) => SEVERIDADES_BLOQUEANTES.includes(v.impact ?? ''))
    .map((v) => ({
      regla: v.id,
      impacto: v.impact,
      ayuda: v.help,
      elementos: v.nodes.map((n) => n.target.join(' ')),
    }));
}

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );
});

test('el formulario de autenticación no tiene violaciones críticas de accesibilidad', async ({ page }) => {
  test.fail(); // D-15: contraste insuficiente en los elementos con --color-accent
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'CHAT', exact: true }).click();
  await expect(page.getByPlaceholder('Correo electrónico')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(resumenViolaciones(results.violations)).toEqual([]);
});

test('el chat de reporte de incidentes no tiene violaciones críticas de accesibilidad', async ({ page }) => {
  test.fail(); // D-15 (contraste) + D-16: el botón de enviar no tiene nombre accesible
  await page.addInitScript((sesion) => {
    window.localStorage.setItem('urbanpulse_citizen_session', JSON.stringify(sesion));
  }, SESION_CIUDADANO);

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'CHAT', exact: true }).click();
  await expect(page.getByPlaceholder('Reporta un incidente....')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(resumenViolaciones(results.violations)).toEqual([]);
});

test('el panel analítico no tiene violaciones críticas de accesibilidad', async ({ page }) => {
  // D-14: al llegar datos reales, Recharts se monta con una segunda
  // instancia de React y la aplicación entera queda en blanco (ver
  // dashboard.spec.ts). Sin contenido que analizar, axe no puede evaluar
  // la vista real; se documenta como el mismo defecto, no como uno nuevo.
  test.fail(); // D-14: la app se cae al renderizar los gráficos
  await page.route(KPIS_PATH, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_KPIS_RESPONSE) })
  );
  await page.addInitScript((sesion) => {
    window.localStorage.setItem('urbanpulse_session', JSON.stringify(sesion));
  }, SESION_OPERADOR);

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'DASHBOARD', exact: true }).click();
  await expect(page.getByText('Total de Reportes')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(resumenViolaciones(results.violations)).toEqual([]);
});

test('el mapa urbano no tiene violaciones críticas de accesibilidad', async ({ page }) => {
  test.fail(); // D-15: contraste insuficiente en los elementos con --color-accent
  await page.route(REPORTS_LIST_PATH, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_REPORTS) })
  );
  await page.addInitScript((sesion) => {
    window.localStorage.setItem('urbanpulse_session', JSON.stringify(sesion));
  }, SESION_OPERADOR);

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'MAPA', exact: true }).click();
  await expect(page.getByText('Tipo de incidente')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    // El widget del mapa de TomTom es un componente de terceros que la
    // aplicación no controla; se excluye del análisis para que la prueba
    // vigile el código propio del proyecto, no el de un proveedor externo.
    .exclude('#tomtom-map-container')
    .analyze();

  expect(resumenViolaciones(results.violations)).toEqual([]);
});
