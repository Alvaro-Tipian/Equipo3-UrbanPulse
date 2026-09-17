import { test, expect } from '@playwright/test';

// Pruebas de UI y validación de formularios (guía QA, Fase 4, prueba #7)
// para la autenticación del ciudadano.
//
// IMPORTANTE — cambio de arquitectura: el login dejó de ser una pantalla que
// bloqueaba toda la aplicación (src/frontend/src/LoginView.jsx, hoy sin uso en
// App.jsx). Ahora la app abre directamente y la autenticación vive dentro del
// microfrontend del chat (mf-chatbot/src/ChatAuthGate.jsx), que además cambió
// de "Usuario" a "Correo electrónico" y sumó registro y recuperación de
// contraseña.
//
// Los cuatro endpoints de autenticación se interceptan con page.route() para
// no depender de cuentas reales ni golpear producción desde CI.

const AUTH_LOGIN_PATH = '**/webhook/urbanpulse/auth/login';
const AUTH_REGISTER_PATH = '**/webhook/urbanpulse/auth/register';
const AUTH_FORGOT_PATH = '**/webhook/urbanpulse/auth/forgot';

const SESION_VALIDA = {
  success: true,
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ciudadano@ejemplo.com',
  role: 'ciudadano',
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

test.beforeEach(async ({ page }) => {
  // Este entorno de pruebas no tiene salida a redes externas reales; se corta
  // todo lo que no sea localhost para que ninguna petición quede colgada.
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  // La autenticación vive dentro de la pestaña CHAT, no en una pantalla previa.
  await page.getByRole('button', { name: 'CHAT', exact: true }).click();
});

test('el formulario rechaza un correo con formato inválido', async ({ page }) => {
  let webhookLlamado = false;
  await page.route(AUTH_LOGIN_PATH, (route) => {
    webhookLlamado = true;
    route.abort();
  });

  // 'usuario@dominio' pasa la validación nativa del navegador (type="email")
  // pero no la de la app, que exige un dominio de primer nivel con al menos
  // dos letras. Un valor como 'esto-no-es-un-correo' nunca llegaría a la
  // validación de la app: el navegador bloquea el envío antes.
  await page.getByPlaceholder('Correo electrónico').fill('usuario@dominio');
  await page.getByPlaceholder('Contraseña', { exact: true }).fill('claveValida123');
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByText('Ingresa un correo electrónico válido.')).toBeVisible();
  // La validación es local: no debe gastarse una llamada al servidor.
  expect(webhookLlamado).toBe(false);
});

test('el formulario exige una contraseña de al menos 8 caracteres', async ({ page }) => {
  let webhookLlamado = false;
  await page.route(AUTH_LOGIN_PATH, (route) => {
    webhookLlamado = true;
    route.abort();
  });

  await page.getByPlaceholder('Correo electrónico').fill('ciudadano@ejemplo.com');
  await page.getByPlaceholder('Contraseña', { exact: true }).fill('corta');
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByText('La contraseña debe tener al menos 8 caracteres.')).toBeVisible();
  expect(webhookLlamado).toBe(false);
});

test('el registro detecta que las contraseñas no coinciden', async ({ page }) => {
  await page.getByRole('button', { name: 'Registrarse' }).click();

  await page.getByPlaceholder('Correo electrónico').fill('nuevo@ejemplo.com');
  await page.getByPlaceholder('Contraseña (mínimo 8 caracteres)').fill('claveValida123');
  await page.getByPlaceholder('Repite la contraseña').fill('otraClaveDistinta');
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByText('Las contraseñas no coinciden.')).toBeVisible();
});

test('credenciales inválidas muestran el mensaje de error del servidor', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Correo o contraseña incorrectos.' }),
    });
  });

  await page.getByPlaceholder('Correo electrónico').fill('ciudadano@ejemplo.com');
  await page.getByPlaceholder('Contraseña', { exact: true }).fill('claveIncorrecta');
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByText('Correo o contraseña incorrectos.')).toBeVisible();
  // Debe seguir en el formulario, no haber entrado al chat.
  await expect(page.getByPlaceholder('Correo electrónico')).toBeVisible();
});

