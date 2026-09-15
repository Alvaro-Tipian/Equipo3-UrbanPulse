# 🛡️ Reglas y Automatización SAST en la Rama de Despliegue (HT-30 / T03)

Este documento describe la arquitectura y reglas del análisis estático de seguridad (**SAST - Static Application Security Testing**) integrado en los pipelines de integración continua de **UrbanPulse**, diseñado para auditar la rama de despliegue (`main`) y las Pull Requests, bloqueando la exposición accidental de secretos y variables de red en el frontend.

---

## 1. 🎯 Objetivo y Criterio de Aceptación

* **Historia:** HT-30 (Hardening Keys en Producción Vercel).
* **Tarea:** T03 — Configurar el análisis estático en la rama de despliegue para bloquear variables de red expuestas accidentalmente.
* **Criterio de Aceptación:** Automatización de reglas SAST en integración continua para prevenir la promoción de código vulnerable a Vercel.

---

## 2. ⚙️ Automatización en CI/CD (`.github/workflows/frontend-ci.yml`)

El pipeline fue actualizado para garantizar cobertura tanto en la fase previa al merge (**PR**) como en la propia rama que alimenta el despliegue automático de Vercel (**Push a `main`**):

```yaml
on:
  pull_request:
    branches: [main]
    paths:
      - 'src/frontend/**'
      - 'mf-dashboard/**'
      - 'mf-mapa-urbano/**'
      - 'mf-chatbot/**'
      - 'scripts/sast-frontend-scanner.js'
      - '.github/workflows/frontend-ci.yml'
  push:
    branches: [main]
    paths:
      - 'src/frontend/**'
      - 'mf-dashboard/**'
      - 'mf-mapa-urbano/**'
      - 'mf-chatbot/**'
      - 'scripts/sast-frontend-scanner.js'
      - '.github/workflows/frontend-ci.yml'
```

### Job Automatizado: `sast-secrets-and-network-audit`
Se ejecuta en cada commit y ejecuta el script dedicado de auditoría:
```bash
node scripts/sast-frontend-scanner.js
```
Si se detecta cualquier variable prohibida, el paso falla con código de salida `exit 1` y muestra la ubicación exacta (archivo, número de línea y regla infringida).

---

## 3. 📋 Catálogo de Reglas del Escáner SAST

El motor de escaneo (`scripts/sast-frontend-scanner.js`) aplica las siguientes reglas deterministas:

| ID de Regla | Severidad | Patrón Auditado | Descripción y Riesgo Mitigado |
|---|---|---|---|
| **`SEC-001-GOOGLE-API-KEY`** | **CRÍTICA** | `AIza[0-9A-Za-z_-]{35}` | Claves de Google Cloud / Gemini en texto plano. Evita consumo no autorizado de cuotas de IA. |
| **`SEC-002-OPENAI-GROQ-KEY`** | **CRÍTICA** | `sk-[A-Za-z0-9]{20,}`, `gsk_[A-Za-z0-9]{20,}` | Claves de OpenAI, Anthropic o Groq expuestas en el código fuente. |
| **`SEC-003-AWS-ACCESS-KEY`** | **CRÍTICA** | `(?:A3T|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}` | Credenciales de AWS IAM que puedan comprometer la infraestructura de Lightsail o S3. |
| **`SEC-004-DB-CONNECTION-STRING`** | **CRÍTICA** | `(?:postgres|postgresql|mysql|mongodb|redis)://...:...@` | Cadenas de conexión con contraseñas quemadas hacia Neon o bases de datos locales. |
| **`SEC-005-HARDCODED-BEARER-JWT`** | **ALTA** | `Bearer ...`, `eyJ...` | Tokens estáticos de autorización o JSON Web Tokens quemados en el código. |
| **`SEC-006-HARDCODED-VITE-SECRET`** | **ALTA** | `(?:VITE_|TE_)(?:API_KEY|SECRET|PASSWORD)\s*[:=]\s*"..."` | Asignación literal de secretos en variables frontend en lugar de leer `import.meta.env`. |
| **`SEC-007-PRIVATE-NETWORK-IP`** | **MEDIA** | `https?://(?:10\.|172\.(?:1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)` | Direcciones IP de redes privadas internas de desarrollo o VPCs expuestas en el bundle. |
| **`SEC-008-ENV-FILE-COMMITTED`** | **CRÍTICA** | Presencia de `.env`, `.env.local`, `.env.production` | Archivos de variables de entorno versionados por error en Git. |

---

## 4. 💻 Ejecución Local Previa a Commits

Los desarrolladores y sus IAs pueden ejecutar el escáner localmente antes de enviar una PR para asegurar el paso limpio por CI:

```bash
# Desde la raíz del repositorio:
node scripts/sast-frontend-scanner.js
```

### Salida esperada en caso de éxito:
```text
🛡️ ==========================================================
   UrbanPulse DevSecOps — Escáner Estático Frontend (SAST)
   Regla HT-30 / T03: Detección de Secretos y Red en CI
==========================================================

🔍 Analizando directorio: src/frontend/...
🔍 Analizando directorio: mf-dashboard/...
🔍 Analizando directorio: mf-mapa-urbano/...
🔍 Analizando directorio: mf-chatbot/...
──────────────────────────────────────────────────────────
✅ Análisis SAST completado: Cero variables de red privadas ni secretos expuestos.
   El código cumple con los lineamientos de despliegue seguro en Vercel.
```

---

## 5. 🛠️ Guía de Remediación

Si el pipeline bloquea un commit por una alerta SAST:
1. **Identificar la línea:** Revisar el log del job `sast-secrets-and-network-audit` en GitHub Actions.
2. **Remover el secreto del código fuente:** Reemplazar el valor hardcodeado por `import.meta.env.VITE_NOMBRE_VARIABLE` o `import.meta.env.TE_NOMBRE_VARIABLE`.
3. **Provisionar en Vercel:** Cargar el valor como variable cifrada en **Vercel Dashboard > Settings > Environment Variables** (ver `docs/VERCEL_PRODUCTION_KEYS_HARDENING.md`).
4. **Si fue un secreto real de producción:** Proceder inmediatamente a su rotación en el proveedor correspondiente (TomTom, Google, Neon, etc.).
