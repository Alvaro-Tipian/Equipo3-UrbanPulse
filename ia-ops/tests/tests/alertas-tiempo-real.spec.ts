import { test, expect } from '@playwright/test';

// HT-34 — Pruebas automatizadas de alertas y de caída de la conexión en vivo.
//
// Dos bloques, uno por criterio de aceptación:
//
//   CA1  Se generan alertas de prueba CON UBICACIÓN y se verifica que llegan
//        correctamente: desde el chat del ciudadano hasta la bandeja del
//        operador, comprobando que las coordenadas viajan intactas.
//
//   CA2  Se simula la caída de la conexión en vivo y se confirma que el
//        navegador se recupera SIN PERDER INFORMACIÓN.
//
// Nota importante sobre "sockets": la plataforma NO usa WebSockets ni
// Server-Sent Events. La sincronización en vivo del panel del operador es
// React Query con actualización optimista y rollback
// (mf-gestion-incidentes/src/hooks/useReportes.js). Por eso la caída de la
// conexión se simula cortando esas peticiones HTTP, que es el canal real: una
// prueba de reconexión de sockets no verificaría nada que exista hoy. Si en el
// futuro se adopta un transporte persistente, este archivo es el sitio donde
// añadir su prueba de reconexión.

const ALERTA = {
  id: '22222222-2222-4222-8222-222222222222',
  description: 'Poste de alumbrado caído sobre la calzada',
  incident_type: 'alumbrado_publico',
  severity: 'alta',
  priority: 1,
  status: 'pending',
  reportado_por: 'ciudadano@ejemplo.com',
  created_at: new Date().toISOString(),
  resolved_at: null,
};

const UBICACION = { latitude: -12.0931, longitude: -77.0465 };

const RUTA_LISTADO = '**/webhook/urbanpulse/reports-list*';
const RUTA_RESOLVER = '**/webhook/urbanpulse/report-resolve*';

const SESION_OPERADOR = {
  id: 'operador-ht34',
  username: 'operador-ht34',
  role: 'operador',
};

const SESION_CIUDADANO = {
  success: true,
  id: '33333333-3333-4333-8333-333333333333',
  email: 'ciudadano-ht34@ejemplo.com',
  role: 'ciudadano',
};

function inyectarSesion(page, sesion: Record<string, unknown>) {
  return page.addInitScript((datos) => {
    window.localStorage.setItem(
      'urbanpulse_citizen_session',
      JSON.stringify({ ...datos, expires_at: new Date(Date.now() + 3600_000).toISOString() })
    );
  }, sesion);
}

// El entorno de pruebas no tiene salida a redes externas (tiles de TomTom,
// Gemini): sin este bloqueo esas peticiones se quedan colgando y congelan la
// página. Mismo criterio que urbanpulse-report.spec.ts.
async function bloquearRedExterna(page) {
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );
}

// ---------------------------------------------------------------------------
// CA1 — La alerta se genera con ubicación y llega a su destino
// ---------------------------------------------------------------------------

