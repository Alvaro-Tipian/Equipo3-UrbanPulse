// Capa de calor reutilizable (TomTom / MapLibre).
// La usan mf-mapa-urbano (HU-06, siniestralidad) y mf-panel-riesgo (HU-08, riesgo predictivo).
// No importa TomTom: recibe la instancia del mapa ya creada.

// Paleta original del mapa de siniestros (HU-06)
export const PALETA_SINIESTROS = [
  0, 'rgba(254, 240, 138, 0)',
  0.2, 'rgb(254, 240, 138)',
  0.4, 'rgb(234, 179, 8)',
  0.65, 'rgb(249, 115, 22)',
  0.85, 'rgb(220, 38, 38)',
  1.0, 'rgb(153, 27, 27)',
];

// Colores de nivel de riesgo (para leyendas y tarjetas)
export const COLORES_RIESGO = {
  bajo: 'rgb(34, 197, 94)',
  medio: 'rgb(234, 179, 8)',
  alto: 'rgb(220, 38, 38)',
};

// Paleta del mapa de riesgo predictivo (HU-08): verde → amarillo → naranja → rojo
export const PALETA_RIESGO = [
  0, 'rgba(34, 197, 94, 0)',
  0.15, 'rgba(34, 197, 94, 0.55)',
  0.4, COLORES_RIESGO.medio,
  0.65, 'rgb(249, 115, 22)',
  0.85, COLORES_RIESGO.alto,
  1.0, 'rgb(127, 29, 29)',
];

function construirPaint({ propiedad, pesos, colores, opacidad }) {
  return {
    'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', propiedad], 0], ...pesos],
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 13, 1.5, 16, 2.5],
    'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...colores],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 13, 22, 16, 38],
    'heatmap-opacity': opacidad,
  };
}

/**
 * Crea o actualiza una capa de calor. Es idempotente: si la fuente o la capa
 * ya existen, actualiza los datos y los colores en lugar de duplicarlas.
 *
 * @returns {boolean} true si se aplicó; false si el mapa aún no estaba listo.
 */
export function aplicarCapaCalor(map, {
  sourceId,
  layerId,
  geojson,
  propiedad = 'cantidad_siniestros',
  pesos = [0, 0.2, 5, 0.6, 15, 1.0],
  colores = PALETA_SINIESTROS,
  opacidad = 0.82,
  visible = true,
}) {
  try {
    if (!map || typeof map.getSource !== 'function' || !map.getStyle()) return false;

    const fuente = map.getSource(sourceId);
    if (fuente) {
      fuente.setData(geojson);
    } else {
      map.addSource(sourceId, { type: 'geojson', data: geojson });
    }

    const paint = construirPaint({ propiedad, pesos, colores, opacidad });

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'heatmap',
        source: sourceId,
        maxzoom: 18,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint,
      });
    } else {
      Object.entries(paint).forEach(([clave, valor]) => map.setPaintProperty(layerId, clave, valor));
    }
    return true;
  } catch (err) {
    console.warn('[capaCalor] El mapa aún no estaba listo para la capa:', layerId, err?.message);
    return false;
  }
}

export function visibilidadCapaCalor(map, layerId, visible) {
  try {
    if (map && typeof map.getLayer === 'function' && map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  } catch {
    // Cambio de estilo en curso: se reaplica en el siguiente render
  }
}