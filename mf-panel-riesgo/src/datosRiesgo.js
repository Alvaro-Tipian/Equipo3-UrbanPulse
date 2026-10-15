// HU-08: datos del panel de riesgo predictivo (contrato 4.2).
// GET /urbanpulse/riesgo-predictivo?franja=<manana|tarde|noche>&dia=<hoy|manana>
//
// Mientras HT-46 no publique la API, el .env usa TE_RIESGO_MOCK=true y se lee src/mock/riesgo.json
// (una respuesta del contrato 4.2 por cada combinación franja-día).
// El 07/10, quitar TE_RIESGO_MOCK (o ponerlo en false) para usar el webhook real de Emily.

import { fetchN8n } from '@urbanpulse/shared';
import mockRiesgo from './mock/riesgo.json';

export const FRANJAS = [
  { id: 'manana', label: 'Mañana', rango: '06:00 – 12:00' },
  { id: 'tarde', label: 'Tarde', rango: '12:00 – 18:00' },
  { id: 'noche', label: 'Noche', rango: '18:00 – 06:00' },
];

export const DIAS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'manana', label: 'Mañana' },
];

export const NIVELES = {
  bajo: { label: 'Bajo', color: 'rgb(34, 197, 94)' },
  medio: { label: 'Medio', color: 'rgb(234, 179, 8)' },
  alto: { label: 'Alto', color: 'rgb(220, 38, 38)' },
};

export function franjaActual(fecha = new Date()) {
  const h = fecha.getHours();
  if (h >= 6 && h < 12) return 'manana';
  if (h >= 12 && h < 18) return 'tarde';
  return 'noche';
}

const USAR_MOCK = import.meta.env.TE_RIESGO_MOCK === 'true';

/**
 * Devuelve la respuesta del contrato 4.2: { generado, modelo, zonas }.
 * Si el webhook falla, LANZA el error: el panel muestra un aviso (criterio 4 de HU-08).
 * Nunca se cae a datos simulados en silencio.
 */
export async function obtenerRiesgo(franja, dia) {
  if (USAR_MOCK) {
    await new Promise((r) => setTimeout(r, 300)); // simula la latencia de red
    const respuesta = mockRiesgo[`${franja}-${dia}`];
    if (!respuesta) throw new Error(`El mock no tiene datos para ${franja}/${dia}`);
    return { ...respuesta, esMock: true };
  }

  const params = new URLSearchParams({ franja, dia });
  const data = await fetchN8n(`/urbanpulse/riesgo-predictivo?${params}`);
  const respuesta = desenvolver(data);
  if (!respuesta || !Array.isArray(respuesta.zonas)) {
    console.error('[panel-riesgo] respuesta recibida de riesgo-predictivo:', data);
    throw new Error('La respuesta del modelo no tiene el formato esperado');
  }
  return { ...respuesta, zonas: normalizarZonas(respuesta.zonas), esMock: false };
}

// El webhook puede devolver el contrato de varias formas según el camino que tome:
// - un arreglo [ {...} ]                    (respuesta normal de n8n)
// - un texto JSON '"{\"zonas\":...}"'       (cuando sale de la caché como jsonb guardado como texto)
// - envuelto en { contrato } o { response_body }
function desenvolver(data) {
  let r = Array.isArray(data) ? data[0] : data;
  for (let i = 0; i < 3 && r; i += 1) {
    if (typeof r === 'string') {
      try { r = JSON.parse(r); } catch { return null; }
    } else if (!Array.isArray(r.zonas) && (r.contrato || r.response_body || r.payload)) {
      r = r.contrato || r.response_body || r.payload;
    } else {
      break;
    }
  }
  return r;
}

// El webhook real (HU-08 T04) puede enviar zonas sin coordenadas (lat/lng null)
// o sin distrito: esas no se pintan en el mapa, pero sí cuentan en el ranking.
function normalizarZonas(zonas) {
  return zonas.map((z) => ({
    ...z,
    nombre: z.nombre || z.zona_id,
    distrito: z.distrito || null,
    nivel: String(z.nivel || '').toLowerCase(),
    probabilidad: Number(z.probabilidad) || 0,
    lat: z.lat === null || z.lat === undefined ? null : Number(z.lat),
    lng: z.lng === null || z.lng === undefined ? null : Number(z.lng),
    motivos: Array.isArray(z.motivos) ? z.motivos : [],
  }));
}

// Top N zonas por probabilidad (T03: las 10 más riesgosas)
// Orden: primero por nivel (alto > medio > bajo) y, dentro del mismo nivel, por probabilidad.
// Ojo: "probabilidad" es la confianza del modelo en el nivel que predijo; una zona "bajo" con
// 99% NO es más riesgosa que una "alto" con 60%. Por eso el nivel manda.
const PESO_NIVEL = { alto: 3, medio: 2, bajo: 1 };

export function rankingZonas(zonas = [], limite = 10) {
  return [...zonas]
    .sort((a, b) => (PESO_NIVEL[b.nivel] || 0) - (PESO_NIVEL[a.nivel] || 0)
      || b.probabilidad - a.probabilidad)
    .slice(0, limite);
}