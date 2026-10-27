import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// HT-39 T04 — Prueba de contrato entre el host y sus microfrontends.
//
// Desde HT-39 el host ya no conoce a sus remotos en tiempo de build: lee un
// manifiesto (/remotes.<entorno>.json), registra cada remoteEntry.js y pide los
// módulos por nombre con cargarRemote('mf_x', './Modulo'). Ese acuerdo tiene
// tres partes, y cualquiera puede romperse sin que falle un build ni un lint,
// porque cada lado compila por separado:
//
//   1. el manifiesto declara una URL para cada remoto que el host consume;
//   2. esa URL responde con un remoteEntry.js;
//   3. el remoto expone el módulo con el nombre exacto que el host pide, y
//      comparte React como singleton, así que el módulo MONTA dentro del host.
//
// Los demás specs prueban qué hace cada vista. Este solo prueba que llega a
// existir: si alguien renombra un `exposes`, cambia un puerto o quita una
// entrada del manifiesto, falla aquí con el nombre del remoto en el título.

const HOST = 'http://localhost:3000';
const MANIFIESTO = `${HOST}/remotes.local.json`;
// Texto del RemoteBoundary del host; cambió de «Módulo no disponible» a
// «Este módulo no está disponible», así que se aceptan ambos.
const AVISO_REMOTO_CAIDO = /módulo no (está )?disponible/i;

type Rol = 'anonimo' | 'ciudadano' | 'operador';

type Contrato = {
  remoto: string;
  modulo: string;
  /** Sesión con la que el host muestra la ruta de este remoto. */
  rol: Rol;
  /** Ruta del host (React Router) que monta el remoto. */
  ruta: string;
  /** Algo que solo existe si el módulo montó; no depende de datos del backend. */
  montado: (page: Page) => ReturnType<Page['getByText']>;
};

const CONTRATO: Contrato[] = [
  {
    remoto: 'mf_auth',
    modulo: './LoginView',
    rol: 'anonimo',
    ruta: '/login',
    montado: (page) => page.getByPlaceholder('Correo electrónico'),
  },
  {
    remoto: 'mf_chatbot',
    modulo: './Chatbot',
    rol: 'ciudadano',
    ruta: '/chatbot',
    montado: (page) => page.getByRole('heading', { name: /Command Center/ }),
  },
  {
    remoto: 'mf_mapa_urbano',
    modulo: './MapaUrbano',
    rol: 'ciudadano',
    ruta: '/mapa',
    montado: (page) => page.getByText('Leyenda y Guía'),
  },
  {
    remoto: 'mf_dashboard',
    modulo: './Dashboard',
    rol: 'ciudadano',
    ruta: '/dashboard',
    montado: (page) => page.getByRole('heading', { name: 'Panel Analítico UrbanPulse' }),
  },
  {
    remoto: 'mf_historial_reportes',
    modulo: './HistorialView',
    rol: 'ciudadano',
    ruta: '/historial',
    montado: (page) => page.getByRole('heading', { name: 'Historial de Reportes' }),
  },
  {
    remoto: 'mf_ajustes',
    modulo: './AjustesView',
    rol: 'ciudadano',
    ruta: '/ajustes',
    montado: (page) => page.getByRole('heading', { name: 'Ajustes', exact: true }),
  },
  {
    remoto: 'mf_gestion_incidentes',
    modulo: './GestorIncidentes',
    rol: 'operador',
    ruta: '/incidentes',
    montado: (page) => page.getByRole('heading', { name: 'Gestión de Incidentes' }),
  },
  {
    remoto: 'mf_panel_riesgo',
    modulo: './PanelRiesgo',
    rol: 'operador',
    ruta: '/panel-predictivo',
    montado: (page) => page.getByRole('heading', { name: 'Panel de Riesgo Predictivo' }),
  },
];

