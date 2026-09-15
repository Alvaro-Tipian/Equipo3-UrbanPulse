import { test, expect } from '@playwright/test';

// HU-04 · T04 — Dashboard reactivo del operador (grid de tickets).
//
// PENDIENTE DE IMPLEMENTACIÓN — a la fecha de este spec no existe en el
// código un grid de tickets para el operador con selector de estado (esa es
// la parte de HU-04 que construyen T01-T03; este ticket es solo el E2E).
// La ruta '/dashboard' ya está protegida para el rol 'operador' en
// ProtectedRoute.jsx (ver src/frontend/src/__tests__/routeGuards.test.jsx),
// pero App.jsx todavía no monta react-router ni ningún componente ahí.
//
// Este spec documenta, en rojo, el contrato de UI/API que se espera de esa
// vista — mismo patrón que dashboard.spec.ts usa para el defecto D-14 —, y
// pasará a verde en cuanto el componente real exponga:
//   - una fila por ticket:    [data-testid="row-{ticketId}"]
//   - un selector de estado:  [data-testid="estado-selector-{ticketId}"]
//   - una llamada al backend para persistir el cambio de estado (aquí se
//     intercepta **/api/reportes/{ticketId} tal como pide el ticket; si la
//     implementación real termina usando un webhook de n8n, como el resto
//     de la app, cambiar este path por **/webhook/urbanpulse/... )
//   - invalidación de caché (p.ej. React Query) que actualice la fila SIN
//     recargar la página: por eso el test nunca llama page.reload().

const TICKET_ID = 'T-1001';
const ESTADO_ACTUALIZADO = 'En Proceso';
const TICKET_ENDPOINT = `**/api/reportes/${TICKET_ID}`;

test.beforeEach(async ({ page }) => {
  // Fixture de login como operador: se inyecta la sesión en localStorage
  // (misma clave que usa src/frontend/src/session.js) para no pasar por la
  // pantalla de login en cada test. El ticket pide inyectar un JWT, pero hoy
  // la app no emite JWT: la sesión es un objeto plano. Se agrega un campo
  // `token` para no romper el contrato cuando se sume auth por JWT.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'urbanpulse_citizen_session',
      JSON.stringify({
        id: 'operador-e2e-01',
        username: 'operador-e2e',
        role: 'operador',
        token: 'fake-jwt-for-e2e-tests',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
    );
  });
});

test('el operador cambia el estado de un ticket y lo ve reflejado sin recargar', async ({ page }) => {
  test.fail(); // HU-04: el grid reactivo del operador aún no está implementado.

  await page.route(TICKET_ENDPOINT, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: TICKET_ID, estado: ESTADO_ACTUALIZADO }),
    })
  );

  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' });

  const fila = page.getByTestId(`row-${TICKET_ID}`);
  await expect(fila).toBeVisible();

  // Si el selector real termina siendo un <select> nativo en vez de un
  // listbox/dropdown custom, reemplazar estas dos líneas por:
  //   await page.getByTestId(`estado-selector-${TICKET_ID}`).selectOption({ label: ESTADO_ACTUALIZADO });
  await page.getByTestId(`estado-selector-${TICKET_ID}`).click();
  await page.getByRole('option', { name: ESTADO_ACTUALIZADO }).click();

  // Aserción reactiva: la clave es que NO se llama page.reload() en ningún
  // momento. Si la invalidación de caché (p.ej. React Query) no funciona,
  // este timeout corto es el que hace fallar el test.
  await expect(fila).toHaveText(new RegExp(ESTADO_ACTUALIZADO), { timeout: 500 });
});
