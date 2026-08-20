#!/usr/bin/env node
/**
 * Verificación end-to-end de la PoC desplegada de UrbanPulse.
 *
 * Recorre, en orden, cada componente de la arquitectura desplegada:
 *   1. Frontend (Vercel)      -> responde y sirve el HTML esperado.
 *   2. Webhook n8n (Render)   -> procesa un reporte de prueba y devuelve
 *                                los campos clasificados.
 *   3. PostgreSQL (Neon)      -> el reporte quedó persistido con los
 *                                mismos valores que devolvió el webhook.
 *
 * Requisitos: Node.js y el cliente `psql` de PostgreSQL instalado y
 * disponible en el PATH del sistema (no hace falta instalar ningún paquete
 * npm). El paso 3 invoca `psql` directamente para consultar la base de datos.
 *
 * Uso:
 *   node scripts/verify-poc-deployment.js
 *
 * Variables de entorno requeridas: ver .env.example
 * (FRONTEND_URL, N8N_WEBHOOK_URL, DB_HOST, DB_PORT, DB_DATABASE, DB_USER,
 * DB_PASSWORD).
 */

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEST_PAYLOAD = {
  description: "Prueba automatizada de verificación PoC",
  latitude: -12.04,
  longitude: -77.04,
};

const results = {
  frontend: false,
  webhook: false,
  database: false,
};

function logOk(message) {
  console.log(`✅ ${message}`);
}

function logFail(message) {
  console.log(`❌ ${message}`);
}

