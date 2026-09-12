import { test, expect } from '@playwright/test';

// Pruebas de UI y validación de formularios (guía QA, Fase 4, prueba #7)
// para la compuerta de autenticación del chat (mf-chatbot/src/ChatAuthGate.jsx).
//
// ChatAuthGate pega contra el webhook de autenticación de n8n (fallback
// configurado en TE_N8N_AUTH_LOGIN_URL). Estas pruebas interceptan la
// petición con page.route() para validar de forma determinista todos los
// estados (validación de formulario, credenciales erróneas, carga, éxito y logout).

const AUTH_LOGIN_PATH = '**/webhook/urbanpulse/auth/login';

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  // Navega a la pestaña CHAT donde se monta ChatAuthGate si no hay sesión activa
  await page.getByRole('button', { name: 'CHAT', exact: true }).click();
});

test('valida formato de correo y longitud de contraseña antes de enviar', async ({ page }) => {
  const submitButton = page.locator('form button[type="submit"]');

  // Correo inválido (rechazado por validar(): sin dominio válido)
  await page.getByPlaceholder('Correo electrónico').fill('operador@invalido');
  await page.getByPlaceholder('Contraseña').fill('12345678');
  await submitButton.click();
  await expect(page.getByText('Ingresa un correo electrónico válido.')).toBeVisible();

  // Contraseña menor a 8 caracteres
  await page.getByPlaceholder('Correo electrónico').fill('operador1@example.com');
  await page.getByPlaceholder('Contraseña').fill('corta');
  await submitButton.click();
  await expect(page.getByText('La contraseña debe tener al menos 8 caracteres.')).toBeVisible();
});

test('credenciales inválidas muestran el mensaje de error del servidor', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => {
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Correo o contraseña incorrectos' }),
    });
  });

  await page.getByPlaceholder('Correo electrónico').fill('operador1@example.com');
  await page.getByPlaceholder('Contraseña').fill('claveIncorrecta123');
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByText('Correo o contraseña incorrectos')).toBeVisible();
  await expect(page.getByPlaceholder('Correo electrónico')).toBeVisible();
});

test('el botón muestra estado de carga mientras se valida el login', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        email: 'operador1@example.com',
        role: 'Operador',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
  });

  await page.getByPlaceholder('Correo electrónico').fill('operador1@example.com');
  await page.getByPlaceholder('Contraseña').fill('claveValida123');
  const submitButton = page.locator('form button[type="submit"]');
  await submitButton.click();

  await expect(submitButton).toBeDisabled();
  await expect(page.getByPlaceholder('Correo electrónico')).toBeDisabled();
  await expect(page.getByPlaceholder('Contraseña')).toBeDisabled();
});

test('credenciales válidas entran a la app y muestran usuario y rol en el sidebar', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        email: 'operador1@example.com',
        role: 'Supervisor',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
  });

  await page.getByPlaceholder('Correo electrónico').fill('operador1@example.com');
  await page.getByPlaceholder('Contraseña').fill('claveValida123');
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByPlaceholder('Correo electrónico')).toHaveCount(0);
  await expect(page.getByPlaceholder('Reporta un incidente....')).toBeVisible();
  await expect(page.locator('aside').getByText('operador1@example.com')).toBeVisible();
  await expect(page.locator('aside').getByText('Supervisor')).toBeVisible();
});

test('un error de conexión al iniciar sesión muestra un mensaje de error (no se cuelga en loading)', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => route.abort('failed'));

  await page.getByPlaceholder('Correo electrónico').fill('operador1@example.com');
  await page.getByPlaceholder('Contraseña').fill('claveValida123');
  const submitButton = page.locator('form button[type="submit"]');
  await submitButton.click();

  await expect(
    page.getByText(/No se pudo conectar con el servidor de autenticación|Failed to fetch/)
  ).toBeVisible();
  await expect(submitButton).toBeEnabled();
});

test('cerrar sesión vuelve a mostrar el login', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        email: 'operador1@example.com',
        role: 'Operador',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
  });

  await page.getByPlaceholder('Correo electrónico').fill('operador1@example.com');
  await page.getByPlaceholder('Contraseña').fill('claveValida123');
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByPlaceholder('Reporta un incidente....')).toBeVisible();

  await page.locator('aside').getByTitle('Cerrar sesión').click();

  await expect(page.getByPlaceholder('Correo electrónico')).toBeVisible();
  await expect(page.getByPlaceholder('Contraseña')).toBeVisible();
});