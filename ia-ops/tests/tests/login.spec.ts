import { test, expect } from '@playwright/test';

// Pruebas de UI y validación de formularios (guía QA, Fase 4, prueba #7)
// para el login de operadores (src/frontend/src/LoginView.jsx).
//
// LoginView pega, por defecto, contra el n8n de PRODUCCIÓN (URL hardcodeada
// como fallback si no existe TE_N8N_AUTH_LOGIN_URL) — no hay distinción
// automática local/producción como en otros webhooks del proyecto. Por eso
// estas pruebas interceptan la petición con page.route() en vez de usar
// credenciales reales, para no depender de una cuenta real ni pegarle a
// producción desde CI.

const AUTH_LOGIN_PATH = '**/webhook/urbanpulse/auth/login';

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
});

test('el botón de login está deshabilitado si falta usuario o contraseña', async ({ page }) => {
  const loginButton = page.getByRole('button', { name: 'Iniciar sesión' });
  await expect(loginButton).toBeDisabled();

  await page.getByPlaceholder('Usuario').fill('operador1');
  await expect(loginButton).toBeDisabled();

  await page.getByPlaceholder('Contraseña').fill('unaClave123');
  await expect(loginButton).toBeEnabled();
});

test('credenciales inválidas muestran el mensaje de error del servidor', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => {
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Usuario o contraseña incorrectos' }),
    });
  });

  await page.getByPlaceholder('Usuario').fill('operador1');
  await page.getByPlaceholder('Contraseña').fill('claveIncorrecta');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByText('Usuario o contraseña incorrectos')).toBeVisible();
  await expect(page.getByPlaceholder('Usuario')).toBeVisible();
});

test('el botón muestra estado de carga mientras se valida el login', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        username: 'operador1',
        role: 'Operador',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
  });

    await page.getByPlaceholder('Correo electrónico').fill('operador1@example.com');
  await page.getByPlaceholder('Contraseña').fill('claveValida123');
  // Se ubica por selector estructural, no por texto: el botón pierde el
  // texto "Iniciar sesión" y muestra solo un ícono de carga mientras espera.
  const loginButton = page.locator('form button[type="submit"]');
  await loginButton.click();

  await expect(loginButton).toBeDisabled();
  await expect(page.getByPlaceholder('Usuario')).toBeDisabled();
  await expect(page.getByPlaceholder('Contraseña')).toBeDisabled();
});

test('credenciales válidas entran a la app y muestran usuario y rol en el sidebar', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
          email: 'operador1@example.com',
        role: 'Supervisor',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
  });

    await page.getByPlaceholder('Correo electrónico').fill('operador1@example.com');
  await page.getByPlaceholder('Contraseña').fill('claveValida123');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

    await expect(page.getByPlaceholder('Correo electrónico')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'CHAT', exact: true })).toBeVisible();
    await expect(page.getByText('operador1@example.com')).toBeVisible();
  await expect(page.getByText('Supervisor')).toBeVisible();
});

// Defecto conocido: LoginView.jsx hace `err.message || 'No se pudo conectar
// con el servidor de autenticación.'`. Cuando fetch() falla por red, el
// navegador sí llena `err.message` (p. ej. "Failed to fetch"), así que ese
// mensaje de fallback "amigable" nunca llega a mostrarse en un error de
// conexión real — solo se vería en un caso donde err.message fuera vacío.
test('un error de conexión al iniciar sesión muestra un mensaje de error (no se cuelga en loading)', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => route.abort('failed'));

  await page.getByPlaceholder('Usuario').fill('operador1');
  await page.getByPlaceholder('Contraseña').fill('claveValida123');
  const loginButton = page.locator('form button[type="submit"]');
  await loginButton.click();

  await expect(page.getByText('Failed to fetch')).toBeVisible();
  await expect(loginButton).toBeEnabled();
});

test('cerrar sesión vuelve a mostrar el login', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
          email: 'operador1@example.com',
        role: 'Operador',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
  });

    await page.getByPlaceholder('Correo electrónico').fill('operador1@example.com');
  await page.getByPlaceholder('Contraseña').fill('claveValida123');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('button', { name: 'CHAT', exact: true })).toBeVisible();

  await page.getByTitle('Cerrar sesión').click();

  await expect(page.getByPlaceholder('Usuario')).toBeVisible();
  await expect(page.getByPlaceholder('Contraseña')).toBeVisible();
});