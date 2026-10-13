// Ejecuta el jsCode de un nodo Code de un workflow de n8n con las mismas
// variables que n8n le da en modo "Run Once for All Items" ($input, $(...),
// require). Lee de stdin {"entrada": [...], "nodos": {"<nombre>": [...]}} y
// escribe en stdout los items que devuelve el nodo.
//
//   node ejecutar_nodo.mjs <workflow.json> "<nombre del nodo>" < entrada.json
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const [ruta, nombre] = process.argv.slice(2);
const workflow = JSON.parse(readFileSync(ruta, 'utf8'));
const nodo = workflow.nodes.find((n) => n.name === nombre);
if (!nodo || !nodo.parameters.jsCode) {
  console.error(`No hay un nodo Code llamado "${nombre}" en ${ruta}`);
  process.exit(2);
}

const datos = JSON.parse(readFileSync(0, 'utf8'));
const items = (lista) => (lista || []).map((json) => ({ json }));
const entrada = items(datos.entrada);
const $input = { all: () => entrada, first: () => entrada[0], item: entrada[0] };
const $ = (otro) => {
  if (!datos.nodos || !(otro in datos.nodos)) throw new Error(`El nodo pidio la salida de "${otro}"`);
  const salida = items(datos.nodos[otro]);
  return { all: () => salida, first: () => salida[0] };
};
// n8n solo permite los modulos de NODE_FUNCTION_ALLOW_BUILTIN (crypto).
const requireReal = createRequire(import.meta.url);
const require = (m) => {
  if (m !== 'crypto') throw new Error(`Modulo no permitido en n8n: ${m}`);
  return requireReal(m);
};

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const fn = new AsyncFunction('$input', '$', 'require', nodo.parameters.jsCode);
try {
  const resultado = await fn($input, $, require);
  process.stdout.write(JSON.stringify(resultado.map((i) => i.json)));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message }));
  process.exit(1);
}
