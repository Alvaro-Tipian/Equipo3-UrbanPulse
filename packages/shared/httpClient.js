import { getToken, clearSession } from './session.js';
import { config } from './config.js';

// HT-39 / T02: cliente HTTP único hacia n8n.
// - La URL base sale de TE_N8N_BASE_URL (sin URLs fijas en el código).
//   Ejemplo: TE_N8N_BASE_URL=https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/webhook
// - El token NO se envía mientras TE_ENVIAR_TOKEN no sea 'true'.
//   Se activa en HT-31 (Sprint 4), cuando n8n permita la cabecera Authorization en CORS.
//   Enviarlo antes provoca errores de CORS en el preflight.

const BASE_URL = config.n8nBaseUrl;
const ENVIAR_TOKEN = config.enviarToken;

export async function fetchN8n(endpoint, options = {}) {
  if (!BASE_URL) {
    throw new Error('TE_N8N_BASE_URL no está configurada');
  }

  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...options.headers };

  // Solo enviar Content-Type cuando existe un cuerpo
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Preparado para HT-31: apagado por defecto
  if (ENVIAR_TOKEN) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const ruta = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  try {
    const response = await fetch(`${BASE_URL}${ruta}`, { ...options, method, headers });

    if (response.status === 401 || response.status === 403) {
      console.warn('[Shared HTTP] Sesión expirada o no autorizada.');
      clearSession();
      throw new Error('Sesión expirada');
    }

    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }

    // Algunos webhooks responden sin cuerpo: no romper con response.json()
    const texto = await response.text();
    return texto ? JSON.parse(texto) : null;
  } catch (error) {
    console.error(`[Shared HTTP] Fallo al consultar ${ruta}:`, error);
    throw error;
  }
}