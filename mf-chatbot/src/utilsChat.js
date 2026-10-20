// Funciones auxiliares del chat (separadas de los componentes por la regla
// react-refresh/only-export-components: un .jsx solo debe exportar componentes).

// HT-50 / T04: ¿la respuesta del webhook es una consulta RAG (contrato 4.8)?
export function esConsulta(data) {
  return data?.tipo === 'consulta';
}

// Resumen de confirmación que envía n8n en texto plano:
//   "Este es tu reporte: 📝 Descripción: ... 📷 Foto: ... 📍 Ubicación: lat, lng ¿Confirmas el envío? ..."
const PATRON = /Descripci[oó]n:\s*(.*?)\s*📷\s*Foto:\s*(.*?)\s*📍\s*Ubicaci[oó]n:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/is;

export function parsearResumen(texto) {
  if (typeof texto !== 'string' || !/confirmas el env[ií]o/i.test(texto)) return null;
  const m = texto.match(PATRON);
  if (!m) return null;
  return {
    descripcion: m[1].trim(),
    fotoAdjunta: !/^no\b/i.test(m[2].trim()),
    lat: Number(m[3]),
    lng: Number(m[4]),
  };
}