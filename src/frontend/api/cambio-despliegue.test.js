/**
 * @jest-environment node
 *
 * Esta funcion corre como funcion serverless de Node en Vercel (Request,
 * Response y fetch globales), no en un navegador: el resto del proyecto usa
 * jsdom (jest.config.js), pero este archivo necesita el entorno node para
 * tener esas globales del runtime real.
 */
import crypto from 'node:crypto';
import {
  POST,
  firmaValida,
  camposFaltantes,
  armarResumenYDescripcion,
} from './cambio-despliegue';

const SECRETO = 'secreto-de-prueba';

const PAYLOAD_VALIDO = {
  servicio: 'urbanpulse-api',
  commit: '9f3c1d2a9f3c1d2a9f3c1d2a9f3c1d2a9f3c1d2a',
  workflow: 'Deploy API de riesgo vial to AWS Lightsail',
  run_url: 'https://github.com/SergioAscurraPerez/Equipo3-UrbanPulse/actions/runs/38460872588',
  health_check: 'ok',
};

function firmar(rawBody, secreto = SECRETO) {
  return crypto.createHmac('sha256', secreto).update(rawBody, 'utf8').digest('hex');
}

function construirRequest(payload, { secreto = SECRETO, firmaHeader } = {}) {
  const rawBody = JSON.stringify(payload);
  const firma = firmaHeader !== undefined ? firmaHeader : firmar(rawBody, secreto);
  const headers = new Map();
  if (firma !== null) headers.set('X-UrbanPulse-Signature', firma);

  return {
    text: async () => rawBody,
    headers: { get: (nombre) => headers.get(nombre) ?? null },
  };
}

describe('firmaValida', () => {
  test('acepta una firma HMAC-SHA256 correcta', () => {
    const rawBody = JSON.stringify(PAYLOAD_VALIDO);
    expect(firmaValida(rawBody, firmar(rawBody), SECRETO)).toBe(true);
  });

  test('rechaza una firma incorrecta', () => {
    const rawBody = JSON.stringify(PAYLOAD_VALIDO);
    expect(firmaValida(rawBody, 'a'.repeat(64), SECRETO)).toBe(false);
  });

  test('rechaza cuando no hay firma o no hay secreto configurado', () => {
    const rawBody = JSON.stringify(PAYLOAD_VALIDO);
    expect(firmaValida(rawBody, null, SECRETO)).toBe(false);
    expect(firmaValida(rawBody, firmar(rawBody), undefined)).toBe(false);
  });
});

describe('camposFaltantes', () => {
  test('no reporta nada para un payload completo', () => {
    expect(camposFaltantes(PAYLOAD_VALIDO)).toEqual([]);
  });

  test('reporta cada campo obligatorio ausente o vacio', () => {
    const incompleto = { ...PAYLOAD_VALIDO, workflow: '', run_url: undefined };
    delete incompleto.health_check;
    expect(camposFaltantes(incompleto).sort()).toEqual(['health_check', 'run_url', 'workflow']);
  });
});

describe('armarResumenYDescripcion', () => {
  test('arma un resumen con el commit corto y una descripcion con los datos del despliegue', () => {
    const { resumen, descripcion } = armarResumenYDescripcion(PAYLOAD_VALIDO);
    expect(resumen).toBe('Despliegue urbanpulse-api 9f3c1d2');
    expect(descripcion).toContain('Workflow: Deploy API de riesgo vial to AWS Lightsail');
    expect(descripcion).toContain('Resultado del health check: ok');
  });
});