test.describe('CA1 · alertas con ubicación', () => {
  test.use({ permissions: ['geolocation'], geolocation: UBICACION });

  test('la alerta del ciudadano viaja con la ubicación del navegador', async ({ page }) => {
    await bloquearRedExterna(page);
    await inyectarSesion(page, SESION_CIUDADANO);

    // Se captura el cuerpo saliente en vez de afirmar sobre la UI: la
    // ubicación es justamente el dato que la pantalla NO muestra, y es el que
    // decide a qué zona se despacha la cuadrilla.
    let enviado: Record<string, unknown> | null = null;

    await page.route(
      (url) =>
        url.pathname === '/webhook/urbanpulse/chat' ||
        url.pathname === '/webhook/urbanpulse/report',
      (route) => {
        enviado = route.request().postDataJSON();
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            respuesta: 'Gracias, hemos registrado tu reporte.',
            estado: 'completado',
            tipo_incidente: 'alumbrado_publico',
            prioridad: 1,
          }),
        });
      }
    );

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'CHAT', exact: true }).click();

    await page.getByPlaceholder('Reporta un incidente....').fill(ALERTA.description);
    await page.locator('form button[type="submit"]').click();

    await expect(page.getByText('Gracias, hemos registrado tu reporte.')).toBeVisible();

    expect(enviado, 'el chat no llegó a enviar la alerta').not.toBeNull();
    expect(enviado!.latitude).toBeCloseTo(UBICACION.latitude, 4);
    expect(enviado!.longitude).toBeCloseTo(UBICACION.longitude, 4);
  });

  test('la alerta llega a la bandeja del operador con sus datos intactos', async ({ page }) => {
    await bloquearRedExterna(page);
    await inyectarSesion(page, SESION_OPERADOR);

    await page.route(RUTA_LISTADO, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([ALERTA]),
      })
    );

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'GESTIÓN DE INCIDENTES', exact: true }).click();

    const fila = page.getByRole('row').filter({ hasText: ALERTA.description });
    await expect(fila).toBeVisible();
    await expect(fila.getByText('Pendiente', { exact: true })).toBeVisible();
    await expect(fila.getByText(ALERTA.severity, { exact: true })).toBeVisible();
  });
});

test.describe('CA1 · alertas sin permiso de ubicación', () => {
  test.use({ permissions: [] });

  test('sin permiso de geolocalización la alerta llega igualmente con coordenadas', async ({
    page,
  }) => {
    // Una alerta sin coordenadas no se puede despachar. El chat tiene
    // coordenadas de respaldo de Lima justamente para que denegar el permiso
    // no deje al operador con un aviso que no sabe dónde atender.
    await bloquearRedExterna(page);
    await inyectarSesion(page, SESION_CIUDADANO);

    let enviado: Record<string, unknown> | null = null;

    await page.route(
      (url) =>
        url.pathname === '/webhook/urbanpulse/chat' ||
        url.pathname === '/webhook/urbanpulse/report',
      (route) => {
        enviado = route.request().postDataJSON();
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            respuesta: 'Gracias, hemos registrado tu reporte.',
            estado: 'completado',
            tipo_incidente: 'alumbrado_publico',
            prioridad: 1,
          }),
        });
      }
    );

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'CHAT', exact: true }).click();

    await page.getByPlaceholder('Reporta un incidente....').fill(ALERTA.description);
    await page.locator('form button[type="submit"]').click();

    await expect(page.getByText('Gracias, hemos registrado tu reporte.')).toBeVisible();

    expect(enviado, 'el chat no llegó a enviar la alerta').not.toBeNull();
    expect(typeof enviado!.latitude).toBe('number');
    expect(typeof enviado!.longitude).toBe('number');
    // Dentro del bounding box de Lima Metropolitana: un 0,0 o un null pasarían
    // una comprobación de "existe" y aun así serían inservibles.
    expect(enviado!.latitude as number).toBeGreaterThan(-12.6);
    expect(enviado!.latitude as number).toBeLessThan(-11.6);
    expect(enviado!.longitude as number).toBeGreaterThan(-77.3);
    expect(enviado!.longitude as number).toBeLessThan(-76.6);
  });
});

// ---------------------------------------------------------------------------
// CA2 — Caída de la conexión en vivo y recuperación sin pérdida
// ---------------------------------------------------------------------------

