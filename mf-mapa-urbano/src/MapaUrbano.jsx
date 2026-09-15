import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import tt from '@tomtom-international/web-sdk-maps';
import '@tomtom-international/web-sdk-maps/dist/maps.css';
import './index.css';
import MapLegend from './MapLegend';
import { INCIDENT_COLORS, INCIDENT_LABELS } from './incidentColors';

// Fallback si TE_N8N_REPORTS_LIST_URL no está configurada en el entorno de despliegue
const N8N_REPORTS_LIST_URL = 'https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/webhook/urbanpulse/reports-list';
const N8N_REPORT_IMAGE_URL = 'https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/webhook/urbanpulse/report-image';

// El SDK de TomTom trae variantes diurna y nocturna, así que el mapa acompaña
// al tema de la aplicación en vez de quedarse siempre claro.
const ESTILOS_MAPA = {
  dark: { map: 'basic_night', poi: 'poi_main', trafficIncidents: 'incidents_night', trafficFlow: 'flow_relative0-dark' },
  light: { map: 'basic_main', poi: 'poi_main', trafficIncidents: 'incidents_day', trafficFlow: 'flow_relative0' },
};

// El host marca el tema con la clase 'light' en <html>. Como este microfrontend
// se ejecuta dentro de esa misma página, puede leerlo y observar sus cambios.
function temaActual() {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function urlImagenReporte(id) {
  const base = import.meta.env.TE_N8N_REPORT_IMAGE_URL || N8N_REPORT_IMAGE_URL;
  return `${base}?id=${encodeURIComponent(id)}`;
}

// Construimos el contenido del popup con nodos del DOM y textContent en vez de
// setHTML: la descripción la escribe el ciudadano y setHTML no sanitiza nada.
function crearContenidoPopup(reporte) {
  const cont = document.createElement('div');
  cont.style.fontSize = '12px';
  cont.style.lineHeight = '1.5';
  cont.style.maxWidth = '240px';
  cont.style.color = '#1f2937';

  const titulo = document.createElement('p');
  titulo.style.fontWeight = '700';
  titulo.style.marginBottom = '4px';
  titulo.textContent = INCIDENT_LABELS[reporte.incident_type] || reporte.incident_type || 'Reporte';
  cont.appendChild(titulo);

  if (reporte.description) {
    const desc = document.createElement('p');
    desc.style.marginBottom = '4px';
    desc.textContent = reporte.description;
    cont.appendChild(desc);
  }

  const meta = [];
  if (reporte.severity) meta.push(`Severidad: ${reporte.severity}`);
  if (reporte.priority !== null && reporte.priority !== undefined) meta.push(`Prioridad: ${reporte.priority}`);
  if (reporte.status) meta.push(`Estado: ${reporte.status}`);
  if (meta.length > 0) {
    const linea = document.createElement('p');
    linea.textContent = meta.join(' · ');
    cont.appendChild(linea);
  }

  if (reporte.reportado_por) {
    const autor = document.createElement('p');
    autor.textContent = `Reportado por: ${reporte.reportado_por}`;
    cont.appendChild(autor);
  }

  if (reporte.created_at) {
    const fecha = document.createElement('p');
    fecha.style.opacity = '0.7';
    fecha.textContent = new Date(reporte.created_at).toLocaleString();
    cont.appendChild(fecha);
  }

  // La imagen no viaja en el listado (pesaría demasiado): se pide solo cuando
  // el ciudadano abre el popup de ese reporte concreto.
  if (reporte.tiene_imagen) {
    const zona = document.createElement('div');
    zona.style.marginTop = '6px';

    const aviso = document.createElement('p');
    aviso.style.opacity = '0.7';
    aviso.textContent = 'Cargando imagen...';
    zona.appendChild(aviso);

    fetch(urlImagenReporte(reporte.id))
      .then((r) => r.json())
      .then((datos) => {
        const fuente = Array.isArray(datos) ? datos[0] : datos;
        if (!fuente || !fuente.image_url) {
          aviso.textContent = 'La imagen ya no está disponible.';
          return;
        }
        const img = document.createElement('img');
        img.src = fuente.image_url.startsWith('data:') ? fuente.image_url : `data:image/jpeg;base64,${fuente.image_url}`;
        img.alt = 'Fotografía del reporte';
        img.style.width = '100%';
        img.style.borderRadius = '8px';
        img.style.marginTop = '2px';
        zona.replaceChild(img, aviso);
      })
      .catch(() => {
        aviso.textContent = 'No se pudo cargar la imagen.';
      });

    cont.appendChild(zona);
  }

  return cont;
}

// tt.Marker no expone una opción de tamaño/escala para su pin por defecto, así
// que para tener íconos más grandes y visibles hay que pasarle un elemento propio
// (ver "element" en la doc del SDK: EV Charging Stations Custom Display).
function crearElementoMarcador(color) {
  const el = document.createElement('div');
  el.style.width = '26px';
  el.style.height = '26px';
  el.style.borderRadius = '50%';
  el.style.backgroundColor = color;
  el.style.border = '3px solid #fff';
  el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.45)';
  el.style.cursor = 'pointer';
  return el;
}

