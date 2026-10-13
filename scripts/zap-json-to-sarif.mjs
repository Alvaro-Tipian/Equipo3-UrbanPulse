#!/usr/bin/env node
// ============================================================================
// Convierte el reporte JSON de OWASP ZAP a SARIF 2.1.0 (HT-45 T03)
//
//   node scripts/zap-json-to-sarif.mjs <reporte-zap.json> <salida.sarif> [etiqueta]
//
// GitHub Code Scanning solo ingiere SARIF, y las acciones oficiales de ZAP
// (zaproxy/action-baseline y action-api-scan) emiten JSON/HTML/Markdown pero no
// SARIF. Este conversor cierra esa brecha para que los hallazgos DAST aparezcan
// en la pestana Security junto a los de CodeQL (SAST) y Trivy (contenedores).
//
// La "etiqueta" distingue la corrida (baseline / api-scan) en los ruleId, para
// que un mismo riesgo encontrado por ambos escaneos no se deduplique entre si.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , rutaEntrada, rutaSalida, etiqueta = 'zap'] = process.argv;

if (!rutaEntrada || !rutaSalida) {
  console.error('Uso: node scripts/zap-json-to-sarif.mjs <reporte-zap.json> <salida.sarif> [etiqueta]');
  process.exit(2);
}

// ZAP puntua el riesgo de 0 (informativo) a 3 (alto). SARIF solo distingue
// error/warning/note, asi que Alto y Medio se reportan como "warning" y el
// resto como "note": el gate de build lo decide .zap/rules.tsv, no el SARIF.
const NIVEL_SARIF = { 3: 'error', 2: 'warning', 1: 'warning', 0: 'note' };
const NOMBRE_RIESGO = { 3: 'Alto', 2: 'Medio', 1: 'Bajo', 0: 'Informativo' };

// El texto que entra aqui viene de los campos descriptivos de ZAP, que a su vez
// pueden arrastrar contenido del sitio escaneado (evidencias, parametros
// reflejados). Es decir: contenido potencialmente controlado por un atacante que
// termina en la pestana Security del repositorio. Por eso la limpieza se hace
// con cuidado y no con un unico replace.
function aTextoPlano(html) {
  if (!html) return '';

  // Las entidades se decodifican ANTES de quitar etiquetas. Al reves,
  // "&lt;script&gt;" sobreviviria intacto a la limpieza y reapareceria como
  // "<script>" ya en la salida.
  //
  // Y "&amp;" se decodifica en ultimo lugar: hacerlo antes convertiria
  // "&amp;lt;" en "<" en vez de en el literal "&lt;" (doble desescapado).
  let texto = String(html)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<\/?p\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  // Se repite hasta que deje de haber cambios: una sola pasada permite que
  // construcciones anidadas como "<<script>script>" vuelvan a formar una
  // etiqueta valida justo despues de borrar la interior.
  let previo;
  do {
    previo = texto;
    texto = texto.replace(/<[^>]*>/g, '');
  } while (texto !== previo);

  return texto.replace(/\n{3,}/g, '\n\n').trim();
}

// GitHub interpreta artifactLocation.uri como una ruta de archivo, asi que la
// ubicacion se queda solo con el pathname: la query completa viaja en el
// mensaje del hallazgo, donde no rompe el renderizado.
function rutaDeUrl(uri) {
  try {
    return new URL(uri).pathname || '/';
  } catch {
    return uri || '/';
  }
}

const reporte = JSON.parse(readFileSync(rutaEntrada, 'utf8'));
const sitios = Array.isArray(reporte.site) ? reporte.site : [reporte.site].filter(Boolean);

const reglas = new Map();
const resultados = [];

for (const sitio of sitios) {
  for (const alerta of sitio.alerts ?? []) {
    const riesgo = Number.parseInt(alerta.riskcode ?? '0', 10);
    const idRegla = `${etiqueta}/${alerta.pluginid ?? 'sin-plugin'}`;

    if (!reglas.has(idRegla)) {
      const ayuda = [
        aTextoPlano(alerta.desc),
        alerta.solution ? `Solucion sugerida:\n${aTextoPlano(alerta.solution)}` : '',
        alerta.reference ? `Referencias:\n${aTextoPlano(alerta.reference)}` : '',
        alerta.cweid && alerta.cweid !== '-1' ? `CWE-${alerta.cweid}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      reglas.set(idRegla, {
        id: idRegla,
        name: (alerta.alert ?? alerta.name ?? 'Alerta ZAP').replace(/[^\w]/g, ''),
        shortDescription: { text: alerta.alert ?? alerta.name ?? 'Alerta ZAP' },
        fullDescription: { text: aTextoPlano(alerta.desc) || 'Sin descripcion.' },
        help: { text: ayuda || 'Sin detalle adicional.' },
        defaultConfiguration: { level: NIVEL_SARIF[riesgo] ?? 'note' },
        properties: {
          tags: [
            'seguridad',
            'dast',
            'owasp-zap',
            etiqueta,
            ...(alerta.cweid && alerta.cweid !== '-1' ? [`CWE-${alerta.cweid}`] : []),
          ],
          precision: (alerta.confidence ?? '2') >= '3' ? 'high' : 'medium',
          'security-severity': String(riesgo * 3),
        },
      });
    }

    // Una alerta de ZAP agrupa N instancias (una por URL afectada). SARIF
    // espera un result por instancia para que GitHub las cuente por separado.
    const instancias = alerta.instances?.length ? alerta.instances : [{ uri: sitio['@name'] }];

    for (const instancia of instancias) {
      const detalle = [
        `Riesgo ZAP: ${NOMBRE_RIESGO[riesgo] ?? 'Desconocido'}`,
        `URL: ${instancia.uri ?? 'n/d'}`,
        instancia.method ? `Metodo: ${instancia.method}` : '',
        instancia.param ? `Parametro: ${instancia.param}` : '',
        instancia.evidence ? `Evidencia: ${instancia.evidence}` : '',
      ]
        .filter(Boolean)
        .join(' | ');

      resultados.push({
        ruleId: idRegla,
        level: NIVEL_SARIF[riesgo] ?? 'note',
        message: { text: `${alerta.alert ?? 'Alerta ZAP'} - ${detalle}` },
        locations: [
          {
            physicalLocation: {
              // SARIF exige una ubicacion "fisica". En DAST no hay archivo
              // fuente, asi que se usa la ruta de la URL como artefacto
              // sintetico; GitHub la muestra como la ubicacion del hallazgo.
              artifactLocation: { uri: rutaDeUrl(instancia.uri) },
              region: { startLine: 1 },
            },
          },
        ],
        partialFingerprints: {
          zapAlerta: `${etiqueta}:${alerta.pluginid}:${instancia.method ?? 'GET'}:${rutaDeUrl(
            instancia.uri,
          )}:${instancia.param ?? ''}`,
        },
      });
    }
  }
}

const sarif = {
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: `OWASP ZAP (${etiqueta})`,
          informationUri: 'https://www.zaproxy.org/',
          version: reporte['@version'] ?? 'desconocida',
          rules: [...reglas.values()],
        },
      },
      results: resultados,
    },
  ],
};

mkdirSync(dirname(rutaSalida), { recursive: true });
writeFileSync(rutaSalida, JSON.stringify(sarif, null, 2), 'utf8');

console.log(
  `SARIF generado en ${rutaSalida}: ${resultados.length} hallazgo(s) sobre ${reglas.size} regla(s) [${etiqueta}].`,
);
