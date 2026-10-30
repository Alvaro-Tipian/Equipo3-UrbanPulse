import { useEffect, useRef, useState } from 'react';
import tt from '@tomtom-international/web-sdk-maps';
import '@tomtom-international/web-sdk-maps/dist/maps.css';
import { aplicarCapaCalor, PALETA_RIESGO } from '@urbanpulse/shared';
import { NIVELES } from './datosRiesgo';

// HU-08 / T02: mapa de zonas coloreadas por nivel de riesgo.
// Reutiliza la inicialización TomTom de mf-mapa-urbano y su capa de calor (aplicarCapaCalor),
// y encima pinta cada zona con su nivel: bajo verde, medio amarillo, alto rojo.

const ESTILOS_MAPA = {
  dark: { map: 'basic_night', poi: 'poi_main' },
  light: { map: 'basic_main', poi: 'poi_main' },
};

const FUENTE_CALOR = 'riesgo-calor-fuente';
const CAPA_CALOR = 'riesgo-calor-capa';
const FUENTE_ZONAS = 'riesgo-zonas-fuente';
const CAPA_ZONAS = 'riesgo-zonas-capa';

function temaActual() {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function aGeojson(zonas) {
  return {
    type: 'FeatureCollection',
    features: zonas
      .filter((z) => Number.isFinite(z.lat) && Number.isFinite(z.lng))
      .map((z) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(z.lng), Number(z.lat)] },
      properties: { zona_id: z.zona_id, nombre: z.nombre, distrito: z.distrito || '', nivel: z.nivel, probabilidad: z.probabilidad },
    })),
  };
}

function pintar(map, zonas) {
  if (!map || !map.getStyle()) return;
  const geojson = aGeojson(zonas);

  // 1. Capa de calor reutilizada de mf-mapa-urbano: intensidad según la probabilidad
  aplicarCapaCalor(map, {
    sourceId: FUENTE_CALOR,
    layerId: CAPA_CALOR,
    geojson,
    propiedad: 'probabilidad',
    pesos: [0, 0, 0.33, 0.35, 0.66, 0.7, 1, 1],
    colores: PALETA_RIESGO,
    opacidad: 0.55,
  });

  // 2. Cada zona con el color exacto de su nivel
  const color = ['match', ['get', 'nivel'],
    'alto', NIVELES.alto.color,
    'medio', NIVELES.medio.color,
    'bajo', NIVELES.bajo.color,
    'rgb(148, 163, 184)'];

  try {
    const fuente = map.getSource(FUENTE_ZONAS);
    if (fuente) fuente.setData(geojson);
    else map.addSource(FUENTE_ZONAS, { type: 'geojson', data: geojson });

    if (!map.getLayer(CAPA_ZONAS)) {
      map.addLayer({
        id: CAPA_ZONAS,
        type: 'circle',
        source: FUENTE_ZONAS,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 14, 14],
          'circle-color': color,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.95,
        },
      });
    } else {
      map.setPaintProperty(CAPA_ZONAS, 'circle-color', color);
    }
  } catch (err) {
    console.warn('[MapaRiesgo] El mapa aún no estaba listo:', err?.message);
  }
}

export default function MapaRiesgo({ zonas }) {
  const contenedor = useRef(null);
  const map = useRef(null);
  const zonasRef = useRef(zonas);
  const [listo, setListo] = useState(false);
  const [tema, setTema] = useState(temaActual);
  // Igual que MapaUrbano.jsx: VITE_TOMTOM_API_KEY en Vercel, TE_TOMTOM_API_KEY como respaldo local.
  const key = import.meta.env.VITE_TOMTOM_API_KEY || import.meta.env.TE_TOMTOM_API_KEY;

  // Guardar las zonas actuales para repintar al cambiar de tema (fuera del render)
  useEffect(() => {
    zonasRef.current = zonas;
  }, [zonas]);

  // Inicialización (mismo patrón que MapaUrbano.jsx)
  useEffect(() => {
    if (!key || !contenedor.current) return undefined;
    const instancia = tt.map({
      key,
      container: contenedor.current,
      center: [-77.0428, -12.0664],
      zoom: 11,
      style: ESTILOS_MAPA[temaActual()],
    });
    instancia.on('load', () => setTimeout(() => setListo(true), 300));

    // Popup con el detalle de la zona
    instancia.on('click', CAPA_ZONAS, (e) => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      const div = document.createElement('div');
      div.style.cssText = 'font-family:system-ui;font-size:12px;color:#0f172a;padding:2px 4px';
      const t = document.createElement('strong');
      t.textContent = p.nombre;
      const d = document.createElement('div');
      d.textContent = `${p.distrito ? `${p.distrito} · ` : ''}${NIVELES[p.nivel]?.label ?? p.nivel} (${Math.round(p.probabilidad * 100)}%)`;
      div.append(t, d);
      new tt.Popup({ offset: 12 }).setLngLat(e.lngLat).setDOMContent(div).addTo(instancia);
    });

    map.current = instancia;
    return () => {
      instancia.remove();
      map.current = null;
      setListo(false);
    };
  }, [key]);

  // Seguir el tema claro/oscuro del host
  useEffect(() => {
    const obs = new MutationObserver(() => setTema(temaActual()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  // setStyle borra las capas propias: se vuelven a pintar al terminar
  useEffect(() => {
    if (!map.current || !listo) return;
    const m = map.current;
    m.setStyle(ESTILOS_MAPA[tema]);
    m.once('styledata', () => setTimeout(() => pintar(m, zonasRef.current), 200));
  }, [tema, listo]);

  // Cambiar franja o día → nuevos colores (criterio de T02)
  useEffect(() => {
    if (map.current && listo) pintar(map.current, zonas);
  }, [zonas, listo]);

  return (
    <div className="relative h-[520px] rounded-2xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-card)]">
      {key ? (
        <div ref={contenedor} style={{ width: '100%', height: '100%' }} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-[var(--color-text-secondary)]">
          Falta la variable VITE_TOMTOM_API_KEY (o TE_TOMTOM_API_KEY) en el .env de mf-panel-riesgo.
        </div>
      )}

      {/* Leyenda (patrón de MapLegend.jsx) */}
      <div className="absolute bottom-4 left-4 z-10 p-3 rounded-xl bg-[var(--color-card)]/90 border border-[var(--color-border)] backdrop-blur-md shadow-lg">
        <p className="text-[11px] font-semibold text-[var(--color-text-primary)] mb-2">Nivel de riesgo previsto</p>
        <ul className="space-y-1">
          {['alto', 'medio', 'bajo'].map((n) => (
            <li key={n} className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
              <span className="w-3 h-3 rounded-full border-2 border-white" style={{ backgroundColor: NIVELES[n].color }} />
              {NIVELES[n].label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