const MapaUrbano = ({ lat, lon }) => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const marcadoresReportes = useRef([]);

  const [reportes, setReportes] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [tipoActivo, setTipoActivo] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [tema, setTema] = useState(temaActual);

  // Efecto 1: Inicializar el mapa la primera vez
  useEffect(() => {
    const tomtomKey = import.meta.env.VITE_TOMTOM_API_KEY;
    if (!tomtomKey || !mapContainer.current) return undefined;

    const mapInstance = tt.map({
      key: tomtomKey,
      container: mapContainer.current,
      center: [-77.0428, -12.0464],
      zoom: 12,
      style: ESTILOS_MAPA[temaActual()],
    });

    map.current = mapInstance;

    return () => {
      mapInstance.remove();
      map.current = null;
    };
  }, []);

  // Efecto: seguir el tema del host. La clase vive en <html>, fuera del árbol de
  // React de este remote, así que se observa el atributo class en vez de recibirlo
  // por props (no hay estado compartido entre microfrontends federados).
  useEffect(() => {
    const observador = new MutationObserver(() => {
      setTema(temaActual());
    });

    observador.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observador.disconnect();
  }, []);

  // Efecto: aplicar al mapa el estilo correspondiente al tema
  useEffect(() => {
    if (!map.current) return;
    map.current.setStyle(ESTILOS_MAPA[tema]);
  }, [tema]);

  // Efecto 2: Mover el mapa y poner el marcador de la ubicación recibida por props
  useEffect(() => {
    if (map.current && lat && lon) {
      const lngLat = [parseFloat(lon), parseFloat(lat)];

      map.current.flyTo({ center: lngLat, zoom: 16, speed: 2 });

      if (marker.current) {
        marker.current.remove();
      }

      marker.current = new tt.Marker().setLngLat(lngLat).addTo(map.current);
    }
  }, [lat, lon]);

  const pedirReportes = useCallback(async () => {
    const webhookUrl = import.meta.env.TE_N8N_REPORTS_LIST_URL || N8N_REPORTS_LIST_URL;
    const response = await fetch(webhookUrl);
    const data = await response.json();

    // n8n (responseMode: lastNode) devuelve un objeto suelto cuando hay un único
    // reporte y un array cuando hay varios. Normalizamos para 0, 1 o N.
    return Array.isArray(data) ? data : (data && data.id ? [data] : []);
  }, []);

  // Efecto 3: Traer los reportes. El estado se actualiza dentro de los callbacks
  // de la promesa, nunca de forma síncrona (react-hooks/set-state-in-effect).
  useEffect(() => {
    let activo = true;

    pedirReportes()
      .then((lista) => {
        if (!activo) return;
        setReportes(lista.filter((r) => r.latitude && r.longitude));
        setCargando(false);
      })
      .catch((error) => {
        if (!activo) return;
        console.error('Error cargando los reportes del mapa:', error);
        setCargando(false);
      });

    return () => {
      activo = false;
    };
  }, [pedirReportes]);

  const conteosPorTipo = useMemo(() => {
    return reportes.reduce((acc, r) => {
      const tipo = INCIDENT_COLORS[r.incident_type] ? r.incident_type : 'otro';
      acc[tipo] = (acc[tipo] || 0) + 1;
      return acc;
    }, {});
  }, [reportes]);

  const reportesFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();

    return reportes.filter((r) => {
      const tipo = INCIDENT_COLORS[r.incident_type] ? r.incident_type : 'otro';
      if (tipoActivo && tipo !== tipoActivo) return false;
      if (!texto) return true;

      return [r.description, INCIDENT_LABELS[tipo], r.incident_type, r.severity, r.status]
        .some((campo) => (campo || '').toLowerCase().includes(texto));
    });
  }, [reportes, busqueda, tipoActivo]);

  // Efecto 4: Redibujar los marcadores cada vez que cambia el filtro
  useEffect(() => {
    if (!map.current) return;

    marcadoresReportes.current.forEach((m) => m.remove());
    marcadoresReportes.current = [];

    reportesFiltrados.forEach((reporte) => {
      const color = INCIDENT_COLORS[reporte.incident_type] || INCIDENT_COLORS.otro;
      const popup = new tt.Popup({ offset: 30 }).setDOMContent(crearContenidoPopup(reporte));

      const nuevoMarcador = new tt.Marker({ element: crearElementoMarcador(color), anchor: 'center' })
        .setLngLat([parseFloat(reporte.longitude), parseFloat(reporte.latitude)])
        .setPopup(popup)
        .addTo(map.current);

      marcadoresReportes.current.push(nuevoMarcador);
    });
  }, [reportesFiltrados]);

  return (
    <div className="relative w-full h-full">
      <div id="tomtom-map-container" ref={mapContainer} style={{ width: '100%', height: '100%' }}></div>

      {/* Aviso de degradación segura cuando no se provee la API Key de TomTom */}
      {!import.meta.env.VITE_TOMTOM_API_KEY && (
        <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none z-10">
          <div className="bg-[var(--color-card)]/95 border border-[var(--color-border)] rounded-2xl p-5 max-w-sm text-center shadow-xl backdrop-blur-md pointer-events-auto">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
              🗺️ Modo Sin Conexión a TomTom
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              La variable <code className="text-amber-400 font-mono">VITE_TOMTOM_API_KEY</code> no está configurada. Configure la credencial cifrada en la consola de Vercel (ver <span className="font-mono text-xs">docs/VERCEL_PRODUCTION_KEYS_HARDENING.md</span>).
            </p>
          </div>
        </div>
      )}

      {/* BUSCADOR */}
      <div className="absolute top-4 left-4 z-10 w-64 max-w-[calc(100%-2rem)]">
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar reporte..."
          className="w-full bg-[var(--color-card)]/95 text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] px-3 py-2 rounded-xl border border-[var(--color-border)] backdrop-blur-sm text-sm focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
        />
        <p className="mt-1.5 px-1 text-[11px] text-[var(--color-text-secondary)]">
          {cargando
            ? 'Cargando reportes...'
            : `${reportesFiltrados.length} de ${reportes.length} reporte${reportes.length === 1 ? '' : 's'} con ubicación`}
        </p>
      </div>

      <MapLegend
        conteos={conteosPorTipo}
        tipoActivo={tipoActivo}
        onSeleccionarTipo={setTipoActivo}
      />
    </div>
  );
};

export default MapaUrbano;
