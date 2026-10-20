// T06 - Funcion serverless que crea una Solicitud de cambio en el Service
// Desk de Jira cuando un pipeline de GitHub Actions termina un despliegue.
//
// Complementa (no reemplaza) al webhook de n8n de HT-41 T03
// (docs/SERVICE_DESK_DESPLIEGUES.md): ese escucha el sobre
// { eventType, projectKey, commitSha, repository, runId, message } con un
// Bearer token. Este endpoint es para pipelines que prefieren llamar
// directo a una funcion serverless, con un contrato distinto (el del
// contrato 4.6 del SAD) y autenticacion por firma HMAC en vez de Bearer.
//
// Contrato de la peticion (ver nota para Sergio en
// docs/CAMBIO_DESPLIEGUE_VERCEL.md):
//   POST /api/cambio-despliegue
//   X-UrbanPulse-Signature: <HMAC SHA-256 hex del cuerpo crudo, con
//     DEPLOY_WEBHOOK_SECRET>
//   Content-Type: application/json
//   { "servicio": "...", "commit": "...", "workflow": "...",
//     "run_url": "...", "health_check": "..." }
//
// Variables de entorno requeridas (HT-42 T01, Sergio las registra en
// Terraform como sensibles):
//   DEPLOY_WEBHOOK_SECRET - secreto compartido con el pipeline que firma
//   JIRA_BASE_URL          - p.ej. https://urbanpulse-ti.atlassian.net
//   JIRA_EMAIL             - cuenta de servicio con acceso al portal
//   JIRA_API_TOKEN         - token de esa cuenta

import crypto from 'node:crypto';

// Mismo proyecto y tipo de solicitud que usa el webhook de n8n de HT-41 T03
// para un despliegue exitoso (docs/SERVICE_DESK_DESPLIEGUES.md).
const PROJECT_KEY = 'UPTI';
const REQUEST_TYPE_SOLICITUD_CAMBIO = '19';

const CAMPOS_REQUERIDOS = ['servicio', 'commit', 'workflow', 'run_url', 'health_check'];

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Comparacion en tiempo constante: compara primero el largo (no filtra
// informacion util) y solo entonces usa timingSafeEqual sobre buffers del
// mismo tamanio, para no exponer el secreto a un ataque de temporizacion.
export function firmaValida(rawBody, firmaRecibida, secreto) {
  if (!firmaRecibida || !secreto) return false;

  const firmaEsperada = crypto.createHmac('sha256', secreto).update(rawBody, 'utf8').digest('hex');
  const bufEsperado = Buffer.from(firmaEsperada, 'utf8');
  const bufRecibido = Buffer.from(firmaRecibida, 'utf8');

  if (bufEsperado.length !== bufRecibido.length) return false;
  return crypto.timingSafeEqual(bufEsperado, bufRecibido);
}

export function camposFaltantes(payload) {
  if (!payload || typeof payload !== 'object') return [...CAMPOS_REQUERIDOS];
  return CAMPOS_REQUERIDOS.filter((campo) => {
    const valor = payload[campo];
    return valor === undefined || valor === null || String(valor).trim() === '';
  });
}

function authHeaderJira() {
  const credenciales = `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`;
  return `Basic ${Buffer.from(credenciales, 'utf8').toString('base64')}`;
}

// La API del portal pide el serviceDeskId numerico, que no es la clave del
// proyecto; se resuelve en cada llamada (no se deja escrito a mano) por la
// misma razon que en HT-41: si alguien recrea el proyecto, el id cambia y
// esto sigue funcionando.
async function resolverServiceDeskId(baseUrl, headers) {
  const resp = await fetch(`${baseUrl}/rest/servicedeskapi/servicedesk`, { headers });
  if (!resp.ok) {
    throw new Error(`No se pudo listar los portales de Service Desk (${resp.status}): ${await resp.text()}`);
  }

  const data = await resp.json();
  const valores = data.values || [];
  const portal = valores.find((sd) => sd.projectKey === PROJECT_KEY);

  if (!portal) {
    const vistos = valores.map((sd) => sd.projectKey).join(', ') || 'ninguno';
    throw new Error(`El proyecto "${PROJECT_KEY}" no tiene portal de Service Desk. Portales visibles: ${vistos}.`);
  }

  return String(portal.id);
}

// El formulario de "Solicitud de cambio" del portal UPTI no tiene el campo
// Descripcion, y Jira rechaza la solicitud entera si se lo manda (400 "El
// campo 'description' no es valido para este tipo de solicitud"). Se
// pregunta que campos acepta el tipo; si no se puede saber, no se arriesga.
async function aceptaDescripcion(baseUrl, headers, serviceDeskId) {
  try {
    const resp = await fetch(
      `${baseUrl}/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype/${REQUEST_TYPE_SOLICITUD_CAMBIO}/field`,
      { headers },
    );
    if (!resp.ok) return false;
    const data = await resp.json();
    return (data.requestTypeFields || []).some((campo) => campo.fieldId === 'description');
  } catch {
    return false;
  }
}

// Sin el campo Descripcion, el detalle del despliegue va como comentario
// interno. Si el comentario falla, la solicitud ya existe y se responde 201.
async function agregarComentarioInterno(baseUrl, headers, issueKey, texto) {
  try {
    await fetch(`${baseUrl}/rest/servicedeskapi/request/${issueKey}/comment`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: texto, public: false }),
    });
  } catch {
    // El ticket ya esta creado; el detalle tambien queda en el log del pipeline.
  }
}

