// Asercion de promptfoo para la suite del RAG (HT-50 T05): aplica las reglas
// deterministas de rag-reglas.js a la respuesta del modelo.

const { PREGUNTAS, evaluarRespuesta } = require('./rag-reglas.js');

module.exports = (output, context) => {
  const pregunta = PREGUNTAS.find((p) => p.id === context.vars.id);
  if (!pregunta) {
    return { pass: false, score: 0, reason: `La pregunta '${context.vars.id}' no esta en el dataset dorado` };
  }
  const fallos = evaluarRespuesta(pregunta, output);
  return {
    pass: fallos.length === 0,
    score: fallos.length === 0 ? 1 : 0,
    reason: fallos.length === 0 ? 'Cumple las reglas del RAG' : fallos.join('; '),
  };
};