test.describe('CA2 · caída y recuperación de la conexión', () => {
  // Estado del backend simulado. Tiene que ser mutable porque
  // useActualizarReporte invalida la consulta al terminar (onSettled) y vuelve
  // a pedir el listado: con un mock fijo en 'pending', ese refresco pisaría el
  // cambio recién guardado y la prueba fallaría por culpa del doble, no de la
  // app.
  let estadoEnServidor: string;

  test.beforeEach(async ({ page }) => {
    estadoEnServidor = 'pending';

    await bloquearRedExterna(page);
    await inyectarSesion(page, SESION_OPERADOR);

    await page.route(RUTA_LISTADO, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ ...ALERTA, status: estadoEnServidor }]),
      })
    );

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'GESTIÓN DE INCIDENTES', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: ALERTA.description })).toBeVisible();
  });

  test('si la conexión cae al cambiar el estado, no se pierde la alerta y el cambio se revierte', async ({
    page,
  }) => {
    // useActualizarReporte aplica el cambio de forma optimista antes de que
    // responda el servidor. Si la petición muere, onError tiene que devolver la
    // grilla a su estado anterior: lo que no puede pasar es que la fila
    // desaparezca o quede marcada como atendida sin que el backend lo sepa,
    // porque entonces nadie acude al incidente.
    let intentos = 0;
    await page.route(RUTA_RESOLVER, (route) => {
      intentos += 1;
      route.abort('failed');
    });

    const fila = page.getByRole('row').filter({ hasText: ALERTA.description });
    await fila.getByRole('button', { name: 'Revisar' }).click();

    // Sin esto la prueba pasaría en vacío si el botón dejara de llamar al
    // backend: la fila seguiría en Pendiente y nadie se enteraría.
    await expect.poll(() => intentos).toBeGreaterThan(0);

    // La alerta sigue ahí y vuelve a Pendiente.
    await expect(fila).toBeVisible();
    await expect(fila.getByText('Pendiente', { exact: true })).toBeVisible();
    await expect(fila.getByText('En proceso', { exact: true })).toHaveCount(0);
  });

  test('al restablecerse la conexión, el cambio vuelve a aplicarse', async ({ page }) => {
    let primerIntento = true;
    await page.route(RUTA_RESOLVER, (route) => {
      if (primerIntento) {
        primerIntento = false;
        return route.abort('failed');
      }
      // El segundo intento sí persiste: el listado pasa a devolver el estado
      // nuevo, igual que haría n8n contra la base de datos.
      estadoEnServidor = 'en_proceso';
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: ALERTA.id, status: 'en_proceso', resolved_at: null }),
      });
    });

    const fila = page.getByRole('row').filter({ hasText: ALERTA.description });

    await fila.getByRole('button', { name: 'Revisar' }).click();
    await expect(fila.getByText('Pendiente', { exact: true })).toBeVisible();

    // Segundo intento con la conexión ya restablecida: el operador no tiene
    // que recargar la página ni volver a entrar a la pestaña.
    await fila.getByRole('button', { name: 'Revisar' }).click();
    await expect(fila.getByText('En proceso', { exact: true })).toBeVisible();
  });

  test('si el refresco periódico falla, la bandeja conserva lo que ya mostraba', async ({
    page,
  }) => {
    // El peor fallo posible de una bandeja de alertas es quedarse en blanco
    // cuando se cae la red: el operador perderia de vista incidentes activos
    // que no ha atendido. React Query debe conservar los datos previos.
    const fila = page.getByRole('row').filter({ hasText: ALERTA.description });
    await expect(fila).toBeVisible();

    let refrescosCaidos = 0;
    await page.unroute(RUTA_LISTADO);
    await page.route(RUTA_LISTADO, (route) => {
      refrescosCaidos += 1;
      route.abort('failed');
    });

    await page.getByRole('button', { name: 'Actualizar' }).click();

    // Confirma que el refresco se intentó de verdad y murió: sin esta
    // comprobación, un botón "Actualizar" que no pidiera nada dejaría la fila
    // en pantalla y la prueba pasaría sin haber simulado caída alguna.
    await expect.poll(() => refrescosCaidos).toBeGreaterThan(0);

    await expect(fila).toBeVisible();
    await expect(page.getByText('No hay incidentes')).toHaveCount(0);
  });
});
