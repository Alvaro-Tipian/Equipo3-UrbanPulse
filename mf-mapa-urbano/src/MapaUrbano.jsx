import React, { useEffect, useRef } from 'react';
import * as tt from '@tomtom-international/web-sdk-maps';
import '@tomtom-international/web-sdk-maps/dist/maps.css';

const MapaUrbano = () => {
  const mapElement = useRef(null);
  const mapInstance = useRef(null);

  // Usando tu variable de entorno de forma segura
  const TOMTOM_API_KEY = import.meta.env.VITE_TOMTOM_API_KEY;

  useEffect(() => {
    // Bloqueo de seguridad: si ya hay mapa o no hay contenedor, abortar
    if (mapInstance.current || !mapElement.current) return;

    const map = tt.map({
      key: TOMTOM_API_KEY,
      container: mapElement.current,
      center: [-77.042793, -12.046374],
      zoom: 12, 
      language: 'es-ES',
      renderWorldCopies: false
    });

    mapInstance.current = map;

    // Inyectar datos SOLO cuando WebGL haya terminado de construir la textura
    map.on('load', () => {
      const incidentesUrbanos = [
        { id: 1, tipo: 'Bache Grave', lat: -12.046374, lng: -77.042793 },
        { id: 2, tipo: 'Semáforo Malogrado', lat: -12.055301, lng: -77.037585 },
        { id: 3, tipo: 'Tráfico Pesado', lat: -12.062145, lng: -77.036611 }
      ];

      incidentesUrbanos.forEach((incidente) => {
        const popup = new tt.Popup({ offset: 30 }).setText(incidente.tipo);
        new tt.Marker()
          .setLngLat([incidente.lng, incidente.lat])
          .setPopup(popup)
          .addTo(map);
      });
    });

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [TOMTOM_API_KEY]);

  return (
    <div style={{ padding: '20px', background: '#f8f9fa' }}>
      <h2 style={{ fontFamily: 'sans-serif', marginTop: 0 }}>📍 UrbanPulse: Monitor de Incidentes</h2>
      {/* Tamaño estricto en píxeles para evitar colapsos matemáticos */}
      <div
        ref={mapElement}
        style={{ width: '800px', height: '500px', border: '1px solid #ccc', borderRadius: '8px' }}
      />
    </div>
  );
};

export default MapaUrbano;