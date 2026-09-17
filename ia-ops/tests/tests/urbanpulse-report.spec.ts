import { test, expect } from '@playwright/test';

// Pruebas E2E del flujo de reporte de incidentes por chat (guía QA, Fase 4,
// prueba #8) para src/frontend + el microfrontend mf-chatbot.
//
// El chat exige que el ciudadano haya iniciado sesión (ChatAuthGate). Para
// que estas pruebas sean deterministas, ese paso se "salta" precargando una
// sesión válida en localStorage en lugar de completar el formulario contra el
// backend real. La autenticación en sí se cubre en login.spec.ts.
//
// El webhook de reporte del chat (TE_N8N_WEBHOOK_URL) también se
// intercepta con page.route() para no depender de que n8n/Gemini estén
// disponibles.

const CHAT_WEBHOOK_PATH = (url: URL) =>
  url.pathname === '/webhook/urbanpulse/chat' ||
  url.pathname === '/webhook/urbanpulse/report';

// El chat pide la ubicación real del dispositivo antes de enviar el mensaje
// (obtenerUbicacionActual en NLQCommandCenter.jsx). Sin permiso concedido, esa
// llamada espera hasta agotar su tiempo de espera y el turno del bot tarda más
// de lo que aguantan las aserciones. Se concede el permiso y se fija una
// posición conocida para que el flujo avance de inmediato.
test.use({
  permissions: ['geolocation'],
  geolocation: { latitude: -12.0464, longitude: -77.0428 },
});

test.beforeEach(async ({ page }) => {
  // Este entorno de pruebas no tiene salida a redes externas reales (p. ej.
  // los tiles de TomTom para el mapa). Sin este bloqueo, esas peticiones se
  // quedan colgadas intentando conectar y terminan congelando la página.
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );

  // La sesión del ciudadano se comparte entre el host y los micro-frontends bajo
  // la clave 'urbanpulse_citizen_session' (ver mf-chatbot/src/session.js). El chat
  // exige 'id' porque lo usa como usuario_id al guardar el reporte y su historial.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'urbanpulse_citizen_session',
      JSON.stringify({
        success: true,
        id: '11111111-1111-4111-8111-111111111111',
        email: 'qa-tester@ejemplo.com',
        role: 'ciudadano',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
    );
  });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'CHAT', exact: true }).click();
});

test('con sesión válida se entra directo al chat, sin formulario de login', async ({ page }) => {
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
