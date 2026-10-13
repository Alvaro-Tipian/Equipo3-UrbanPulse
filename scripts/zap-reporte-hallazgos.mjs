#!/usr/bin/env node
// ============================================================================
// Informe de hallazgos DAST y gate de riesgo alto (HT-45 T04/T05)
//
//   node scripts/zap-reporte-hallazgos.mjs <entrada.sarif> <informe.md> [--sin-gate]
//
// Hace dos cosas que el criterio de aceptacion pide juntas:
//
//   CA2 - Los hallazgos de riesgo ALTO bloquean el paso a produccion. El script
//         termina con codigo 1 si encuentra alguno, lo que tumba el job y, con
//         el workflow puesto como check requerido, frena la promocion.
//
//   CA3 - Queda un informe con la clasificacion de cada hallazgo y la accion
//         tomada. La clasificacion sale del riesgo que asigno ZAP; la accion,
//         de .zap/rules.tsv, que es donde el equipo decidio por escrito que
//         hacer con cada regla.
//
// Cruzar ambas fuentes es el punto: un listado de alertas sin la decision al
// lado no dice si el equipo ya miro ese hallazgo y lo acepto, o si nadie lo ha
// visto nunca.
//
// --sin-gate genera el informe sin romper el build, para corridas exploratorias.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const argumentos = process.argv.slice(2);
const sinGate = argumentos.includes('--sin-gate');
const [rutaSarif, rutaInforme] = argumentos.filter((a) => !a.startsWith('--'));

if (!rutaSarif || !rutaInforme) {
  console.error('Uso: node scripts/zap-reporte-hallazgos.mjs <entrada.sarif> <informe.md> [--sin-gate]');
  process.exit(2);
}

const RUTA_REGLAS = '.zap/rules.tsv';

// El conversor a SARIF guarda el riesgo de ZAP en security-severity como
// riskcode*3, y el nivel SARIF colapsa Medio y Bajo en "warning". Se recupera
// el riesgo original desde ahi para poder clasificar con el detalle que pide
// el informe.
const RIESGO_POR_SEVERIDAD = { 9: 'Alto', 6: 'Medio', 3: 'Bajo', 0: 'Informativo' };
const ORDEN_RIESGO = { Alto: 0, Medio: 1, Bajo: 2, Informativo: 3, Desconocido: 4 };

function leerAcciones() {
  if (!existsSync(RUTA_REGLAS)) return new Map();

  const acciones = new Map();
  for (const linea of readFileSync(RUTA_REGLAS, 'utf8').split('\n')) {
    if (!linea.trim() || linea.trimStart().startsWith('#')) continue;
    const [id, accion, ...resto] = linea.split('\t');
    if (!id || !accion) continue;
    acciones.set(id.trim(), {
      accion: accion.trim(),
      justificacion: resto.join('\t').trim(),
    });
  }
  return acciones;
}

const acciones = leerAcciones();
const sarif = JSON.parse(readFileSync(rutaSarif, 'utf8'));

const hallazgos = [];

for (const corrida of sarif.runs ?? []) {
  const reglas = new Map((corrida.tool?.driver?.rules ?? []).map((r) => [r.id, r]));

  for (const resultado of corrida.results ?? []) {
    const regla = reglas.get(resultado.ruleId);
    const severidad = Number(regla?.properties?.['security-severity'] ?? -1);
    // ruleId tiene la forma "<etiqueta>/<pluginid de ZAP>"; rules.tsv indexa
    // por el pluginid a secas.
    const idPlugin = String(resultado.ruleId ?? '').split('/').pop();

    const decidido = acciones.get(idPlugin);

    hallazgos.push({
      alerta: regla?.shortDescription?.text ?? resultado.ruleId,
      riesgo: RIESGO_POR_SEVERIDAD[severidad] ?? 'Desconocido',
      idPlugin,
      ubicacion: resultado.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? 'n/d',
      detalle: resultado.message?.text ?? '',
      // Sin entrada en rules.tsv la regla no se ha revisado nunca: eso es
      // informacion, no un vacio, y el informe lo dice tal cual.
      accion: decidido?.accion ?? 'SIN REVISAR',
      justificacion: decidido?.justificacion ?? 'Regla no registrada en .zap/rules.tsv',
    });
  }
}

