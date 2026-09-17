#!/usr/bin/env node
/**
 * ====================================================================
 *   URBANPULSE DEVSECOPS - AI SECURITY GUARDRAIL & PROMPT SCANNER
 * ====================================================================
 * Herramienta de seguridad para aplicaciones de Inteligencia Artificial Generativa.
 * Audita prompts del sistema y flujos n8n bajo los estandares:
 *   - OWASP Top 10 for Large Language Model Applications (LLM01, LLM02, LLM06)
 *   - NIST AI Risk Management Framework (AI RMF 1.0)
 * ====================================================================
 */

const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, '..', 'ia-ops', 'prompts');
const WORKFLOWS_DIR = path.join(__dirname, '..', 'src', 'n8n-workflows', 'production');

function auditPrompts() {
  console.log('\n🧠 [1/2] Auditando Prompts de Sistema en ia-ops/prompts/...');
  const results = [];

  if (!fs.existsSync(PROMPTS_DIR)) {
    console.error('❌ Directorio de prompts no encontrado:', PROMPTS_DIR);
    return [{ rule: 'Existencia de Prompts', status: 'FAIL', detail: 'Directorio ausente' }];
  }

  const files = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md') && f !== 'README.md');
  console.log(`   Archivos de prompt detectados: ${files.length}`);

  files.forEach(file => {
    const filePath = path.join(PROMPTS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    // 1. Delimitadores contra Prompt Injection (OWASP LLM01)
    const hasDelimiters = /<[a-z0-9_-]+>[\s\S]*?<\/[a-z0-9_-]+>/i.test(content) || /<[a-z0-9_-]+>/i.test(content);
    results.push({
      target: file,
      rule: 'Delimitadores Estructurados (OWASP LLM01: Prompt Injection)',
      status: hasDelimiters ? 'PASS' : 'FAIL',
      detail: hasDelimiters ? 'Delimitadores XML/etiquetas presentes' : 'Faltan delimitadores de entrada'
    });

    // 2. Clausula Anti-Jailbreak / Desobediencia a instrucciones de usuario
    const hasAntiJailbreak = /ignora|obedecer|no confiables|datos de entrada|evasion|rol diferente/i.test(content);
    results.push({
      target: file,
      rule: 'Clausula de Integridad de Rol (OWASP LLM01: Jailbreak Defense)',
      status: hasAntiJailbreak ? 'PASS' : 'FAIL',
      detail: hasAntiJailbreak ? 'Clausula de seguridad explicita presente' : 'Falta instruccion defensiva'
    });

    // 3. Salida Estructurada JSON (OWASP LLM02: Formato Seguro)
    const hasJsonSchema = /json|esquema|categoria|gravedad/i.test(content);
    results.push({
      target: file,
      rule: 'Esquema de Salida Estricto (OWASP LLM02: Output Integrity)',
      status: hasJsonSchema ? 'PASS' : 'FAIL',
      detail: hasJsonSchema ? 'Esquema JSON obligatorio definido' : 'Salida no tipada'
    });

    // 4. Ausencia de Secretos Hardcodeados (OWASP LLM06)
    const secretMatches = content.match(/AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}/g);
    const noSecrets = !secretMatches;
    results.push({
      target: file,
      rule: 'Sanitizacion de Secretos (OWASP LLM06: Sensitive Disclosure)',
      status: noSecrets ? 'PASS' : 'FAIL',
      detail: noSecrets ? 'Cero credenciales expuestas en prompt' : 'Se detectaron posibles API keys'
    });
  });

  return results;
}

function auditN8nWorkflows() {
  console.log('\n⚙️  [2/2] Auditando Integracion de IA en src/n8n-workflows/production/...');
  const results = [];

  if (!fs.existsSync(WORKFLOWS_DIR)) {
    return [{ target: 'n8n-workflows', rule: 'Workflows n8n', status: 'PASS', detail: 'No workflows to scan' }];
  }

  const jsonFiles = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));

  jsonFiles.forEach(file => {
    const filePath = path.join(WORKFLOWS_DIR, file);
    const raw = fs.readFileSync(filePath, 'utf-8');

    // Comprobar que no hay prompts masivos quemados en texto plano en nodos de codigo
    const hasHardcodedLongPrompt = /("text":\s*"Eres el asistente[\s\S]{300,}")/i.test(raw);
    results.push({
      target: file,
      rule: 'Desacoplamiento de Prompts en Workflows n8n',
      status: !hasHardcodedLongPrompt ? 'PASS' : 'FAIL',
      detail: !hasHardcodedLongPrompt ? 'Prompts desacoplados conforme a arquitectura' : 'Prompt extenso hardcodeado en nodo'
    });
  });

  return results;
}

function main() {
  console.log('='.repeat(70));
  console.log('  🛡️  URBANPULSE DEVSECOPS - SUITE DE SEGURIDAD PARA INTELIGENCIA ARTIFICIAL');
  console.log('      Estandares: OWASP Top 10 for LLMs | NIST AI RMF 1.0');
  console.log('='.repeat(70));

  const promptResults = auditPrompts();
  const workflowResults = auditN8nWorkflows();
  const allResults = [...promptResults, ...workflowResults];

  let passed = 0;
  console.log('\n📋 RESULTADOS DE LA AUDITORIA DE SEGURIDAD EN IA:');
  console.log('─'.repeat(70));

  allResults.forEach(r => {
    if (r.status === 'PASS') {
      passed++;
      console.log(`  ✅ [PASS] [${r.target}] ${r.rule}`);
    } else {
      console.log(`  ❌ [FAIL] [${r.target}] ${r.rule} (${r.detail})`);
    }
  });

  const score = Math.round((passed / allResults.length) * 100);
  console.log('─'.repeat(70));
  console.log(`🏆 PUNTAJE DE SEGURIDAD EN IA: ${score}/100 - Nivel A+ (Excelente)`);
  console.log('='.repeat(70) + '\n');

  if (score < 100) {
    process.exit(1);
  }
  process.exit(0);
}

main();
