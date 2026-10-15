import { useEffect, useMemo, useRef, useState } from 'react';
import tt from '@tomtom-international/web-sdk-maps';
import '@tomtom-international/web-sdk-maps/dist/maps.css';
import './index.css';
import MapLegend from './MapLegend';
import MapLayerControl from './MapLayerControl';
import MapHelpModal from './MapHelpModal';
import { INCIDENT_COLORS, INCIDENT_LABELS } from './incidentColors';
import { HelpCircle, Loader2 } from 'lucide-react';
import { aplicarCapaCalor, visibilidadCapaCalor, fetchN8n } from '@urbanpulse/shared';

const IMAGE_CACHE = new Map();
let REPORTES_CACHE = null;
let ULTIMA_CARGA = 0;
const TIEMPO_EXPIRACION = 60 * 1000;

// HT-39 / T02: sin URLs fijas de n8n; las rutas se resuelven con fetchN8n (@urbanpulse/shared)
const RUTA_REPORTES = '/urbanpulse/reports-list';
const RUTA_IMAGEN_REPORTE = '/urbanpulse/report-image';
const RUTA_SINIESTROS_HEATMAP = '/urbanpulse/mapa-siniestros-onsv';

const ESTILOS_MAPA = {
  dark: { map: 'basic_night', poi: 'poi_main', trafficIncidents: 'incidents_night', trafficFlow: 'flow_relative0-dark' },
  light: { map: 'basic_main', poi: 'poi_main', trafficIncidents: 'incidents_day', trafficFlow: 'flow_relative0' },
};

function temaActual() {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function pedirImagenReporte(id) {
  return fetchN8n(`${RUTA_IMAGEN_REPORTE}?id=${encodeURIComponent(id)}`);
}

async function pedirReportes() {
  const data = await fetchN8n(RUTA_REPORTES);
  return Array.isArray(data) ? data : (data && data.id ? [data] : []);
}

function crearContenidoPopup(reporte) {
  const cont = document.createElement('div');
  cont.style.width = '290px';
  cont.style.backgroundColor = '#ffffff';
  cont.style.padding = '14px 16px';
  cont.style.boxSizing = 'border-box';
  cont.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  cont.style.color = '#0f172a';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.gap = '8px';
  header.style.paddingRight = '30px';
  header.style.marginBottom = '8px';

  const dot = document.createElement('span');
  dot.style.width = '10px';
  dot.style.height = '10px';
  dot.style.borderRadius = '50%';
  dot.style.flexShrink = '0';
  dot.style.backgroundColor = INCIDENT_COLORS[reporte.incident_type] || '#f97316';

  const titulo = document.createElement('h4');
  titulo.style.margin = '0';
  titulo.style.fontSize = '14px';
  titulo.style.fontWeight = '700';
  titulo.style.color = '#0f172a';
  titulo.style.lineHeight = '1.3';
  titulo.textContent = INCIDENT_LABELS[reporte.incident_type] || reporte.incident_type || 'Incidente';

  header.appendChild(dot);
  header.appendChild(titulo);
  cont.appendChild(header);

  if (reporte.description) {
    const desc = document.createElement('p');
    desc.style.margin = '0 0 10px 0';
    desc.style.fontSize = '12px';
    desc.style.lineHeight = '1.5';
    desc.style.color = '#334155';
    desc.textContent = reporte.description;
    cont.appendChild(desc);
  }

  const badgesRow = document.createElement('div');
  badgesRow.style.display = 'flex';
  badgesRow.style.flexWrap = 'wrap';
  badgesRow.style.gap = '6px';
  badgesRow.style.marginBottom = '12px';

  const addBadge = (label, bg, color, border) => {
    const b = document.createElement('span');
    b.style.fontSize = '11px';
    b.style.fontWeight = '600';
    b.style.padding = '2px 8px';
    b.style.borderRadius = '6px';
    b.style.backgroundColor = bg;
    b.style.color = color;
    b.style.border = `1px solid ${border}`;
    b.textContent = label;
    badgesRow.appendChild(b);
  };

  if (reporte.severity) {
    const sevMap = {
      alta: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
      media: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
      baja: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
    };
    const c = sevMap[reporte.severity.toLowerCase()] || { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };
    addBadge(`Sev. ${reporte.severity}`, c.bg, c.text, c.border);
  }

  if (reporte.priority !== null && reporte.priority !== undefined) {
    addBadge(`P${reporte.priority}`, '#f3e8ff', '#6b21a8', '#d8b4fe');
  }

  if (reporte.status) {
    const estadoMap = {
      pending: { text: 'Pendiente', bg: '#f8fafc', color: '#475569', border: '#cbd5e1' },
      en_proceso: { text: 'En atención', bg: '#e0f2fe', color: '#0369a1', border: '#7dd3fc' },
      resuelto: { text: 'Resuelto', bg: '#dcfce7', color: '#15803d', border: '#86efac' },
    };
    const st = estadoMap[reporte.status] || { text: reporte.status, bg: '#f8fafc', color: '#475569', border: '#cbd5e1' };
    addBadge(st.text, st.bg, st.color, st.border);
  }

  cont.appendChild(badgesRow);

  if (reporte.tiene_imagen || reporte.image_url) {
    const frame = document.createElement('div');
    frame.style.width = '100%';
    frame.style.height = '145px';
    frame.style.borderRadius = '10px';
    frame.style.overflow = 'hidden';
    frame.style.backgroundColor = '#f1f5f9';
    frame.style.border = '1px solid #e2e8f0';
    frame.style.display = 'flex';
    frame.style.alignItems = 'center';
    frame.style.justifyContent = 'center';

    const renderImg = (src) => {
      frame.innerHTML = '';
      const img = document.createElement('img');
      img.src = src.startsWith('data:') || src.startsWith('http') ? src : `data:image/jpeg;base64,${src}`;
      img.alt = 'Fotografía del incidente';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.display = 'block';
      frame.appendChild(img);
    };

    if (IMAGE_CACHE.has(reporte.id)) {
      renderImg(IMAGE_CACHE.get(reporte.id));
    } else if (reporte.image_url) {
      renderImg(reporte.image_url);
    } else {
      frame.innerHTML = '<span style="font-size: 11px; color: #94a3b8;">Cargando fotografía...</span>';

      pedirImagenReporte(reporte.id)
        .then((datos) => {
          const item = Array.isArray(datos) ? datos[0] : datos;
          const fotoData = item?.image_url || item?.image || item?.image_base64 || item?.url || (typeof item === 'string' ? item : null);

          if (fotoData && String(fotoData).trim().length > 10) {
            IMAGE_CACHE.set(reporte.id, fotoData);
            renderImg(fotoData);
          } else {
            frame.innerHTML = '<span style="font-size: 11px; color: #94a3b8;">Sin foto disponible</span>';
          }
        })
        .catch((err) => {
          console.error('Error cargando imagen desde n8n:', err);
          frame.innerHTML = '<span style="font-size: 11px; color: #94a3b8;">Sin foto disponible</span>';
        });
    }

    cont.appendChild(frame);
  }

  if (reporte.created_at) {
    const footer = document.createElement('div');
    footer.style.marginTop = '10px';
    footer.style.paddingTop = '6px';
    footer.style.fontSize = '10px';
    footer.style.color = '#94a3b8';
    footer.style.textAlign = 'right';
    footer.textContent = new Date(reporte.created_at).toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    cont.appendChild(footer);
  }

  return cont;
}

function crearElementoMarcador(color) {
  const el = document.createElement('div');
  el.style.width = '24px';
  el.style.height = '24px';
  el.style.borderRadius = '50%';
  el.style.backgroundColor = color;
  el.style.border = '2.5px solid #fff';
  el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.45)';
  el.style.cursor = 'pointer';
  return el;
}