function logStep(title) {
  console.log(`\n--- ${title} ---`);
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(", ")}`);
  }
}

async function verifyFrontend() {
  logStep("1. Frontend (Vercel)");
  try {
    requireEnv(["FRONTEND_URL"]);
    const url = process.env.FRONTEND_URL;

    const response = await fetch(url);
    if (response.status !== 200) {
      logFail(`GET ${url} respondió con estado ${response.status} (esperado 200).`);
      return;
    }

    const html = await response.text();
    if (!html.includes("UrbanPulse")) {
      logFail(`GET ${url} respondió 200 pero el HTML no contiene el texto "UrbanPulse".`);
      return;
    }

    logOk(`GET ${url} respondió 200 y el HTML contiene "UrbanPulse".`);
    results.frontend = true;
  } catch (error) {
    logFail(`Error verificando el frontend: ${error.message}`);
  }
}

async function verifyWebhook() {
  logStep("2. Webhook n8n (Render)");
  try {
    requireEnv(["N8N_WEBHOOK_URL"]);
    const url = process.env.N8N_WEBHOOK_URL;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TEST_PAYLOAD),
    });

    if (response.status !== 200) {
      const body = await response.text().catch(() => "");
      logFail(`POST ${url} respondió con estado ${response.status} (esperado 200). Cuerpo: ${body}`);
      return null;
    }

    const report = await response.json();
    const requiredFields = ["id", "incident_type", "severity", "priority", "status"];
    const missingFields = requiredFields.filter(
      (field) => report[field] === undefined || report[field] === null
    );

    if (missingFields.length > 0) {
      logFail(
        `POST ${url} respondió 200 pero faltan campos en el JSON: ${missingFields.join(", ")}. ` +
          `Recibido: ${JSON.stringify(report)}`
      );
      return null;
    }

    logOk(
      `POST ${url} respondió 200 con id=${report.id}, incident_type=${report.incident_type}, ` +
        `severity=${report.severity}, priority=${report.priority}, status=${report.status}.`
    );
    results.webhook = true;
    return report;
  } catch (error) {
    logFail(`Error verificando el webhook: ${error.message}`);
    return null;
  }
}

function buildConnectionString() {
  const user = encodeURIComponent(process.env.DB_USER);
  const password = encodeURIComponent(process.env.DB_PASSWORD);
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT;
  const database = process.env.DB_DATABASE;
  return `postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=require`;
}

function parsePsqlRows(stdout) {
  const columns = ["id", "description", "incident_type", "severity", "priority", "status", "latitude", "longitude"];

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const values = line.split("|");
      const row = {};
      columns.forEach((column, index) => {
        row[column] = values[index];
      });
      return row;
    });
}

async function fetchReportRowsFromDb(id) {
  const connectionString = buildConnectionString();
  const query = `SELECT id, description, incident_type, severity, priority, status, latitude, longitude FROM reports WHERE id = '${id}'`;

  const { stdout } = await execFileAsync(
    "psql",
    [connectionString, "-t", "-A", "-F", "|", "-c", query],
    { timeout: 15000 }
  );

  return parsePsqlRows(stdout);
}

async function verifyDatabase(webhookReport) {
  logStep("3. PostgreSQL (Neon)");

  if (!webhookReport) {
    logFail("Se omite la verificación de base de datos: el paso 2 (webhook) no devolvió un reporte válido.");
    return;
  }

  try {
    requireEnv(["DB_HOST", "DB_PORT", "DB_DATABASE", "DB_USER", "DB_PASSWORD"]);

    if (!UUID_REGEX.test(String(webhookReport.id))) {
      logFail(`El id devuelto por el webhook no tiene formato UUID válido: ${JSON.stringify(webhookReport.id)}`);
      return;
    }

    const rows = await fetchReportRowsFromDb(webhookReport.id);

    if (rows.length !== 1) {
      logFail(`Se esperaba exactamente 1 registro con id=${webhookReport.id}, se encontraron ${rows.length}.`);
      return;
    }

    const row = rows[0];
    const mismatches = [];

    for (const field of ["incident_type", "severity", "status"]) {
      if (row[field] !== webhookReport[field]) {
        mismatches.push(`${field}: DB=${JSON.stringify(row[field])} vs webhook=${JSON.stringify(webhookReport[field])}`);
      }
    }

    if (Number(row.priority) !== Number(webhookReport.priority)) {
      mismatches.push(`priority: DB=${JSON.stringify(row.priority)} vs webhook=${JSON.stringify(webhookReport.priority)}`);
    }

    if (row.description !== TEST_PAYLOAD.description) {
      mismatches.push(`description: DB=${JSON.stringify(row.description)} vs enviado=${JSON.stringify(TEST_PAYLOAD.description)}`);
    }

    if (Number(row.latitude) !== TEST_PAYLOAD.latitude) {
      mismatches.push(`latitude: DB=${JSON.stringify(row.latitude)} vs enviado=${JSON.stringify(TEST_PAYLOAD.latitude)}`);
    }

    if (Number(row.longitude) !== TEST_PAYLOAD.longitude) {
      mismatches.push(`longitude: DB=${JSON.stringify(row.longitude)} vs enviado=${JSON.stringify(TEST_PAYLOAD.longitude)}`);
    }

    if (mismatches.length > 0) {
      logFail(`El registro en la base de datos no coincide con la respuesta del webhook:\n   - ${mismatches.join("\n   - ")}`);
      return;
    }

    logOk(`Existe exactamente 1 registro en "reports" con id=${webhookReport.id} y sus valores coinciden con el webhook.`);
    results.database = true;
  } catch (error) {
    if (error.code === "ENOENT") {
      logFail(
        "Error verificando la base de datos: psql no encontrado en el PATH: verifica tu instalación de PostgreSQL."
      );
      return;
    }
    const details = error.stderr ? `${error.message}\n${error.stderr}` : error.message;
    logFail(`Error verificando la base de datos: ${details}`);
  }
}

async function main() {
  console.log("Verificación end-to-end de la PoC desplegada de UrbanPulse");
  console.log("Flujo: Frontend (Vercel) -> Webhook n8n (Render) -> PostgreSQL (Neon)");

  await verifyFrontend();
  const webhookReport = await verifyWebhook();
  await verifyDatabase(webhookReport);

  logStep("Resumen");
  const steps = [
    ["Frontend responde y sirve el HTML esperado", results.frontend],
    ["Webhook n8n procesa el reporte y devuelve los campos esperados", results.webhook],
    ["El reporte quedó persistido correctamente en PostgreSQL (Neon)", results.database],
  ];

  for (const [label, ok] of steps) {
    (ok ? logOk : logFail)(label);
  }

  const allPassed = Object.values(results).every(Boolean);
  console.log(allPassed ? "\n✅ Todas las verificaciones pasaron." : "\n❌ Al menos una verificación falló.");
  process.exit(allPassed ? 0 : 1);
}

main();