test('el botón muestra estado de carga mientras se valida el login', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESION_VALIDA) });
  });

  await page.getByPlaceholder('Correo electrónico').fill('ciudadano@ejemplo.com');
  await page.getByPlaceholder('Contraseña', { exact: true }).fill('claveValida123');
  const submitButton = page.locator('form button[type="submit"]');
  await submitButton.click();

  await expect(submitButton).toBeDisabled();
  await expect(page.getByPlaceholder('Correo electrónico')).toBeDisabled();
  await expect(page.getByPlaceholder('Contraseña', { exact: true })).toBeDisabled();
});

test('credenciales válidas dan acceso al chat', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESION_VALIDA) });
  });

  await page.getByPlaceholder('Correo electrónico').fill('ciudadano@ejemplo.com');
  await page.getByPlaceholder('Contraseña', { exact: true }).fill('claveValida123');
  await page.locator('form button[type="submit"]').click();

  // El formulario desaparece y queda disponible el chat de reportes.
  await expect(page.getByPlaceholder('Reporta un incidente....')).toBeVisible();
  await expect(page.getByPlaceholder('Correo electrónico')).toHaveCount(0);
});

test('tras iniciar sesión, el panel lateral muestra el correo y el rol de la cuenta', async ({ page }) => {
  const sesionOperador = {
    success: true,
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    email: 'operador1@example.com',
    role: 'Supervisor',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  await page.route(AUTH_LOGIN_PATH, (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sesionOperador) });
  });

  await page.getByPlaceholder('Correo electrónico').fill('operador1@example.com');
  await page.getByPlaceholder('Contraseña', { exact: true }).fill('claveValida123');
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByPlaceholder('Reporta un incidente....')).toBeVisible();
  await expect(page.locator('aside').getByText('operador1@example.com')).toBeVisible();
  await expect(page.locator('aside').getByText('Supervisor')).toBeVisible();
});

test('el registro exitoso también da acceso al chat', async ({ page }) => {
  await page.route(AUTH_REGISTER_PATH, (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESION_VALIDA) });
  });

  await page.getByRole('button', { name: 'Registrarse' }).click();
  await page.getByPlaceholder('Correo electrónico').fill('nuevo@ejemplo.com');
  await page.getByPlaceholder('Contraseña (mínimo 8 caracteres)').fill('claveValida123');
  await page.getByPlaceholder('Repite la contraseña').fill('claveValida123');
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByPlaceholder('Reporta un incidente....')).toBeVisible();
});

test('la recuperación de contraseña devuelve el enlace de reseteo', async ({ page }) => {
  await page.route(AUTH_FORGOT_PATH, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, reset_url: 'http://localhost:3000/?reset_token=token-de-prueba' }),
    });
  });

  await page.getByRole('button', { name: 'Olvidé mi contraseña' }).click();
  await expect(page.getByText('Recuperar contraseña')).toBeVisible();

  await page.getByPlaceholder('Correo electrónico').fill('ciudadano@ejemplo.com');
  await page.locator('form button[type="submit"]').click();

  // Todavía no hay envío de correo configurado: el enlace se muestra en pantalla.
  await expect(page.getByText('reset_token=token-de-prueba')).toBeVisible();
});

test('un error de conexión al iniciar sesión no deja el formulario colgado', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => route.abort('failed'));

  await page.getByPlaceholder('Correo electrónico').fill('ciudadano@ejemplo.com');
  await page.getByPlaceholder('Contraseña', { exact: true }).fill('claveValida123');
  const botonEnviar = page.locator('form button[type="submit"]');
  await botonEnviar.click();

  // Se muestra un error y el botón vuelve a quedar disponible para reintentar.
  await expect(
    page.getByText(/Failed to fetch|servidor de autenticación/)
  ).toBeVisible();
  await expect(botonEnviar).toBeEnabled();
});

test('cerrar sesión vuelve a mostrar el login', async ({ page }) => {
  await page.route(AUTH_LOGIN_PATH, (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESION_VALIDA) });
  });

  await page.getByPlaceholder('Correo electrónico').fill('ciudadano@ejemplo.com');
  await page.getByPlaceholder('Contraseña', { exact: true }).fill('claveValida123');
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByPlaceholder('Reporta un incidente....')).toBeVisible();

  await page.locator('aside').getByTitle('Cerrar sesión').click();

  await expect(page.getByPlaceholder('Correo electrónico')).toBeVisible();
  await expect(page.getByPlaceholder('Contraseña', { exact: true })).toBeVisible();
});
