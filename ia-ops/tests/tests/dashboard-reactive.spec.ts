import { test, expect } from '@playwright/test';

// HU-04 · T04 — Dashboard reactivo del operador (grid de tickets).
//
// Verifica que el operador puede cambiar el estado de un ticket desde la
// grilla y ver el cambio reflejado al instante, sin recargar la página.
// El grid vive en src/frontend/src/OperatorTicketGrid.jsx, montado como
// pestaña "TICKETS" (visible solo para role 'operador') desde App.jsx —la
// app real es un tab-switcher sin react-router, así que se navega
// clickeando la pestaña en vez de un page.goto a una ruta.

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const ESTADO_ACTUALIZADO = 'En Proceso';
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
  await page.route(REPORTS_LIST_PATH, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([TICKET_INICIAL]) })
  );

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
});

test('el operador cambia el estado de un ticket y lo ve reflejado sin recargar', async ({ page }) => {
  await page.route(REPORT_RESOLVE_PATH, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: TICKET_ID, status: 'en_proceso', resolved_at: null }),
    })
  );

  await page.getByRole('button', { name: 'TICKETS', exact: true }).click();

  const fila = page.getByTestId(`row-${TICKET_ID}`);
  await expect(fila).toBeVisible();

  // El badge de estado actual (no el <select>): el <select> nativo siempre
  // trae las tres opciones como texto en el DOM sin importar cuál está
  // seleccionada, así que afirmar sobre toda la fila daría un falso positivo
  // incluso si la reactividad estuviera rota.
  const badgeEstado = page.getByTestId(`estado-actual-${TICKET_ID}`);
  await expect(badgeEstado).toHaveText('Pendiente');

  // Selector nativo <select>: no hay listbox custom en esta app.
  await page.getByTestId(`estado-selector-${TICKET_ID}`).selectOption({ label: ESTADO_ACTUALIZADO });

  // Aserción reactiva: la clave es que NO se llama page.reload() en ningún
  // momento. Si el estado local del grid no se actualiza tras la respuesta,
  // este timeout corto es el que hace fallar el test.
  await expect(badgeEstado).toHaveText(ESTADO_ACTUALIZADO, { timeout: 500 });
});
