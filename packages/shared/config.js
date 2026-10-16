// Configuración central de UrbanPulse (@urbanpulse/shared).
// Único lugar donde se leen las variables TE_ del .env de cada microfrontend.
// Los demás archivos importan desde aquí en vez de usar import.meta.env directamente.
//
// Variables (en el .env de cada microfrontend y del host):
//   TE_N8N_BASE_URL   URL base de los webhooks de n8n (obligatoria)
//                     ej: https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/webhook
//   TE_ENVIAR_TOKEN   'true' para enviar Authorization: Bearer (HT-31, Sprint 4). Por defecto apagado.
//   TE_RAG_MOCK       'true' para usar respuestas simuladas del RAG en el chat
//   TE_RIESGO_MOCK    'true' para usar mock/riesgo.json en el panel de riesgo

const env = import.meta.env || {};

const esTrue = (valor) => String(valor).toLowerCase() === 'true';

export const config = Object.freeze({
  n8nBaseUrl: (env.TE_N8N_BASE_URL || '').replace(/\/+$/, ''),
  enviarToken: esTrue(env.TE_ENVIAR_TOKEN),
  ragMock: esTrue(env.TE_RAG_MOCK),
  riesgoMock: esTrue(env.TE_RIESGO_MOCK),
  modo: env.MODE || 'production',
  esDesarrollo: Boolean(env.DEV),
});

// Avisa una sola vez si falta algo obligatorio
if (!config.n8nBaseUrl) {
  console.error('[UrbanPulse config] Falta TE_N8N_BASE_URL en el .env de este microfrontend.');
}

export default config;