/** Prepara la sesión indicada y corta la salida a servicios externos. */
async function prepararHost(page: Page, rol: Rol) {
  // Los remotos se sirven desde localhost; n8n, TomTom y demás no forman parte
  // del contrato y se cortan para que el resultado no dependa de la red.
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );

  if (rol !== 'anonimo') {
    await page.addInitScript((rolSesion) => {
      window.localStorage.setItem(
        'urbanpulse_citizen_session',
        JSON.stringify({
          success: true,
          id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          email: 'qa-contrato@example.com',
          username: 'qa-contrato',
          role: rolSesion,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        })
      );
    }, rol);
  }
}

test.describe('El manifiesto cubre lo que el host consume', () => {
  test('el contrato de esta prueba coincide con los cargarRemote() del host', () => {
    // Sin esto, un remoto nuevo añadido a App.jsx quedaría fuera del contrato
    // y la suite seguiría en verde sin probarlo.
    const appJsx = fs.readFileSync(
      path.resolve(__dirname, '../../../src/frontend/src/App.jsx'),
      'utf8'
    );
    const consumidos = [...appJsx.matchAll(/cargarRemote\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
      .map(([, remoto, modulo]) => `${remoto}/${modulo}`)
      .sort();

    expect(consumidos).toEqual(CONTRATO.map((c) => `${c.remoto}/${c.modulo}`).sort());
  });

  test('el host sirve el manifiesto con una entrada por cada remoto consumido', async ({ request }) => {
    const respuesta = await request.get(MANIFIESTO);
    expect(respuesta.status()).toBe(200);

    const manifiesto = await respuesta.json();
    for (const { remoto } of CONTRATO) {
      expect(manifiesto[remoto], `falta ${remoto} en el manifiesto`).toMatch(
        /^https?:\/\/.+\/remoteEntry\.js$/
      );
    }
  });
});

for (const contrato of CONTRATO) {
  test.describe(`${contrato.remoto} cumple el contrato`, () => {
    test('su remoteEntry.js responde en la URL del manifiesto', async ({ request }) => {
      const manifiesto = await (await request.get(MANIFIESTO)).json();

      const respuesta = await request.get(manifiesto[contrato.remoto]);
      expect(respuesta.status()).toBe(200);
      // Un servidor mal configurado devuelve el index.html de la SPA con 200
      // para cualquier ruta; el host intentaría importarlo como módulo.
      expect(respuesta.headers()['content-type']).toContain('javascript');
      expect((await respuesta.text()).length).toBeGreaterThan(0);
    });

    test(`expone ${contrato.modulo} y monta dentro del host`, async ({ page }) => {
      // Más que los 30 s por defecto: abajo se reintenta hasta 60 s, y en frío
      // la primera carga de cada remoto incluye compilarlo bajo demanda.
      test.setTimeout(90_000);
      await prepararHost(page, contrato.rol);

      // Se reintenta la navegación, no solo la aserción. En frío (siempre, en
      // CI) la primera carga de un remoto hace que Vite optimice sus
      // dependencias y recargue la página; esperar más no siempre la recupera.
      await expect(async () => {
        await page.goto(`${HOST}${contrato.ruta}`, { waitUntil: 'domcontentloaded' });
        await expect(contrato.montado(page)).toBeVisible({ timeout: 15_000 });
      }).toPass({ timeout: 60_000 });

      await expect(page.getByText(AVISO_REMOTO_CAIDO)).toHaveCount(0);
    });
  });
}

test('si un remoto no responde, el host lo aísla y los demás siguen montando', async ({ page }) => {
  // La otra mitad del contrato: el host promete degradar un remoto caído con
  // RemoteBoundary en vez de dejar la pantalla en blanco.
  const manifiesto = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../src/frontend/public/remotes.local.json'),
      'utf8'
    )
  );
  await page.route(manifiesto.mf_dashboard, (route) => route.abort('connectionrefused'));

  await prepararHost(page, 'ciudadano');

  await page.goto(`${HOST}/dashboard`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(AVISO_REMOTO_CAIDO)).toBeVisible();
  await expect(page.getByText('mf_dashboard', { exact: true })).toBeVisible();

  // Navegación dentro de la misma página: el menú del host sigue funcionando.
  await page.getByRole('link', { name: 'AJUSTES', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).toBeVisible();
  await expect(page.getByText(AVISO_REMOTO_CAIDO)).toHaveCount(0);
});