export function armarResumenYDescripcion({ servicio, commit, workflow, run_url: runUrl, health_check: healthCheck }) {
  const commitCorto = String(commit).slice(0, 7);
  const resumen = `Despliegue ${servicio} ${commitCorto}`;
  const descripcion = [
    `Servicio: ${servicio}`,
    `Workflow: ${workflow}`,
    `Commit: ${commit}`,
    `Ejecucion: ${runUrl}`,
    `Resultado del health check: ${typeof healthCheck === 'string' ? healthCheck : JSON.stringify(healthCheck)}`,
  ].join('\n');

  return { resumen, descripcion };
}

export async function POST(request) {
  // La firma se calcula sobre el cuerpo crudo: hay que leerlo como texto
  // antes de tocarlo, porque volver a serializar el JSON parseado no
  // reproduce necesariamente los mismos bytes que firmo el emisor.
  const rawBody = await request.text();
  const firmaRecibida = request.headers.get('X-UrbanPulse-Signature');

  if (!firmaValida(rawBody, firmaRecibida, process.env.DEPLOY_WEBHOOK_SECRET)) {
    return jsonResponse(401, { error: 'Firma invalida o ausente en X-UrbanPulse-Signature.' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: 'El cuerpo no es JSON valido.' });
  }

  const faltantes = camposFaltantes(payload);
  if (faltantes.length > 0) {
    return jsonResponse(400, { error: `Faltan campos obligatorios: ${faltantes.join(', ')}.` });
  }

  const baseUrl = (process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
  const headersJira = {
    Authorization: authHeaderJira(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  try {
    const serviceDeskId = await resolverServiceDeskId(baseUrl, headersJira);
    const { resumen, descripcion } = armarResumenYDescripcion(payload);
    const conDescripcion = await aceptaDescripcion(baseUrl, headersJira, serviceDeskId);

    const resp = await fetch(`${baseUrl}/rest/servicedeskapi/request`, {
      method: 'POST',
      headers: headersJira,
      body: JSON.stringify({
        serviceDeskId,
        requestTypeId: REQUEST_TYPE_SOLICITUD_CAMBIO,
        requestFieldValues: conDescripcion
          ? { summary: resumen, description: descripcion }
          : { summary: resumen },
      }),
    });

    const creado = await resp.json().catch(() => null);

    if (!resp.ok || !creado?.issueKey) {
      return jsonResponse(502, {
        error: 'Jira rechazo la solicitud de cambio.',
        detalle: creado?.errorMessage || creado?.errors || creado || (await resp.text().catch(() => null)),
      });
    }

    if (!conDescripcion) {
      await agregarComentarioInterno(baseUrl, headersJira, creado.issueKey, descripcion);
    }

    return jsonResponse(201, {
      id: creado.issueKey,
      url: creado._links?.web || null,
    });
  } catch (error) {
    // Cualquier falla de Jira o de red cae aqui: se responde 502 con el
    // mensaje para que quede en el log del despliegue (igual que HT-41).
    return jsonResponse(502, { error: error.message });
  }
}
