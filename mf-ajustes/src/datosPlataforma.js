import { fetchN8n } from '@urbanpulse/shared';

// Enlace de respaldo: el webhook devuelve la raíz del sitio de Jira, no el portal de clientes
export const PORTAL_SERVICE_DESK = 'https://urbanpulse-ti.atlassian.net/servicedesk/customer/portal/2';

// Latencia a partir de la cual un servicio que responde se marca como lento
export const LATENCIA_LENTA_MS = 1000;

const NOMBRES_SERVICIO = {
  n8n_engine: 'n8n (orquestador)',
  fastapi_mlops: 'API del modelo',
  neon_postgres: 'Base de datos (Neon)',
};

function normalizarServicio(s) {
  const ok = s.ok !== undefined ? Boolean(s.ok) : String(s.estado || '').toUpperCase() === 'ONLINE';
  return {
    id: s.nombre,
    nombre: NOMBRES_SERVICIO[s.nombre] || s.nombre,
    ok,
    latencia_ms: typeof s.latencia_ms === 'number' ? s.latencia_ms : null,
  };
}

function normalizar(r) {
  const mm = r.monitoreo_modelo || r.modelo || {};
  const sd = r.service_desk_jira || r.service_desk || {};

  const version = mm.modelo && mm.version
    ? `${mm.modelo}@${mm.version}`
    : (mm.version || mm.modelo || null);

  const portal = sd.portal_url && sd.portal_url.includes('/servicedesk/')
    ? sd.portal_url
    : PORTAL_SERVICE_DESK;

  return {
    estadoGeneral: r.estado_plataforma || null,
    comprobado: r.timestamp || r.comprobado || null,
    servicios: (r.servicios || []).map(normalizarServicio),
    ultimoDespliegue: r.ultimo_despliegue || null,
    modelo: {
      version,
      f1: typeof mm.f1_score === 'number' ? mm.f1_score : null,
      fechaMonitoreo: mm.ultimo_monitoreo || mm.monitoreo?.fecha || null,
      // null = no hay evento de monitoreo: no se sabe si hay deriva
      deriva: mm.deriva_detectada ?? mm.monitoreo?.deriva ?? null,
      vigente: mm.monitoreo_vigente ?? null,
    },
    serviceDesk: {
      ticketsAbiertos: sd.tickets_abiertos ?? null,
      slaPct: sd.cumplimiento_sla_porcentaje ?? sd.sla_cumplido_pct ?? null,
      portal,
    },
  };
}

export async function obtenerEstadoPlataforma() {
  const data = await fetchN8n('/urbanpulse/estado-plataforma');
  const r = Array.isArray(data) ? data[0] : data;
  if (!r || !Array.isArray(r.servicios)) {
    throw new Error('La respuesta de estado-plataforma no tiene el formato esperado');
  }
  return normalizar(r);
}