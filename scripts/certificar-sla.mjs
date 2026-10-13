#!/usr/bin/env node
// ============================================================================
// Certificacion de calidad y cumplimiento de SLA (HT-37)
//
//   node scripts/certificar-sla.mjs <salida.md> [--permitir-ausentes]
//
// Consolida los resultados reales de las suites de regresion y emite el
// veredicto. Lee:
//
//   ia-ops/tests/reportes/playwright.json   suite E2E (reporter json)
//   postman/reportes/*.json                 suites Newman (reporter json)
//
// Los dos criterios de aceptacion de HT-37:
//
//   CA1  Todas las pruebas de regresion pasan al 100% sin errores.
//   CA2  Queda un reporte que certifica la calidad y el cumplimiento del SLA.
//
// El SLA de tiempo de respuesta (< 3000 ms) sale de
// docs/PLATFORM_HEALTH_WEBHOOK_CONTRACT.md. Solo se mide sobre las suites
// Newman: son las que ejercitan los webhooks reales. Playwright corre contra
// servidores de Vite en local, donde un tiempo de respuesta no significa nada
// sobre produccion.
//
// UNA SUITE AUSENTE NO SE CERTIFICA. Sin --permitir-ausentes el script falla si
// no encuentra los resultados de alguna: una certificacion que aprueba porque
// falta un archivo no certifica nada.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

const argumentos = process.argv.slice(2);
const permitirAusentes = argumentos.includes('--permitir-ausentes');
const rutaSalida = argumentos.find((a) => !a.startsWith('--')) ?? 'docs/CERTIFICACION_SLA.md';

const SLA_RESPUESTA_MS = 3000;

const RUTA_PLAYWRIGHT = 'ia-ops/tests/reportes/playwright.json';
const DIRECTORIO_NEWMAN = 'postman/reportes';

const suites = [];
const avisos = [];

// --- Playwright -------------------------------------------------------------

function leerPlaywright() {
  if (!existsSync(RUTA_PLAYWRIGHT)) {
    avisos.push(`No se encontro el reporte de Playwright en ${RUTA_PLAYWRIGHT}.`);
    return;
  }

  const informe = JSON.parse(readFileSync(RUTA_PLAYWRIGHT, 'utf8'));

  let total = 0;
  let fallidos = 0;
  let omitidos = 0;
  let inestables = 0;
  const nombresFallidos = [];
  const defectosConocidos = [];

  // El json de Playwright anida suites dentro de suites; se recorre entero en
  // vez de asumir un solo nivel.
  const pendientes = [...(informe.suites ?? [])];
  while (pendientes.length) {
    const suite = pendientes.pop();
    pendientes.push(...(suite.suites ?? []));

    for (const spec of suite.specs ?? []) {
      for (const prueba of spec.tests ?? []) {
        total += 1;

        // `test.status` es el campo con autoridad: 'expected' significa que el
        // resultado fue el previsto, incluso cuando el resultado previsto era
        // fallar. Mirar solo `results[].status` marcaria como rotas las pruebas
        // anotadas con test.fail(), que Playwright cuenta como verdes.
        const estado = prueba.status ?? 'unknown';
        const ultimo = prueba.results?.at(-1)?.status ?? 'unknown';

        if (estado === 'skipped') {
          omitidos += 1;
        } else if (estado === 'unexpected') {
          fallidos += 1;
          nombresFallidos.push(spec.title);
        } else if (estado === 'flaky') {
          // Pasó al reintentar. No rompe el build de Playwright, pero una suite
          // inestable no puede sostener una certificacion de calidad.
          inestables += 1;
          nombresFallidos.push(`${spec.title} (inestable: pasó al reintentar)`);
        } else if (estado === 'expected' && ultimo === 'failed') {
          // test.fail(): defecto conocido y aceptado de la aplicacion. No rompe
          // la suite, pero tiene que figurar en la certificacion: declarar
          // "100% en verde" sin nombrarlos ocultaria fallos reales y ya
          // documentados (D-14, D-15, D-16).
          defectosConocidos.push(spec.title);
        }
      }
    }
  }

  suites.push({
    nombre: 'Playwright (E2E)',
    total,
    fallidos: fallidos + inestables,
    omitidos,
    nombresFallidos,
    defectosConocidos,
    duracionMs: Math.round(informe.stats?.duration ?? 0) || null,
    midenSla: false,
  });
}

