// Convierte las 30 preguntas doradas en casos de promptfoo (HT-50 T05).
//
// El dataset guarda claves de fichas, no su texto: asi cada caso reproduce lo
// que haria el recuperador (hasta 5 fichas de conocimiento_vial) y una ficha
// corregida en rag-fichas.json se refleja en todas las preguntas que la usan.

const { PREGUNTAS, construirContexto } = require('./rag-reglas.js');

// Fraccion minima de afirmaciones de la respuesta que el juez debe encontrar
// respaldadas por las fichas.
const FIDELIDAD_MINIMA = 0.8;

module.exports = () =>
  PREGUNTAS.map((pregunta) => {
    const contexto = construirContexto(pregunta.fichas);
    const assert = [{ type: 'javascript', value: 'file://rag-asercion.js', metric: pregunta.tipo }];

    // La fidelidad necesita un juez: una respuesta puede traer el dato correcto
    // y ademas anadir otro inventado, y eso no lo ve ninguna regex. Solo donde
    // hay fichas legitimas contra las que contrastar.
    if (pregunta.tipo === 'fidelidad' || pregunta.tipo === 'relevancia') {
      assert.push({ type: 'context-faithfulness', threshold: FIDELIDAD_MINIMA, metric: 'fidelidad_juez' });
    }

    return {
      description: `${pregunta.id} [${pregunta.tipo}] ${pregunta.descripcion ?? pregunta.consulta}`,
      vars: {
        id: pregunta.id,
        consulta: pregunta.consulta,
        contexto_rag: contexto,
        // Nombres que exige context-faithfulness.
        query: pregunta.consulta,
        context: contexto,
      },
      assert,
    };
  });
