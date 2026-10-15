import { registerRemotes, loadRemote } from '@module-federation/runtime';

export async function inicializarRemotes() {
  // Vite nos dice si estamos en 'development' (local) o 'production'
  const modoVite = import.meta.env.MODE;
  
  let entorno = 'local';
  if (modoVite === 'production') {
    // Si tienes una variable para staging, la usamos; si no, asumimos producción
    entorno = import.meta.env.VITE_IS_STAGING === 'true' ? 'staging' : 'production';
  }

  try {
    const respuesta = await fetch(`/remotes.${entorno}.json`);
    if (!respuesta.ok) throw new Error(`Error HTTP: ${respuesta.status}`);
    
     // Vite devuelve index.html (200) si el archivo no existe → json() falla
    const remotesConfig = await respuesta.json().catch(() => {
      throw new Error(`/remotes.${entorno}.json no existe o no es JSON válido`);
    });
    if (!Object.keys(remotesConfig).length) {
      throw new Error(`El manifiesto ${entorno} está vacío`);
    }
    // ✨ NUEVO: Transformamos el JSON agregando type: 'module' para que Vite lo entienda
    const modulosFederados = Object.entries(remotesConfig).map(([nombre, url]) => ({
      name: nombre,
      entry: url,
      type: 'module' // <-- ESTA ES LA LÍNEA MÁGICA QUE ARREGLA EL ERROR
    }));

    registerRemotes(modulosFederados);
    console.log(`[Module Federation] Remotos registrados exitosamente para el entorno: ${entorno}`);
  } catch (error) {
    console.error('[Module Federation] Fallo crítico al cargar el manifiesto de remotes:', error);
    throw error;
  }
}

// Esta función reemplazará a los import() estáticos en tu App.jsx
export function cargarRemote(nombreRemote, componente) {
  // Limpiamos el './' inicial si existe, para evitar el error de ruta '././'
  const compLimpio = componente.startsWith('./') ? componente.slice(2) : componente;
  return loadRemote(`${nombreRemote}/${compLimpio}`);
}