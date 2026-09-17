import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

// HT-29 T01 - Newman: Robustez de Endpoints GeoJSON.
//
// Ataca los dos webhooks GeoJSON de Open Data reales que HT-26 dejo en
// 'src/n8n-workflows/production/UrbanPulse - Dashboard KPIs vr2.json':
//   GET {{n8n_geojson_onsv_url}}   (query params reales: eps, minpoints)
//   GET {{n8n_geojson_sutran_url}} (sin query params; no filtra por departamento/distrito)
//
// GAP conocido respecto al ticket original: el ticket describe casos sobre
// lat/lng y un filtro 'distrito', pero ninguno de los dos endpoints expone
// esos parametros hoy (ver el nodo Postgres 'Clustering ONSV', que solo lee
// $json.query.eps / $json.query.minpoints, y 'Agregado SUTRAN por
// departamento', que no lee ningun query param). Los casos adversariales se
// mapean a los parametros reales que SI llegan a una consulta SQL:
//   - eps/minpoints en ONSV (unicos valores que interpolan la consulta,
//     aunque via parametro preparado $1/$2 -- se espera que la inyeccion no
//     tenga efecto, pero valores no numericos (NaN) si pueden hacer fallar
//     ST_ClusterDBSCAN y filtrar detalles del error de Postgres/Neon).
//   - 'distrito' se envia como query param extra (no usado por ningun
//     endpoint hoy) para confirmar que parametros desconocidos/maliciosos no
//     rompen el webhook ni se reflejan en la respuesta.
//
// Varios pm.test() de este archivo documentan fallas ESPERADAS hoy (falta
// de validacion de entrada / falta de mensajes de error homogeneos), igual
// que ya hacen 'urbanpulse-llm-robustness' (GAP HT-27/HT-30). Cuando el
// backend valide eps/minpoints y devuelva {error, message} con 400/422,
// estas pruebas deben pasar sin cambios.

const leakedWordsCheck = `
const bodyText = pm.response.text();
const lower = bodyText.toLowerCase();
["stack", "neon", "postgres"].forEach((forbidden) => {
  pm.test(\`No filtra la palabra "\${forbidden}" en el body (evita fugas de infraestructura)\`, () => {
    pm.expect(lower).to.not.include(forbidden);
  });
});
`.trim();

const latencyCheck = `
pm.test("Latencia < 2000ms (no bloquea el pool de conexiones)", () => {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});
`.trim();

function adversarialTest(caseLabel) {
  return [
    `// Caso: {{caso}} (${caseLabel})`,
    "let json = null;",
    "try { json = pm.response.json(); } catch (e) { /* body no-JSON, se valida abajo */ }",
    "",
    'pm.test("[GAP HT-26] Responde 400 o 422 ante entrada adversarial (no 200 ni 500)", () => {',
    "  pm.expect([400, 422]).to.include(pm.response.code);",
    "});",
    "",
    'pm.test("[GAP HT-26] Cuerpo de error con estructura { error, message }", () => {',
    "  pm.expect(json, \"el body debe ser JSON\").to.not.be.null;",
    "  pm.expect(json).to.have.property(\"error\");",
    "  pm.expect(json).to.have.property(\"message\");",
    "});",
    "",
    leakedWordsCheck,
    "",
    latencyCheck,
  ].join("\n");
}

// Los valores del CSV (sql injection, 10000 caracteres) pueden traer
// espacios/comillas invalidos en una URL cruda, asi que se codifican en un
// pre-request script antes de armar la query string.
const encodeVarsScript = [
  "pm.variables.set('eps_enc', encodeURIComponent(pm.iterationData.get('eps') ?? ''));",
  "pm.variables.set('minpoints_enc', encodeURIComponent(pm.iterationData.get('minpoints') ?? ''));",
  "pm.variables.set('distrito_enc', encodeURIComponent(pm.iterationData.get('distrito') ?? ''));",
].join("\n");

function geojsonRequest(name, url, testScript) {
  return {
    name,
    event: [
      {
        listen: "prerequest",
        script: { type: "text/javascript", exec: encodeVarsScript.split("\n") },
      },
      {
        listen: "test",
        script: { type: "text/javascript", exec: testScript.split("\n") },
      },
    ],
    request: {
      method: "GET",
      header: [
        { key: "{{maps_api_key_header}}", value: "{{maps_api_key_value}}" },
      ],
      url: { raw: url, host: [url] },
    },
    response: [],
  };
}

