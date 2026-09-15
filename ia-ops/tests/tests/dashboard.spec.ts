import { test, expect } from '@playwright/test';

// Pruebas de UI del panel analítico (guía QA, Fase 4, prueba #7) para
// mf-dashboard (Dashboard.jsx), montado como microfrontend federado en la
// pestaña "DASHBOARD".
//
// El componente pega, por defecto, contra el n8n de PRODUCCIÓN (URL
// hardcodeada como fallback si no existe TE_N8N_DASHBOARD_KPIS_URL). Se
// intercepta con page.route() para cubrir de forma determinista sus tres
// estados: loading, error y success con datos.

const KPIS_PATH = '**/webhook/urbanpulse/dashboard-kpis';

const SAMPLE_KPIS_RESPONSE = {
  kpis: {
    total_reportes: 128,
    reportes_ultimas_24h: 7,
    congestion_promedio: 42,
    puntos_congestionados: 3,
    total_puntos_monitoreo: 10,
    total_siniestros_fatales: 15,
    total_fallecidos_historico: 18,
    total_siniestros_sutran: 9,
    total_fallecidos_sutran: 4,
    total_heridos_sutran: 12,
  },
  charts: {
    reportes_por_tipo: [
      { name: 'bache', value: 40 },
      { name: 'semáforo', value: 20 },
    ],
    reportes_por_severidad: [
      { name: 'alta', value: 30 },
      { name: 'baja', value: 30 },
    ],
    tendencia_reportes_30d: [
      { name: '01/09', value: 5 },
      { name: '02/09', value: 8 },
    ],
    siniestros_por_distrito: [
      { name: 'Miraflores', value: 4 },
      { name: 'Surco', value: 6 },
    ],
    siniestros_por_clase: [
      { name: 'Atropello', value: 5, fallecidos: 2 },
      { name: 'Choque', value: 10, fallecidos: 3 },
    ],
    siniestros_sutran_por_departamento: [
      { name: 'Lima', value: 3 },
      { name: 'Arequipa', value: 6 },
    ],
    siniestros_sutran_por_modalidad: [
      { name: 'Volcadura', value: 4, fallecidos: 1 },
      { name: 'Choque', value: 5, fallecidos: 3 },
    ],
  },
  generated_at: new Date().toISOString(),
};

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );

  await page.addInitScript(() => {
    window.localStorage.setItem(
      'urbanpulse_citizen_session',
      JSON.stringify({
        success: true,
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        email: 'qa-tester@example.com',
        username: 'qa-tester',
        role: 'Operador QA',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
    );
  });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
});

test('muestra el estado de carga mientras llegan los KPIs', async ({ page }) => {
  await page.route(KPIS_PATH, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_KPIS_RESPONSE) });
  });

  await page.getByRole('button', { name: 'DASHBOARD', exact: true }).click();

  await expect(page.getByText('Cargando métricas de la ciudad...')).toBeVisible();
});

test('muestra un mensaje de error si el servidor de métricas falla', async ({ page }) => {
  await page.route(KPIS_PATH, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));

  await page.getByRole('button', { name: 'DASHBOARD', exact: true }).click();

  await expect(page.getByText('No se pudieron cargar los KPIs')).toBeVisible();
  await expect(page.getByText('Error de conexión con n8n: 500')).toBeVisible();
});

// D-14 CORREGIDO — mf-dashboard/vite.config.js ahora declara react/react-dom
// como singleton, igual que el host (antes solo el host lo declaraba así,
// mf-dashboard cargaba su propia copia de React y la app quedaba en blanco
// al montar Recharts con "Invalid hook call" / "Cannot read properties of
// null (reading 'useRef')"). Se retiraron los test.fail() de esta suite:
// si el defecto reaparece, estas pruebas volverán a fallar y lo señalarán.
test('muestra las tarjetas de KPIs y los gráficos con los datos recibidos', async ({ page }) => {
  await page.route(KPIS_PATH, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_KPIS_RESPONSE) })
  );

  await page.getByRole('button', { name: 'DASHBOARD', exact: true }).click();

  await expect(page.getByText('Total de Reportes')).toBeVisible();
  await expect(page.getByText('128')).toBeVisible();
  await expect(page.getByText('Reportes Últimas 24h')).toBeVisible();
  await expect(page.getByText('Congestión Promedio')).toBeVisible();
  await expect(page.getByText('42%')).toBeVisible();
  await expect(page.getByText('Puntos Congestionados')).toBeVisible();
  await expect(page.getByText('3/10')).toBeVisible();
  await expect(page.getByText('Siniestros Fatales ONSV (histórico)')).toBeVisible();
  await expect(page.getByText('Fallecidos ONSV (histórico)')).toBeVisible();
  await expect(page.getByText('Siniestros SUTRAN (carreteras)')).toBeVisible();
  await expect(page.getByText('Fallecidos y Heridos SUTRAN')).toBeVisible();

  await expect(page.getByText('Reportes por tipo de incidente')).toBeVisible();
  await expect(page.getByText('Reportes por severidad')).toBeVisible();
  await expect(page.getByText('Tendencia de reportes (30 días)')).toBeVisible();
  await expect(page.getByText('Siniestros fatales ONSV por distrito')).toBeVisible();
  await expect(page.getByText('Siniestros fatales ONSV por clase')).toBeVisible();
  await expect(page.getByText('Siniestros SUTRAN por departamento')).toBeVisible();
  await expect(page.getByText('Siniestros SUTRAN por modalidad')).toBeVisible();
});

test('el botón Actualizar vuelve a pedir los KPIs al servidor', async ({ page }) => {
  let callCount = 0;
  await page.route(KPIS_PATH, (route) => {
    callCount += 1;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_KPIS_RESPONSE) });
  });

  await page.getByRole('button', { name: 'DASHBOARD', exact: true }).click();
  await expect(page.getByText('Total de Reportes')).toBeVisible();
  // React.StrictMode duplica el efecto de carga inicial en desarrollo, así
  // que no se asume un conteo exacto (1), solo que "Actualizar" suma una
  // llamada más sobre lo que ya se hubiera acumulado al montar.
  const callsAlMontar = callCount;

  await page.getByRole('button', { name: 'Actualizar' }).click();

  await expect.poll(() => callCount).toBe(callsAlMontar + 1);
});

test('la congestión promedio muestra "—" cuando el backend no la envía', async ({ page }) => {
  const responseSinCongestion = {
    ...SAMPLE_KPIS_RESPONSE,
    kpis: { ...SAMPLE_KPIS_RESPONSE.kpis, congestion_promedio: null },
  };
  await page.route(KPIS_PATH, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseSinCongestion) })
  );

  await page.getByRole('button', { name: 'DASHBOARD', exact: true }).click();

  await expect(page.getByText('Congestión Promedio')).toBeVisible();
  await expect(page.getByText('—')).toBeVisible();
});
