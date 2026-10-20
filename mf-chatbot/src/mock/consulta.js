
const CON_INFORMACION = {
  tipo: 'consulta',
  respuesta:
    'En la franja de noche, la Av. Abancay registra 9 siniestros en los últimos 12 meses, sobre todo atropellos ' +
    'cerca del cruce con Jr. Ucayali. Se recomienda cruzar por los semáforos y evitar el tramo frente al mercado.',
  fuentes: [
    { distrito: 'Cercado de Lima', franja: 'noche', fuente: 'SUTRAN (corte 30/09/2026)' },
    { distrito: 'Cercado de Lima', franja: 'noche', fuente: 'Reportes ciudadanos resueltos' },
  ],
  sin_informacion: false,
};

const SIN_INFORMACION = {
  tipo: 'consulta',
  respuesta: 'No encontré información sobre esa zona en las fuentes disponibles, así que prefiero no darte una respuesta inventada.',
  fuentes: [],
  sin_informacion: true,
};

export function respuestaMockConsulta(texto) {
  const t = texto.trim().toLowerCase();
  if (!t.endsWith('?')) return null; // no es consulta: sigue el flujo normal de reporte
  return new Promise((resolve) =>
    setTimeout(() => resolve(t.includes('marte') ? SIN_INFORMACION : CON_INFORMACION), 600)
  );
}