// --- Newman -----------------------------------------------------------------

function leerNewman() {
  if (!existsSync(DIRECTORIO_NEWMAN)) {
    avisos.push(
      `No se encontro ${DIRECTORIO_NEWMAN}. Las suites Newman corren contra los ` +
        'webhooks de produccion y necesitan secrets, asi que solo se generan en CI.',
    );
    return;
  }

  const archivos = readdirSync(DIRECTORIO_NEWMAN).filter((f) => f.endsWith('.json'));
  if (archivos.length === 0) {
    avisos.push(`${DIRECTORIO_NEWMAN} no contiene reportes json de Newman.`);
    return;
  }

  for (const archivo of archivos) {
    const informe = JSON.parse(readFileSync(join(DIRECTORIO_NEWMAN, archivo), 'utf8'));
    const resumen = informe.run?.stats ?? {};

    const ejecuciones = informe.run?.executions ?? [];
    const tiempos = ejecuciones
      .map((e) => e.response?.responseTime)
      .filter((t) => typeof t === 'number');

    const lentas = ejecuciones
      .filter((e) => (e.response?.responseTime ?? 0) > SLA_RESPUESTA_MS)
      .map((e) => ({
        nombre: e.item?.name ?? 'sin nombre',
        ms: e.response?.responseTime,
      }));

    const nombresFallidos = (informe.run?.failures ?? []).map(
      (f) => `${f.source?.name ?? 'sin nombre'}: ${f.error?.message ?? 'sin detalle'}`,
    );

    suites.push({
      nombre: `Newman · ${basename(archivo, '.json')}`,
      total: resumen.assertions?.total ?? 0,
      fallidos: resumen.assertions?.failed ?? 0,
      omitidos: 0,
      nombresFallidos,
      duracionMs: informe.run?.timings?.completed - informe.run?.timings?.started || null,
      midenSla: true,
      tiempoMaximoMs: tiempos.length ? Math.max(...tiempos) : null,
      tiempoMedioMs: tiempos.length
        ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length)
        : null,
      lentas,
    });
  }
}

leerPlaywright();
leerNewman();

// --- Veredicto --------------------------------------------------------------

const totalPruebas = suites.reduce((s, x) => s + x.total, 0);
const totalFallidos = suites.reduce((s, x) => s + x.fallidos, 0);
const violacionesSla = suites.flatMap((s) => (s.lentas ?? []).map((l) => ({ suite: s.nombre, ...l })));

const sinResultados = suites.length === 0;
const certificado = !sinResultados && totalFallidos === 0 && violacionesSla.length === 0 && (permitirAusentes || avisos.length === 0);

function ms(valor) {
  return valor == null ? 'n/d' : `${valor} ms`;
}

const lineas = [
  '# Certificacion de calidad y cumplimiento de SLA',
  '',
  `**Fecha:** ${new Date().toISOString().slice(0, 10)}`,
  `**Veredicto:** ${certificado ? 'CERTIFICADO' : 'NO CERTIFICADO'}`,
  '',
  'Generado por `scripts/certificar-sla.mjs` a partir de los resultados reales de',
  'las suites. No se edita a mano.',
  '',
  '## Criterio 1 · Las pruebas de regresion pasan al 100%',
  '',
  '| Suite | Pruebas | Fallidas | Omitidas | Duracion |',
  '| --- | --- | --- | --- | --- |',
  ...suites.map(
    (s) => `| ${s.nombre} | ${s.total} | ${s.fallidos} | ${s.omitidos} | ${ms(s.duracionMs)} |`,
  ),
  `| **Total** | **${totalPruebas}** | **${totalFallidos}** | | |`,
  '',
];

