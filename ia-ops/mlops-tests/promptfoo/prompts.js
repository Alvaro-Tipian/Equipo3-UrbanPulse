// ============================================================================
// Carga de los prompts bajo prueba (HT-48 T03)
//
// Las funciones leen directamente los .md del registro
// (ia-ops/prompts/prompt_registry.json), en vez de copiar su texto aqui. Asi la
// suite evalua siempre el prompt que esta en produccion: si alguien edita un
// guardrail en el .md y lo debilita, promptfoo lo detecta en el siguiente run.
// Una copia local, en cambio, envejeceria en silencio.
// ============================================================================

const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const RAIZ_PROMPTS = resolve(__dirname, '..', '..', 'prompts');
const REGISTRO = JSON.parse(readFileSync(join(RAIZ_PROMPTS, 'prompt_registry.json'), 'utf8'));

function leerPromptRegistrado(id) {
  const entrada = REGISTRO.prompts.find((p) => p.id === id);
  if (!entrada) {
    throw new Error(
      `El prompt '${id}' no esta en prompt_registry.json. ` +
        'Registralo antes de agregarle pruebas.',
    );
  }
  // file_path del registro es relativo a la raiz del repositorio.
  return readFileSync(resolve(__dirname, '..', '..', '..', entrada.file_path), 'utf8');
}

function clasificacionIncidente(contexto) {
  const { descripcion_ciudadano, lat, lng, fecha_hora } = contexto.vars;
  return [
    { role: 'system', content: leerPromptRegistrado('clasificacion_incidente') },
    {
      role: 'user',
      content: JSON.stringify({
        descripcion_ciudadano,
        coordenadas: { lat: Number(lat), lng: Number(lng) },
        fecha_hora,
      }),
    },
  ];
}

function nlqCiudadano(contexto) {
  const { consulta, contexto_rag } = contexto.vars;
  return [
    { role: 'system', content: leerPromptRegistrado('nlq_ciudadano') },
    {
      role: 'user',
      content: `Contexto de datos (RAG):\n${contexto_rag}\n\nConsulta del ciudadano:\n${consulta}`,
    },
  ];
}

module.exports = { clasificacionIncidente, nlqCiudadano };
