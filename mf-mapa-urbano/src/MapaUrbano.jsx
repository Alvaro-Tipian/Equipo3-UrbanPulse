import { useEffect, useRef } from 'react';
import tt from '@tomtom-international/web-sdk-maps';
import '@tomtom-international/web-sdk-maps/dist/maps.css';

const MapaUrbano = ({ lat, lon }) => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);

  // Efecto 1: Inicializar el mapa la primera vez
  useEffect(() => {
    // Creamos la instancia del mapa
    const mapInstance = tt.map({
      key: import.meta.env.VITE_TOMTOM_API_KEY, 
      container: mapContainer.current,
      center: [-77.0428, -12.0464],
      zoom: 12,
    });

    map.current = mapInstance;

    // 👇 LA SOLUCIÓN: Esta función se ejecuta cuando React desmonta el componente
    return () => {
      mapInstance.remove(); // Apagamos el motor 3D del mapa
      map.current = null;   // Vaciamos la referencia
    };
  }, []);

  // Efecto 2: Mover el mapa y poner el marcador
  useEffect(() => {
    if (map.current && lat && lon) {
      const lngLat = [parseFloat(lon), parseFloat(lat)];

      map.current.flyTo({
        center: lngLat,
        zoom: 16,
        speed: 2
      });

      if (marker.current) {
        marker.current.remove();
      }

      marker.current = new tt.Marker()
        .setLngLat(lngLat)
        .addTo(map.current);
    }
  }, [lat, lon]);

  return (
    <div ref={mapContainer} style={{ width: '100%', height: '100%' }}></div>
  );
};

export default MapaUrbano;