const onsvUrl =
  "{{n8n_geojson_onsv_url}}?eps={{eps_enc}}&minpoints={{minpoints_enc}}&distrito={{distrito_enc}}";
const sutranUrl = "{{n8n_geojson_sutran_url}}?distrito={{distrito_enc}}";

const casosAdversariales = {
  name: "1. Casos adversariales (data-driven via payloads.csv)",
  item: [
    geojsonRequest(
      "1.1 - GeoJSON ONSV con payload adversarial (eps/minpoints/distrito)",
      onsvUrl,
      adversarialTest("mapa-siniestros-onsv")
    ),
    geojsonRequest(
      "1.2 - GeoJSON SUTRAN con payload adversarial (distrito como query param desconocido)",
      sutranUrl,
      adversarialTest("mapa-siniestros-sutran")
    ),
  ],
};

const smoke = {
  name: "2. Smoke test (camino feliz, sin CSV)",
  item: [
    {
      name: "2.1 - GeoJSON ONSV con parametros validos devuelve FeatureCollection",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              'pm.test("Status 200", () => pm.response.to.have.status(200));',
              'pm.test("Devuelve un FeatureCollection valido", () => {',
              "  const json = pm.response.json();",
              '  pm.expect(json.type).to.eql("FeatureCollection");',
              "  pm.expect(json.features).to.be.an(\"array\");",
              "});",
              latencyCheck,
            ].join("\n"),
          },
        },
      ],
      request: {
        method: "GET",
        header: [
          { key: "{{maps_api_key_header}}", value: "{{maps_api_key_value}}" },
        ],
        url: {
          raw: "{{n8n_geojson_onsv_url}}?eps=0.01&minpoints=3",
          host: ["{{n8n_geojson_onsv_url}}?eps=0.01&minpoints=3"],
        },
      },
      response: [],
    },
    {
      name: "2.2 - GeoJSON SUTRAN devuelve FeatureCollection",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              'pm.test("Status 200", () => pm.response.to.have.status(200));',
              'pm.test("Devuelve un FeatureCollection valido", () => {',
              "  const json = pm.response.json();",
              '  pm.expect(json.type).to.eql("FeatureCollection");',
              "  pm.expect(json.features).to.be.an(\"array\");",
              "});",
              latencyCheck,
            ].join("\n"),
          },
        },
      ],
      request: {
        method: "GET",
        header: [
          { key: "{{maps_api_key_header}}", value: "{{maps_api_key_value}}" },
        ],
        url: { raw: "{{n8n_geojson_sutran_url}}", host: ["{{n8n_geojson_sutran_url}}"] },
      },
      response: [],
    },
  ],
};

const collection = {
  info: {
    _postman_id: randomUUID(),
    name: "UrbanPulse - Adversarial GeoJSON (HT-29 T01)",
    description:
      "Coleccion Newman de HT-29 T01. Certifica que los endpoints GeoJSON de Open Data de HT-26 " +
      "(GET {{n8n_geojson_onsv_url}} y GET {{n8n_geojson_sutran_url}}, definidos en " +
      "'src/n8n-workflows/production/UrbanPulse - Dashboard KPIs vr2.json') rechazan payloads " +
      "maliciosos sin caerse ni filtrar informacion sensible (stack traces, 'neon', 'postgres'). " +
      "La carpeta 1 se corre con 'newman run ... -d postman/data/payloads.csv' (una iteracion por " +
      "fila: coordenadas/valores nulos, vacios, fuera de rango, SQL injection y buffer overflow de " +
      "10000 caracteres). La carpeta 2 es un smoke test de camino feliz sin data file.\n\n" +
      "GAP conocido: el ticket original describe filtros lat/lng y 'distrito' que HT-26 todavia no " +
      "expone (los unicos query params reales son eps/minpoints en ONSV; SUTRAN no acepta ninguno). " +
      "Los casos se adaptaron a los parametros reales -- ver comentarios en " +
      "'scripts/build-geojson-adversarial-collection.mjs'. Se espera que varias pruebas [GAP HT-26] " +
      "fallen hoy porque el workflow aun no valida entrada ni homogeneiza errores; sirven para dejar " +
      "constancia del gap hasta que se implemente.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [casosAdversariales, smoke],
};

writeFileSync(
  "postman/collections/urbanpulse-geojson-adversarial.postman_collection.json",
  JSON.stringify(collection, null, 2) + "\n",
  "utf-8"
);

console.log("OK");