hallazgos.sort((a, b) => ORDEN_RIESGO[a.riesgo] - ORDEN_RIESGO[b.riesgo]);

const conteo = hallazgos.reduce((acumulado, h) => {
  acumulado[h.riesgo] = (acumulado[h.riesgo] ?? 0) + 1;
  return acumulado;
}, {});

const altos = hallazgos.filter((h) => h.riesgo === 'Alto');
const sinRevisar = hallazgos.filter((h) => h.accion === 'SIN REVISAR');

function escapar(texto) {
  return String(texto)
    // La barra invertida va PRIMERO: si se escapara despues, duplicaria tambien
    // las que acaba de anadir el escape de la tuberia y el texto saldria roto.
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

const lineas = [
  '# Informe de hallazgos DAST (OWASP ZAP)',
  '',
  `Generado el ${new Date().toISOString().slice(0, 10)} a partir de \`${rutaSarif}\`.`,
  '',
  '## Resumen',
  '',
  '| Clasificacion | Hallazgos |',
  '| --- | --- |',
  ...['Alto', 'Medio', 'Bajo', 'Informativo', 'Desconocido']
    .filter((riesgo) => conteo[riesgo])
    .map((riesgo) => `| ${riesgo} | ${conteo[riesgo]} |`),
  `| **Total** | **${hallazgos.length}** |`,
  '',
];

if (hallazgos.length === 0) {
  lineas.push('No se registraron hallazgos en este escaneo.', '');
} else {
  lineas.push(
    '## Detalle',
    '',
    'La accion sale de `.zap/rules.tsv`: `FAIL` rompe el build, `WARN` solo informa,',
    '`IGNORE` esta aceptado con justificacion escrita.',
    '',
    '| Clasificacion | Hallazgo | Regla | Ubicacion | Accion tomada | Justificacion |',
    '| --- | --- | --- | --- | --- | --- |',
    ...hallazgos.map(
      (h) =>
        `| ${h.riesgo} | ${escapar(h.alerta)} | ${h.idPlugin} | \`${escapar(h.ubicacion)}\` |` +
        ` ${h.accion} | ${escapar(h.justificacion)} |`,
    ),
    '',
  );
}

if (sinRevisar.length) {
  lineas.push(
    '## Reglas sin revisar',
    '',
    `${sinRevisar.length} hallazgo(s) vienen de reglas que no estan en \`.zap/rules.tsv\`.`,
    'Hay que decidir por cada una si se acepta (`IGNORE`, con justificacion), se vigila',
    '(`WARN`) o debe romper el build (`FAIL`).',
    '',
  );
}

lineas.push(
  '## Veredicto',
  '',
  altos.length
    ? `**Bloqueado.** ${altos.length} hallazgo(s) de riesgo alto impiden la promocion a produccion.`
    : '**Sin hallazgos de riesgo alto.** No hay bloqueo para la promocion a produccion.',
  '',
);

mkdirSync(dirname(rutaInforme), { recursive: true });
writeFileSync(rutaInforme, lineas.join('\n'), 'utf8');

console.log(`Informe escrito en ${rutaInforme}`);
console.log(
  `Hallazgos: ${hallazgos.length} (alto: ${conteo.Alto ?? 0}, medio: ${conteo.Medio ?? 0}, ` +
    `bajo: ${conteo.Bajo ?? 0}, informativo: ${conteo.Informativo ?? 0})`,
);

if (altos.length && !sinGate) {
  console.error(`::error::${altos.length} hallazgo(s) DAST de riesgo alto bloquean el paso a produccion.`);
  for (const hallazgo of altos) {
    console.error(`  - [${hallazgo.idPlugin}] ${hallazgo.alerta} en ${hallazgo.ubicacion}`);
  }
  process.exit(1);
}
