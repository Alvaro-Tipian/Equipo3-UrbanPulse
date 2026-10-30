import { useEffect, useRef } from 'react';

// HU-11 T03: llama a refrescar cada intervaloMs mientras la pestaña del navegador
// está visible. Al ocultarla se pausa y al volver refresca enseguida.
export function useAutoRefresh(intervaloMs, refrescar) {
  // En una ref para que un refrescar nuevo no reinicie el temporizador.
  const ultimoRefrescar = useRef(refrescar);

  useEffect(() => {
    ultimoRefrescar.current = refrescar;
  }, [refrescar]);

  useEffect(() => {
    let temporizador = null;

    const detener = () => {
      clearInterval(temporizador);
      temporizador = null;
    };

    const iniciar = () => {
      temporizador = setInterval(() => ultimoRefrescar.current(), intervaloMs);
    };

    const alCambiarVisibilidad = () => {
      detener();
      if (document.visibilityState === 'visible') {
        ultimoRefrescar.current();
        iniciar();
      }
    };

    if (document.visibilityState === 'visible') iniciar();
    document.addEventListener('visibilitychange', alCambiarVisibilidad);

    return () => {
      detener();
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [intervaloMs]);
}
