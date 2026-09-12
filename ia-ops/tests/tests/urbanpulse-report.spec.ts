import { test, expect } from '@playwright/test';

// Pruebas E2E del flujo de reporte de incidentes por chat (guía QA, Fase 4,
// prueba #8) para src/frontend + el microfrontend mf-chatbot.
//
// La app ahora exige login de operadores antes de mostrar cualquier
// pestaña (ver src/frontend/src/App.jsx y LoginView.jsx). Ese login pega
// contra un webhook real de n8n con cuentas reales en Postgres, así que
// para que estas pruebas sean deterministas se "salta" precargando una
// sesión válida en localStorage (mismo formato que guarda session.js) en
// lugar de completar el formulario de login contra el backend real.
//
// El webhook de reporte del chat (TE_N8N_WEBHOOK_URL) también se
// intercepta con page.route() para no depender de que n8n/Gemini estén
// disponibles.

const CHAT_WEBHOOK_PATH = (url: URL) =>
  url.pathname === '/webhook/urbanpulse/chat' ||
  url.pathname === '/webhook/urbanpulse/report';

test.beforeEach(async ({ page }) => {
  // Este entorno de pruebas no tiene salida a redes externas reales (p. ej.
  // los tiles de TomTom para el mapa). Sin este bloqueo, esas peticiones se
  // quedan colgadas intentando conectar y terminan congelando la página.
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );

  // Precarga una sesión válida para saltar la pantalla de login (session.js
  // espera esta forma exacta bajo la clave "urbanpulse_citizen_session").
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
  await page.getByRole('button', { name: 'CHAT', exact: true }).click();
});

test('el operador entra directo a la app sin ver el login (sesión válida)', async ({ page }) => {
  await expect(page.getByPlaceholder('Reporta un incidente....')).toBeVisible();
  await expect(page.getByPlaceholder('Correo electrónico')).toHaveCount(0);
});

test('el ciudadano reporta un incidente por chat y ve el ticket confirmado', async ({ page }) => {
  await page.route(CHAT_WEBHOOK_PATH, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        respuesta: 'Gracias, hemos registrado tu reporte.',
        estado: 'completado',
        tipo_incidente: 'bache',
        prioridad: 1,
        score_riesgo: 0.87,
      }),
    });
  });

  const input = page.getByPlaceholder('Reporta un incidente....');
  await input.fill('Hay un bache enorme en la avenida principal');
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByText('Gracias, hemos registrado tu reporte.')).toBeVisible();
  await expect(page.getByText('Ticket #')).toBeVisible();
  // "Tipo:" y el valor van en el mismo párrafo del ticket, así se evita
  // colisionar con la palabra "bache" repetida en el mensaje del usuario.
  await expect(page.getByText(/Tipo:\s*bache/)).toBeVisible();
  await expect(page.getByText(/Prioridad 1/)).toBeVisible();
});

test('el chat sigue preguntando cuando el reporte aún no está completo', async ({ page }) => {
  await page.route(CHAT_WEBHOOK_PATH, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        respuesta: '¿Podrías indicarme la ubicación exacta del incidente?',
        estado: 'en_progreso',
      }),
    });
  });

  await page.getByPlaceholder('Reporta un incidente....').fill('Hay un problema en la calle');
  await page.keyboard.press('Enter');

  await expect(page.getByText('¿Podrías indicarme la ubicación exacta del incidente?')).toBeVisible();
  await expect(page.getByText('Ticket #')).not.toBeVisible();
});

test('el chat informa un error si el servidor no responde', async ({ page }) => {
  await page.route(CHAT_WEBHOOK_PATH, (route) => route.abort('failed'));

  await page.getByPlaceholder('Reporta un incidente....').fill('Semáforo malogrado en la esquina');
  await page.keyboard.press('Enter');

  await expect(
    page.getByText('Lo siento, hubo un problema conectando con los servidores municipales. Intenta de nuevo en unos minutos.')
  ).toBeVisible();
});

// Bug UP-QA-01 (mencionado explícitamente en el código de
// NLQCommandCenter.jsx): el mensaje se sanitiza con trim() antes de
// enviarse. Este test confirma que un mensaje de solo espacios no dispara
// el envío.
test('el chat no envía mensajes que son solo espacios en blanco (UP-QA-01)', async ({ page }) => {
  let webhookCalled = false;
  await page.route(CHAT_WEBHOOK_PATH, (route) => {
    webhookCalled = true;
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  const input = page.getByPlaceholder('Reporta un incidente....');
  await input.fill('   ');

  const sendButton = page.locator('form button[type="submit"]');
  await expect(sendButton).toBeDisabled();
  expect(webhookCalled).toBe(false);
});