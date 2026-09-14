#!/usr/bin/env node
/**
 * ==============================================================================
 * UrbanPulse — Escáner Estático de Seguridad Frontend (SAST)
 * Tarea: HT-30 / T03 — Bloqueo de variables de red y secretos en despliegue
 * ==============================================================================
 *
 * Audita el código fuente del Shell Host y de todos los microfrontends para
 * detectar y bloquear en CI:
 *   1. Archivos .env versionados accidentalmente con secretos.
 *   2. Credenciales y API Keys en texto plano (TomTom, Gemini, OpenAI, Groq, AWS).
 *   3. Cadenas de conexión de bases de datos con contraseñas (Postgres, Neon).
 *   4. IPs privadas o endpoints de infraestructura interna expuestos.
 *   5. Variables VITE_/TE_ con asignación literal de secretos.
 *
 * Uso:
 *   node scripts/sast-frontend-scanner.js
 *
 * Código de salida:
 *   0: Auditoría limpia (sin secretos ni variables expuestas).
 *   1: Violaciones de seguridad encontradas (bloquea el pipeline).
 */

const fs = require('node:fs');
const path = require('node:path');

// Directorios a auditar
const TARGET_DIRECTORIES = [
  'src/frontend',
  'mf-dashboard',
  'mf-mapa-urbano',
  'mf-chatbot'
];

// Carpetas y extensiones a excluir
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.turbo',
  'coverage',
  '.mf'
]);

const IGNORED_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock'
]);

// Extensiones de archivos de prueba (permiten strings dummy para mocks)
const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__/,
  /setupTests\.[jt]s$/
];

// Reglas de detección SAST
const SAST_RULES = [
  {
    id: 'SEC-001-GOOGLE-API-KEY',
    description: 'API Key de Google / Gemini en texto plano',
    pattern: /AIza[0-9A-Za-z_-]{35}/,
    severity: 'CRÍTICA'
  },
  {
    id: 'SEC-002-OPENAI-GROQ-KEY',
    description: 'Clave API de LLM (OpenAI / Anthropic / Groq) en texto plano',
    pattern: /(sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,})/,
    severity: 'CRÍTICA'
  },
  {
    id: 'SEC-003-AWS-ACCESS-KEY',
    description: 'Credencial de AWS Access Key en texto plano',
    pattern: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/,
    severity: 'CRÍTICA'
  },
  {
    id: 'SEC-004-DB-CONNECTION-STRING',
    description: 'Cadena de conexión a base de datos con contraseña expuesta',
    pattern: /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s'"]+:[^@\s'"]+@/i,
    severity: 'CRÍTICA'
  },
  {
    id: 'SEC-005-HARDCODED-BEARER-JWT',
    description: 'Token Bearer o JWT estático hardcodeado',
    pattern: /(?:Bearer\s+[A-Za-z0-9._-]{30,}|eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,})/,
    severity: 'ALTA'
  },
  {
    id: 'SEC-006-HARDCODED-VITE-SECRET',
    description: 'Asignación literal de secretos en variables VITE_ / TE_',
    pattern: /(?:VITE_|TE_)(?:API_KEY|DB_PASSWORD|TOMTOM_API_KEY|SECRET|PASSWORD)\s*[:=]\s*["'][^"']{6,}["']/i,
    severity: 'ALTA'
  },
  {
    id: 'SEC-007-PRIVATE-NETWORK-IP',
    description: 'Dirección IP de red privada interna expuesta en frontend',
    pattern: /https?:\/\/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?::\d+)?/i,
    severity: 'MEDIA'
  }
];

// Archivos de entorno prohibidos en el repositorio
const FORBIDDEN_ENV_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.development'
];

let violationsCount = 0;

function logHeader() {
  console.log('\n🛡️ ==========================================================');
  console.log('   UrbanPulse DevSecOps — Escáner Estático Frontend (SAST)');
  console.log('   Regla HT-30 / T03: Detección de Secretos y Red en CI');
  console.log('==========================================================\n');
}

function checkForbiddenEnvFiles(baseDir) {
  for (const envFile of FORBIDDEN_ENV_FILES) {
    const fullPath = path.join(baseDir, envFile);
    if (fs.existsSync(fullPath)) {
      console.error(`🚨 [CRÍTICA] Archivo de entorno versionado detectado: ${fullPath}`);
      console.error(`   Los archivos .env no deben versionarse en Git. Agrégalo a .gitignore y usa la consola segura de Vercel.\n`);
      violationsCount++;
    }
  }
}

function scanFile(filePath) {
  const isTestFile = TEST_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
  if (isTestFile) return;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    // Ignorar comentarios que documentan los patrones en este mismo archivo o guías
    if (filePath.includes('sast-frontend-scanner') || filePath.endsWith('.md')) return;

    for (const rule of SAST_RULES) {
      if (rule.pattern.test(line)) {
        console.error(`🚨 [${rule.severity}] ${rule.id} en ${filePath}:${index + 1}`);
        console.error(`   Descripción : ${rule.description}`);
        console.error(`   Línea       : ${line.trim()}`);
        console.error(`   Mitigación  : Mueve este valor a las variables de entorno cifradas de Vercel.\n`);
        violationsCount++;
      }
    }
  });
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        walkDir(fullPath);
      }
    } else if (entry.isFile()) {
      if (!IGNORED_FILES.has(entry.name) && /\.(jsx?|tsx?|json|html|ya?ml)$/i.test(entry.name)) {
        scanFile(fullPath);
      }
    }
  }
}

function run() {
  logHeader();

  const repoRoot = path.resolve(__dirname, '..');

  // 1. Validar que no haya archivos .env en la raíz ni en los directorios objetivo
  checkForbiddenEnvFiles(repoRoot);
  for (const dir of TARGET_DIRECTORIES) {
    const fullDir = path.join(repoRoot, dir);
    checkForbiddenEnvFiles(fullDir);
  }

  // 2. Escanear código fuente en cada directorio objetivo
  for (const dir of TARGET_DIRECTORIES) {
    const fullDir = path.join(repoRoot, dir);
    console.log(`🔍 Analizando directorio: ${dir}/...`);
    walkDir(fullDir);
  }

  console.log('──────────────────────────────────────────────────────────');
  if (violationsCount > 0) {
    console.error(`❌ Fallo en análisis SAST: Se detectaron ${violationsCount} violación(es) de seguridad.`);
    console.error('   Bloqueando despliegue para prevenir exposición accidental de secretos.');
    process.exit(1);
  } else {
    console.log('✅ Análisis SAST completado: Cero variables de red privadas ni secretos expuestos.');
    console.log('   El código cumple con los lineamientos de despliegue seguro en Vercel.\n');
    process.exit(0);
  }
}

run();
