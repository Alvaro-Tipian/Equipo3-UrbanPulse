# HT-45 — Pruebas DAST automatizadas con OWASP ZAP

**Responsable:** Fabio Saavedra (QA) · **Fecha:** 2026-10-12 · **Bloque:** DevSecOps

## Resumen ejecutivo

🟡 **Estado: 2 de 3 tareas completas. T02 está bloqueada por el entorno de staging, no por código.**

Se automatizó el análisis dinámico de seguridad de la aplicación ya desplegada: un escaneo pasivo del frontend y un escaneo activo de los webhooks de n8n, con los hallazgos publicados en GitHub Code Scanning y un gate que tumba el job ante un riesgo alto. El escaneo del frontend funciona; el de la API está construido pero aún no ha escaneado nada porque los webhooks no existen en el n8n de staging.

La guía de uso está en `docs/DAST_OWASP_ZAP.md`. Este informe recoge el estado de cada tarea.

## Estado por tarea

| Tarea | Criterio de aceptación | Estado | Evidencia |
| --- | --- | --- | --- |
| **T01** Baseline contra el frontend de staging tras cada despliegue | El reporte de ZAP se genera en cada despliegue a staging | ✅ Completa, con una observación | Job `baseline-scan`; corrida manual en verde con reporte generado |
| **T02** Escaneo de API contra los webhooks `/urbanpulse/*` | Los webhooks aparecen en el reporte de ZAP | ⛔ Bloqueada | Spec OpenAPI con 15 rutas y job `api-scan` listos; el job se detiene antes de escanear |
| **T03** Publicar en Code Scanning (SARIF), bloquear riesgo alto e informe | Hallazgos visibles en la pestaña Security | ✅ Completa | 44 hallazgos del baseline publicados bajo la categoría `dast-zap-baseline` |

## Qué se construyó

| Archivo | Papel |
| --- | --- |
| `.github/workflows/dast-owasp-zap.yml` | Workflow con tres jobs: resolver objetivo, baseline y API scan. |
| `.zap/urbanpulse-api.openapi.yaml` | Definición OpenAPI mínima de los 15 webhooks, escrita a partir de los nodos Webhook de n8n. |
| `.zap/rules.tsv` | Qué hace cada regla de ZAP: `FAIL`, `WARN` o `IGNORE` con justificación. |
| `scripts/zap-json-to-sarif.mjs` | Convierte el JSON de ZAP a SARIF (las acciones oficiales no lo emiten). |
| `scripts/zap-reporte-hallazgos.mjs` | Genera el informe de hallazgos y aplica el gate de riesgo alto. |
| `docs/DAST_OWASP_ZAP.md` | Guía: qué corre, cuándo, secrets, gate y tuning. |

## Cómo funciona

- **Disparo.** El workflow reacciona al evento `deployment_status` de Vercel. Escanea la URL recién desplegada cuando el despliegue termina bien y no es de producción. También se puede lanzar a mano.
- **Baseline (T01).** Escaneo pasivo con spider AJAX, necesario porque el host es una SPA con Module Federation.
- **API scan (T02).** Escaneo activo guiado por la spec OpenAPI. Envía payloads de ataque y crea registros.
- **Gate (T03).** Un hallazgo de riesgo alto termina el job con error. Las reglas ya remediadas en HT-44 (CSP, HSTS, `nosniff`, CORS) están en `FAIL` para detectar regresiones.

## Salvaguardas añadidas tras las primeras corridas

| Problema encontrado | Corrección |
| --- | --- |
| La subida a Code Scanning abortaba en eventos de despliegue por no tener `GITHUB_REF` | Los hallazgos se cuelgan del commit y la rama del propio despliegue |
| Un n8n sin flujos devuelve 404 en todo y ZAP saldría en verde sin haber probado nada | El job sondea tres webhooks de solo lectura y falla si ninguno responde |
| Un secret mal puesto apuntaría el escaneo activo contra producción | El job se niega a correr si el host de `DAST_API_BASE_URL` no contiene `staging` |

## Resultados

| Corrida | Baseline | API scan |
| --- | --- | --- |
| Manual en la rama `Saavedra` | ✅ Verde, 44 hallazgos en Code Scanning | ❌ Se detiene en "Comprobar que los webhooks existen" |
| Por despliegue en la rama `Saavedra` | ❌ Falló al publicar el SARIF | ❌ Mismo motivo |
| Por despliegue en `main` | Omitido a propósito (es producción) | Omitido a propósito |

## Pendientes y limitaciones

- **T02: importar y activar en el n8n de staging los flujos de `src/n8n-workflows/production/`.** Mientras no existan los webhooks no hay nada que escanear. No requiere cambios de código.
- **Revisar el fallo de publicación de SARIF en la corrida por despliegue.** La corrida manual sí publicó; no se ha confirmado si el arreglo del commit de despliegue cubre ya ese caso.
- **Los hallazgos no aparecen en la vista por defecto de Security.** Esa vista muestra la rama `main`, y en `main` el escaneo se omite por ser producción. Hay que filtrar por la rama escaneada.
- **El gate no bloquea merges por sí solo.** Para eso hay que marcar los jobs como checks requeridos en la protección de rama de `main`.
- Los dos últimos commits de HT-45 (`b36e3b7a`, `6fe5a681`) están en la rama `Saavedra` y aún no en `main`.