const conFallos = suites.filter((s) => s.fallidos > 0);
if (conFallos.length) {
  lineas.push('### Pruebas fallidas', '');
  for (const suite of conFallos) {
    lineas.push(`**${suite.nombre}**`, '');
    lineas.push(...suite.nombresFallidos.map((n) => `- ${n}`), '');
  }
}

const defectos = suites.flatMap((s) =>
  (s.defectosConocidos ?? []).map((titulo) => ({ suite: s.nombre, titulo })),
);

if (defectos.length) {
  lineas.push(
    '### Defectos conocidos y aceptados',
    '',
    `${defectos.length} prueba(s) estan anotadas con \`test.fail()\`: documentan defectos`,
    'reales de la aplicacion que el equipo decidio aceptar por ahora. Playwright las',
    'cuenta como verdes porque el resultado es el previsto, pero figuran aqui porque',
    'una certificacion de calidad que no las nombre estaria ocultando fallos conocidos.',
    'La suite avisara en cuanto se corrijan.',
    '',
    ...defectos.map((d) => `- ${d.titulo}`),
    '',
  );
}

lineas.push(
  `## Criterio 2 · Tiempo de respuesta por debajo del SLA (< ${SLA_RESPUESTA_MS} ms)`,
  '',
);

const suitesConSla = suites.filter((s) => s.midenSla);
if (suitesConSla.length === 0) {
  lineas.push(
    'No hay mediciones de tiempo de respuesta en esta corrida. El SLA se mide sobre',
    'las suites Newman, que ejercitan los webhooks reales; Playwright corre contra',
    'servidores de Vite en local y sus tiempos no dicen nada sobre produccion.',
    '',
  );
} else {
  lineas.push(
    '| Suite | Tiempo medio | Tiempo maximo | Peticiones fuera de SLA |',
    '| --- | --- | --- | --- |',
    ...suitesConSla.map(
      (s) =>
        `| ${s.nombre} | ${ms(s.tiempoMedioMs)} | ${ms(s.tiempoMaximoMs)} | ${s.lentas.length} |`,
    ),
    '',
  );

  if (violacionesSla.length) {
    lineas.push(
      '### Peticiones que incumplen el SLA',
      '',
      '| Suite | Peticion | Tiempo |',
      '| --- | --- | --- |',
      ...violacionesSla.map((v) => `| ${v.suite} | ${v.nombre} | ${ms(v.ms)} |`),
      '',
    );
  }
}

if (avisos.length) {
  lineas.push(
    '## Suites sin resultados',
    '',
    'Una certificacion que aprueba porque falta un archivo no certifica nada, asi',
    'que estas ausencias impiden certificar salvo que se pase `--permitir-ausentes`.',
    '',
    ...avisos.map((a) => `- ${a}`),
    '',
  );
}

lineas.push(
  '## Conclusion',
  '',
  certificado
    ? `Se certifica el cumplimiento: ${totalPruebas} pruebas de regresion en verde y ` +
      `ningun tiempo de respuesta por encima de ${SLA_RESPUESTA_MS} ms.` +
      (defectos.length
        ? ` Quedan ${defectos.length} defecto(s) conocidos y aceptados, listados arriba.`
        : '')
    : 'No se puede certificar. Revisar los apartados anteriores.',
  '',
);

mkdirSync(dirname(rutaSalida), { recursive: true });
writeFileSync(rutaSalida, lineas.join('\n'), 'utf8');

console.log(lineas.join('\n'));
console.log(`\nInforme escrito en ${rutaSalida}`);

if (!certificado) {
  console.error('::error::No se pudo certificar el cumplimiento de calidad y SLA.');
  process.exit(1);
}
