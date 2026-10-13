import { test, expect } from '@playwright/test';

// HU-04 · T04 — Dashboard reactivo del operador (grid de tickets).
//
// Verifica que el operador puede cambiar el estado de un ticket desde la
// grilla y ver el cambio reflejado al instante, sin recargar la página.
//
// Tras el refactor de microfrontends (HT-39) el grid ya no es
// src/frontend/src/OperatorTicketGrid.jsx: vive en el microfrontend
// mf-gestion-incidentes (src/GestorIncidentes.jsx) y se monta en la pestaña
// "GESTIÓN DE INCIDENTES", visible solo para role 'operador'. La app sigue
// siendo un tab-switcher sin react-router, así que se navega clickeando la
// pestaña en vez de un page.goto a una ruta.

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
// Capitalización exacta con la que useReportes.js traduce el estado de la BD
// ('en_proceso' -> 'En proceso'); un 'En Proceso' no casaría con getByText.
const ESTADO_ACTUALIZADO = 'En proceso';
const REPORTS_LIST_PATH = '**/webhook/urbanpulse/reports-list';
const REPORT_RESOLVE_PATH = '**/webhook/urbanpulse/report-resolve';

const TICKET_INICIAL = {
  id: TICKET_ID,
  description: 'Bache en la vía principal',
  incident_type: 'infraestructura_vial',
  severity: 'alta',
  priority: 1,
  status: 'pending',
  reportado_por: 'ciudadano@ejemplo.com',
  created_at: new Date().toISOString(),
  resolved_at: null,
};

// Estado del backend simulado, compartido entre el listado y la mutación.
let estadoEnServidor: string;

test.beforeEach(async ({ page }) => {
  // Fixture de login como operador: se inyecta la sesión directamente en
  // localStorage (misma clave que usa src/frontend/src/session.js) para
  // evitar pasar por la pantalla de login en cada test.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'urbanpulse_citizen_session',
      JSON.stringify({
        id: 'operador-e2e-01',
        username: 'operador-e2e',
        role: 'operador',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
    );
  });

  // Se desacopla del backend real: la lista de tickets y la actualización de
  // estado se interceptan para que el test sea determinista.
  //
  // El estado es mutable porque useActualizarReporte invalida la consulta al
  // terminar (onSettled) y vuelve a pedir el listado. Con un mock fijo en
  // 'pending', ese refresco pisa el cambio recién guardado y el test falla de
  // forma intermitente —según gane la carrera la aserción o el refetch— por
  // culpa del doble, no de la aplicación.
  estadoEnServidor = 'pending';
  await page.route(REPORTS_LIST_PATH, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ ...TICKET_INICIAL, status: estadoEnServidor }]),
    })
  );

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
});

test('el operador cambia el estado de un ticket y lo ve reflejado sin recargar', async ({ page }) => {
  await page.route(REPORT_RESOLVE_PATH, (route) => {
    estadoEnServidor = 'en_proceso';
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: TICKET_ID, status: 'en_proceso', resolved_at: null }),
    });
  });

  await page.getByRole('button', { name: 'GESTIÓN DE INCIDENTES', exact: true }).click();

  const fila = page.getByRole('row').filter({ hasText: TICKET_INICIAL.description });
  await expect(fila).toBeVisible();
  await expect(fila.getByText('Pendiente', { exact: true })).toBeVisible();

  // "Revisar" es el botón que mueve el ticket a 'en_proceso'. Se acota a la
  // fila para no depender del orden de la tabla.
  await fila.getByRole('button', { name: 'Revisar' }).click();

  // Aserción reactiva: la clave es que NO se llama page.reload() en ningún
  // momento. El grid lo refleja primero con la actualización optimista de
  // React Query (onMutate) y lo confirma con el refetch de onSettled; basta
  // con que el operador lo vea sin recargar.
  await expect(fila.getByText(ESTADO_ACTUALIZADO, { exact: true })).toBeVisible();
});
