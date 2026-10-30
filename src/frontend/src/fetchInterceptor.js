import { clearSession } from "@urbanpulse/shared";
/**
 * Configura un interceptor global para todas las peticiones Fetch de la aplicación.
 * Captura el 401 (token inválido o vencido, contrato C1) para cerrar la sesión automáticamente.
 *
 * El 403 (rol_no_permitido) NO cierra la sesión: el token es válido y solo falta
 * permiso para esa acción (p. ej. un ciudadano que llama a /operativos). Cerrarla
 * expulsaba a usuarios con sesión válida. Lo mismo hace packages/shared/httpClient.js.
 */
export const setupFetchInterceptor = () => {
  // Guardamos la función fetch original del navegador
  const originalFetch = window.fetch;

  // Sobrescribimos el fetch global con nuestro "escudo"
  window.fetch = async (...args) => {
    // Ejecutamos la petición original directamente
    const response = await originalFetch(...args);

    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || response.url || '');

    // Excepción: endpoints públicos u Open Data que no deben desloguear al usuario
    const esPublico = url.includes('mapa-siniestros-sutran');

    if (response.status === 401 && !esPublico) {
      console.warn(
        `[Seguridad] Error 401 detectado en ${url}. Token inválido o expirado. Cerrando sesión automáticamente...`
      );

      // Invalidamos el estado global
      clearSession();
      try {
        window.sessionStorage.setItem('urbanpulse:motivo_salida', 'sesion_vencida');
      } catch { /* sin acceso */ }
    } else if (response.status === 403 && !esPublico) {
      // Sesión válida sin permiso para esta acción: solo se registra.
      console.warn(`[Seguridad] Error 403 en ${url}: el rol no tiene permiso para esta acción.`);
    }

    return response;
  };
};