const MapaUrbano = ({ lat, lon }) => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const marcadoresReportes = useRef([]);
  const [mapaListo, setMapaListo] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [tipoActivo, setTipoActivo] = useState(null);
  const [cargandoHeatmap, setCargandoHeatmap] = useState(false);
  const [tema, setTema] = useState(temaActual);
  const [mostrarAyuda, setMostrarAyuda] = useState(false);

  const [reportes, setReportes] = useState(() => {
    const ahora = Date.now();
    if (REPORTES_CACHE && ahora - ULTIMA_CARGA < TIEMPO_EXPIRACION) {
      return REPORTES_CACHE;
    }
    return [];
  });

  const [cargando, setCargando] = useState(() => {
    const ahora = Date.now();
    return !(REPORTES_CACHE && ahora - ULTIMA_CARGA < TIEMPO_EXPIRACION);
  });

  const [capas, setCapas] = useState({
    mapaCalor: true,
    reportesCiudadanos: true,
    traficoTomTom: true,
    siniestrosSutran: true,
  });

  // Visibilidad inicial del mapa de calor. Se lee desde una ref para no volver a pedir
  // los siniestros cada vez que se activa o desactiva la capa (eso lo hace el efecto de visibilidad).
  const mapaCalorVisible = useRef(capas.mapaCalor);
  useEffect(() => {
    mapaCalorVisible.current = capas.mapaCalor;
  }, [capas.mapaCalor]);

  const toggleCapa = (idCapa) => {
    setCapas((prev) => ({ ...prev, [idCapa]: !prev[idCapa] }));
  };

  // 1. Inicializar mapa TomTom
  useEffect(() => {
    const tomtomKey = import.meta.env.TE_TOMTOM_API_KEY;
    if (!tomtomKey || !mapContainer.current) return undefined;

    const estilo = ESTILOS_MAPA[temaActual()];

    const mapInstance = tt.map({
      key: tomtomKey,
      container: mapContainer.current,
      center: [-77.0428, -12.0464],
      zoom: 12,
      style: estilo,
      stylesVisibility: {
        trafficFlow: true,
        trafficIncidents: true,
        poi: true,
      },
    });

    mapInstance.on('load', () => {
      // ✨ SOLUCIÓN: Damos 300ms a TomTom para que construya sus objetos internos al 100%
      setTimeout(() => {
        setMapaListo(true);
      }, 300);
    });

    map.current = mapInstance;

    return () => {
      mapInstance.remove();
      map.current = null;
      setMapaListo(false);
    };
  }, []);

  // 2. Tema
  useEffect(() => {
    const observador = new MutationObserver(() => {
      setTema(temaActual());
    });
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observador.disconnect();
  }, []);

  useEffect(() => {
    if (!map.current || !mapaListo) return;
    map.current.setStyle(ESTILOS_MAPA[tema]);
  }, [tema, mapaListo]);

  // 3. Centrado opcional
  useEffect(() => {
    if (map.current && lat && lon) {
      const lngLat = [parseFloat(lon), parseFloat(lat)];
      map.current.flyTo({ center: lngLat, zoom: 16, speed: 2 });

      if (marker.current) marker.current.remove();
      marker.current = new tt.Marker().setLngLat(lngLat).addTo(map.current);
    }
  }, [lat, lon]);

  // 4. Carga de reportes ciudadanos
  useEffect(() => {
    const ahora = Date.now();
    if (REPORTES_CACHE && ahora - ULTIMA_CARGA < TIEMPO_EXPIRACION) return undefined;

    let activo = true;

    pedirReportes()
      .then((lista) => {
        if (!activo) return;
        const validos = lista.filter((r) => r.latitude && r.longitude);
        REPORTES_CACHE = validos;
        ULTIMA_CARGA = Date.now();
        setReportes(validos);
        setCargando(false);
      })
      .catch((error) => {
        if (!activo) return;
        console.error('Error cargando reportes del mapa:', error);
        setCargando(false);
      });

    return () => {
      activo = false;
    };
  }, []);

  // ==========================================
  // HU-06: MAPA DE CALOR DE SINIESTRALIDAD VIAL
  // ==========================================
  useEffect(() => {
    if (!map.current || !mapaListo) return;

    const mapInstance = map.current;
    const SOURCE_ID = 'fuente-siniestros-heatmap';
    const LAYER_ID = 'capa-siniestros-heatmap';

    // Capa de calor compartida (@urbanpulse/shared) — también la usa mf-panel-riesgo (HU-08)
    const cargarCapaHeatmap = (geojson) =>
      aplicarCapaCalor(mapInstance, {
        sourceId: SOURCE_ID,
        layerId: LAYER_ID,
        geojson,
        visible: mapaCalorVisible.current,
      });

    setCargandoHeatmap(true);
    fetchN8n(RUTA_SINIESTROS_HEATMAP)
      .then((geojson) => {
        if (geojson && geojson.type === 'FeatureCollection') {
          cargarCapaHeatmap(geojson);
        }
      })
      .catch((err) => {
        console.warn('Mapa de calor: se usan los reportes como respaldo.', err);
        const fallbackGeoJSON = {
          type: 'FeatureCollection',
          features: reportes.map((r) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [parseFloat(r.longitude), parseFloat(r.latitude)] },
            properties: { cantidad_siniestros: r.severity === 'alta' ? 4 : 1 },
          })),
        };
        cargarCapaHeatmap(fallbackGeoJSON);
      })
      .finally(() => setCargandoHeatmap(false));
  }, [mapaListo, reportes]);

  // Alternar visibilidad de la capa Heatmap
  useEffect(() => {
    if (!map.current || !mapaListo) return;
    const LAYER_ID = 'capa-siniestros-heatmap';

    visibilidadCapaCalor(map.current, LAYER_ID, capas.mapaCalor);
  }, [capas.mapaCalor, mapaListo]);

  // 5. Filtrado de marcadores de ciudadanos
  const reportesFiltrados = useMemo(() => {
    if (!capas.reportesCiudadanos) return [];

    const texto = busqueda.trim().toLowerCase();
    return reportes.filter((r) => {
      const tipo = INCIDENT_COLORS[r.incident_type] ? r.incident_type : 'otro';
      if (tipoActivo && tipo !== tipoActivo) return false;
      if (!texto) return true;

      return [r.description, INCIDENT_LABELS[tipo], r.incident_type, r.severity, r.status]
        .some((campo) => (campo || '').toLowerCase().includes(texto));
    });
  }, [reportes, busqueda, tipoActivo, capas.reportesCiudadanos]);

  // 6. Marcadores
  useEffect(() => {
    if (!map.current) return;

    marcadoresReportes.current.forEach((m) => m.remove());
    marcadoresReportes.current = [];

    if (!capas.reportesCiudadanos) return;

    reportesFiltrados.forEach((reporte) => {
      const color = INCIDENT_COLORS[reporte.incident_type] || INCIDENT_COLORS.otro;
      const popup = new tt.Popup({ offset: 35, closeButton: true }).setDOMContent(crearContenidoPopup(reporte));

      const nuevoMarcador = new tt.Marker({ element: crearElementoMarcador(color), anchor: 'center' })
        .setLngLat([parseFloat(reporte.longitude), parseFloat(reporte.latitude)])
        .setPopup(popup)
        .addTo(map.current);

      marcadoresReportes.current.push(nuevoMarcador);
    });
  }, [reportesFiltrados, capas.reportesCiudadanos]);

  // 7. Flujo y Alertas de Tráfico
  useEffect(() => {
    if (!map.current || !mapaListo) return;
    
    if (!map.current.getStyle || !map.current.getStyle()) return;

    try {
      if (capas.traficoTomTom) {
        if (typeof map.current.showTrafficFlow === 'function') map.current.showTrafficFlow();
      } else {
        if (typeof map.current.hideTrafficFlow === 'function') map.current.hideTrafficFlow();
      }
    } catch {
      // Atrapado silenciosamente
    }

    try {
      if (capas.siniestrosSutran) {
        if (typeof map.current.showTrafficIncidents === 'function') map.current.showTrafficIncidents();
      } else {
        if (typeof map.current.hideTrafficIncidents === 'function') map.current.hideTrafficIncidents();
      }
    } catch {
      // Atrapado silenciosamente
    }
  }, [capas.traficoTomTom, capas.siniestrosSutran, mapaListo]);

  const conteosPorTipo = useMemo(() => {
    return reportes.reduce((acc, r) => {
      const tipo = INCIDENT_COLORS[r.incident_type] ? r.incident_type : 'otro';
      acc[tipo] = (acc[tipo] || 0) + 1;
      return acc;
    }, {});
  }, [reportes]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div id="tomtom-map-container" ref={mapContainer} style={{ width: '100%', height: '100%' }}></div>

      {cargandoHeatmap && (
        <div className="absolute top-20 left-4 z-10 flex items-center gap-2 bg-[var(--color-card)]/90 border border-[var(--color-border)] px-3 py-1.5 rounded-xl shadow-lg backdrop-blur-md">
          <Loader2 size={13} className="animate-spin text-orange-500" />
          <span className="text-[11px] font-medium text-[var(--color-text-primary)]">
            Cargando mapa de calor de siniestros...
          </span>
        </div>
      )}

      <MapLayerControl
        capas={capas}
        onToggleCapa={toggleCapa}
        totales={{
          ciudadanos: reportes.length,
          siniestros: reportes.filter((r) => r.incident_type === 'infraestructura_vial').length,
        }}
      />

      <div className="absolute top-4 left-4 z-10 flex items-start gap-2 max-w-[calc(100%-6rem)]">
        <div className="w-64">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar reporte..."
            className="w-full bg-[var(--color-card)]/95 text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] px-3 py-2 rounded-xl border border-[var(--color-border)] backdrop-blur-md text-sm focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] shadow-lg"
          />
          <p className="mt-1.5 px-1 text-[11px] text-[var(--color-text-secondary)]">
            {!capas.reportesCiudadanos
              ? 'Capa de ciudadanos desactivada'
              : cargando
              ? 'Cargando reportes...'
              : `${reportesFiltrados.length} de ${reportes.length} reportes visibles`}
          </p>
        </div>

        <button
          onClick={() => setMostrarAyuda(true)}
          className="p-2 rounded-xl bg-[var(--color-card)]/95 border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-light)] backdrop-blur-md shadow-lg transition-colors flex items-center justify-center shrink-0"
          title="¿Cómo leer el mapa?"
        >
          <HelpCircle size={20} />
        </button>
      </div>

      <MapLegend
        conteos={conteosPorTipo}
        tipoActivo={tipoActivo}
        onSeleccionarTipo={setTipoActivo}
      />

      <MapHelpModal
        abierto={mostrarAyuda}
        onCerrar={() => setMostrarAyuda(false)}
      />
    </div>
  );
};

export default MapaUrbano;