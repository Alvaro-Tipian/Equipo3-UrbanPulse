#!/usr/bin/env node
// ============================================================================
// Umbrales del dataset dorado (HT-48 CA3)
//
//   node promptfoo/evaluar-umbrales.mjs <salida-promptfoo.json> [informe.md]
//
// Comprueba los dos umbrales que pide el criterio de aceptacion:
//   - 100% de respuestas con JSON valido
//   - precision >= 85% sobre la categoria
//
// Por que no son aserciones de promptfoo: promptfoo falla ante CUALQUIER caso
// erroneo, y la precision admite hasta un 15% de error. El umbral es sobre el
// agregado, no sobre cada fila, asi que hay que calcularlo despues.
//
// La correccion se recalcula desde la RESPUESTA CRUDA del modelo y la etiqueta
// del CSV, no desde el veredicto de promptfoo. Asi este script depende solo de
// que la salida traiga `vars` y el texto generado, que es la parte estable del
// formato; las estructuras internas de grading cambian entre versiones.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , rutaSalida, rutaInforme] = process.argv;

if (!rutaSalida) {
  console.error('Uso: node promptfoo/evaluar-umbrales.mjs <salida-promptfoo.json> [informe.md]');
  process.exit(2);
}

const PRECISION_MINIMA = 0.85;

function extraerCasos(json) {
  // promptfoo ha movido el array de resultados entre versiones; se prueban las
  // ubicaciones conocidas y, si ninguna encaja, se busca en profundidad antes
  // de rendirse con un mensaje que diga que paso.
  const candidatos = [json?.results?.results, json?.results, json?.evalResults];
  for (const candidato of candidatos) {
    if (Array.isArray(candidato) && candidato.some((c) => c && typeof c === 'object' && c.vars)) {
      return candidato;
    }
  }

  const pila = [json];
  while (pila.length) {
    const actual = pila.pop();
    if (Array.isArray(actual)) {
      if (actual.some((c) => c && typeof c === 'object' && c.vars)) return actual;
      pila.push(...actual.filter((c) => c && typeof c === 'object'));
    } else if (actual && typeof actual === 'object') {
      pila.push(...Object.values(actual).filter((c) => c && typeof c === 'object'));
    }
  }
  return null;
}

function textoDeSalida(caso) {
  const bruto = caso.response?.output ?? caso.output ?? caso.response?.raw ?? '';
  return typeof bruto === 'string' ? bruto : JSON.stringify(bruto);
}

// La categoria obtenida sale del modelo, es decir, de texto que no controlamos
// y que acaba dentro de una tabla Markdown del informe.
function escaparCelda(texto) {
  return String(texto ?? '')
    // La barra invertida va PRIMERO: si se escapara despues, duplicaria tambien
    // las que acaba de anadir el escape de la tuberia.
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function parsearJson(texto) {
  const limpio = String(texto)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(limpio);
  } catch {
    return null;
  }
}

const casos = extraerCasos(JSON.parse(readFileSync(rutaSalida, 'utf8')));

if (!casos) {
  console.error(
    `::error::No se encontraron resultados con 'vars' en ${rutaSalida}. ` +
      'Puede que promptfoo haya cambiado el formato de salida; revisa el archivo a mano.',
  );
  process.exit(2);
}

let jsonValido = 0;
let categoriaCorrecta = 0;
let subcategoriaEvaluadas = 0;
let subcategoriaCorrecta = 0;

const errores = [];
const porCategoria = new Map();

for (const caso of casos) {
  const esperada = caso.vars?.categoria_esperada;
  if (!esperada) continue;

  const salida = parsearJson(textoDeSalida(caso));
  if (salida) jsonValido += 1;

  const obtenida = salida?.categoria ?? '(JSON invalido)';
  const acierto = obtenida === esperada;
  if (acierto) categoriaCorrecta += 1;

  const resumen = porCategoria.get(esperada) ?? { total: 0, aciertos: 0 };
  resumen.total += 1;
  if (acierto) resumen.aciertos += 1;
  porCategoria.set(esperada, resumen);

  const subEsperada = caso.vars?.subcategoria_esperada;
  if (subEsperada) {
    subcategoriaEvaluadas += 1;
    if (salida?.subcategoria === subEsperada) subcategoriaCorrecta += 1;
  }

  if (!acierto) {
    errores.push({
      id: caso.vars?.id ?? '?',
      descripcion: String(caso.vars?.descripcion_ciudadano ?? '').slice(0, 70),
      esperada,
      obtenida,
    });
  }
}

const total = [...porCategoria.values()].reduce((suma, r) => suma + r.total, 0);

if (total === 0) {
  console.error('::error::Ningun caso traia categoria_esperada; no hay nada que medir.');
  process.exit(2);
}

const precision = categoriaCorrecta / total;
const tasaJson = jsonValido / total;

const lineas = [
  '# Dataset dorado: clasificador de incidentes',
  '',
  `Evaluado sobre ${total} reportes etiquetados.`,
  '',
  '| Metrica | Umbral | Obtenido | Resultado |',
  '| --- | --- | --- | --- |',
  `| JSON valido | 100% | ${(tasaJson * 100).toFixed(1)}% | ${tasaJson === 1 ? 'OK' : 'FALLA'} |`,
  `| Precision de categoria | >= ${(PRECISION_MINIMA * 100).toFixed(0)}% | ${(precision * 100).toFixed(1)}% | ${
    precision >= PRECISION_MINIMA ? 'OK' : 'FALLA'
  } |`,
  subcategoriaEvaluadas
    ? `| Precision de subcategoria | sin umbral | ${(
        (subcategoriaCorrecta / subcategoriaEvaluadas) * 100
      ).toFixed(1)}% (${subcategoriaEvaluadas} casos) | informativo |`
    : '',
  '',
  '## Por categoria',
  '',
  '| Categoria esperada | Aciertos | Total | Precision |',
  '| --- | --- | --- | --- |',
  ...[...porCategoria.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([categoria, r]) =>
        `| ${categoria} | ${r.aciertos} | ${r.total} | ${((r.aciertos / r.total) * 100).toFixed(1)}% |`,
    ),
  '',
].filter(Boolean);

if (errores.length) {
  lineas.push(
    '## Casos fallidos',
    '',
    '| id | Reporte | Esperado | Obtenido |',
    '| --- | --- | --- | --- |',
    ...errores.map(
      (e) =>
        `| ${e.id} | ${escaparCelda(e.descripcion)} | ${escaparCelda(e.esperada)} |` +
        ` ${escaparCelda(e.obtenida)} |`,
    ),
    '',
  );
}

if (rutaInforme) {
  mkdirSync(dirname(rutaInforme), { recursive: true });
  writeFileSync(rutaInforme, lineas.join('\n'), 'utf8');
  console.log(`Informe escrito en ${rutaInforme}`);
}

console.log(lineas.join('\n'));

let fallo = false;

if (tasaJson < 1) {
  console.error(
    `::error::Solo ${(tasaJson * 100).toFixed(1)}% de las respuestas fueron JSON valido; se exige 100%.`,
  );
  fallo = true;
}

if (precision < PRECISION_MINIMA) {
  console.error(
    `::error::Precision ${(precision * 100).toFixed(1)}% por debajo del minimo ` +
      `${(PRECISION_MINIMA * 100).toFixed(0)}%.`,
  );
  fallo = true;
}

process.exit(fallo ? 1 : 0);