describe('POST /api/cambio-despliegue', () => {
  const ENV_ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env.DEPLOY_WEBHOOK_SECRET = SECRETO;
    process.env.JIRA_BASE_URL = 'https://urbanpulse-ti.atlassian.net';
    process.env.JIRA_EMAIL = 'bot@urbanpulse.dev';
    process.env.JIRA_API_TOKEN = 'token-de-prueba';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
    jest.restoreAllMocks();
  });

  test('responde 401 y no llama a Jira si la firma no coincide', async () => {
    const request = construirRequest(PAYLOAD_VALIDO, { firmaHeader: 'firma-incorrecta' });

    const respuesta = await POST(request);

    expect(respuesta.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('responde 400 si falta un campo del contrato', async () => {
    const incompleto = { ...PAYLOAD_VALIDO };
    delete incompleto.health_check;
    const request = construirRequest(incompleto);

    const respuesta = await POST(request);
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(400);
    expect(cuerpo.error).toMatch(/health_check/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('crea la solicitud de cambio en Jira y responde 201 con el id y la url', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ values: [{ id: '7', projectKey: 'UPTI' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ requestTypeFields: [{ fieldId: 'summary' }, { fieldId: 'description' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issueKey: 'UPTI-123',
          _links: { web: 'https://urbanpulse-ti.atlassian.net/servicedesk/customer/portal/1/UPTI-123' },
        }),
      });

    const request = construirRequest(PAYLOAD_VALIDO);
    const respuesta = await POST(request);
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(201);
    expect(cuerpo).toEqual({
      id: 'UPTI-123',
      url: 'https://urbanpulse-ti.atlassian.net/servicedesk/customer/portal/1/UPTI-123',
    });

    const [, , terceraLlamada] = global.fetch.mock.calls;
    const cuerpoEnviado = JSON.parse(terceraLlamada[1].body);
    expect(cuerpoEnviado.serviceDeskId).toBe('7');
    expect(cuerpoEnviado.requestTypeId).toBe('19');
  });

  test('responde 502 con el detalle si Jira rechaza la solicitud', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ values: [{ id: '7', projectKey: 'UPTI' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ requestTypeFields: [{ fieldId: 'summary' }, { fieldId: 'description' }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ errorMessage: 'requestTypeId invalido' }),
        text: async () => '{"errorMessage":"requestTypeId invalido"}',
      });

    const request = construirRequest(PAYLOAD_VALIDO);
    const respuesta = await POST(request);
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(502);
    expect(cuerpo.detalle).toBe('requestTypeId invalido');
  });

  // El formulario de "Solicitud de cambio" del portal UPTI no tiene el campo
  // Descripcion, y Jira rechazaba la solicitud entera con 400 ("El campo
  // 'description' no es valido para este tipo de solicitud").
  function jiraFalso({ campos = ['summary'], camposOk = true, comentarioOk = true } = {}) {
    global.fetch.mockImplementation(async (url, opciones = {}) => {
      if (url.endsWith('/rest/servicedeskapi/servicedesk')) {
        return { ok: true, json: async () => ({ values: [{ id: '2', projectKey: 'UPTI' }] }) };
      }
      if (url.endsWith('/requesttype/19/field')) {
        if (!camposOk) return { ok: false, status: 403, json: async () => ({}), text: async () => 'prohibido' };
        return { ok: true, json: async () => ({ requestTypeFields: campos.map((fieldId) => ({ fieldId })) }) };
      }
      if (url.endsWith('/rest/servicedeskapi/request') && opciones.method === 'POST') {
        const enviado = JSON.parse(opciones.body);
        if ('description' in enviado.requestFieldValues && !campos.includes('description')) {
          return { ok: false, json: async () => ({ errorMessage: "El campo 'description' no es valido" }) };
        }
        return { ok: true, json: async () => ({ issueKey: 'UPTI-18', _links: { web: 'https://x/UPTI-18' } }) };
      }
      if (url.endsWith('/request/UPTI-18/comment')) {
        if (!comentarioOk) throw new Error('red caida');
        return { ok: true, json: async () => ({ id: '1' }) };
      }
      throw new Error(`URL inesperada: ${url}`);
    });
  }

  const llamadaA = (fin) => global.fetch.mock.calls.find(([url]) => url.endsWith(fin));

  test('si el formulario no tiene Descripcion, el detalle va como comentario interno', async () => {
    jiraFalso({ campos: ['summary'] });

    const respuesta = await POST(construirRequest(PAYLOAD_VALIDO));

    expect(respuesta.status).toBe(201);
    const enviado = JSON.parse(llamadaA('/rest/servicedeskapi/request')[1].body);
    expect(enviado.requestFieldValues).toEqual({ summary: 'Despliegue urbanpulse-api 9f3c1d2' });
    const comentario = JSON.parse(llamadaA('/request/UPTI-18/comment')[1].body);
    expect(comentario.public).toBe(false);
    expect(comentario.body).toMatch(/Commit: 9f3c1d2a/);
  });

  test('si el formulario tiene Descripcion, va en la solicitud y no hay comentario', async () => {
    jiraFalso({ campos: ['summary', 'description'] });

    const respuesta = await POST(construirRequest(PAYLOAD_VALIDO));

    expect(respuesta.status).toBe(201);
    const enviado = JSON.parse(llamadaA('/rest/servicedeskapi/request')[1].body);
    expect(enviado.requestFieldValues.description).toMatch(/Servicio: urbanpulse-api/);
    expect(llamadaA('/comment')).toBeUndefined();
  });

  test('si no se pueden leer los campos, no arriesga la Descripcion', async () => {
    jiraFalso({ camposOk: false });

    const respuesta = await POST(construirRequest(PAYLOAD_VALIDO));

    expect(respuesta.status).toBe(201);
    const enviado = JSON.parse(llamadaA('/rest/servicedeskapi/request')[1].body);
    expect(enviado.requestFieldValues.description).toBeUndefined();
  });

  test('un comentario que falla no tapa la solicitud ya creada', async () => {
    jiraFalso({ comentarioOk: false });

    const respuesta = await POST(construirRequest(PAYLOAD_VALIDO));
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(201);
    expect(cuerpo.id).toBe('UPTI-18');
  });

  test('responde 502 si el proyecto no tiene portal de Service Desk', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ values: [{ id: '3', projectKey: 'OTRO' }] }),
    });

    const request = construirRequest(PAYLOAD_VALIDO);
    const respuesta = await POST(request);
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(502);
    expect(cuerpo.error).toMatch(/no tiene portal de Service Desk/);
  });
});
