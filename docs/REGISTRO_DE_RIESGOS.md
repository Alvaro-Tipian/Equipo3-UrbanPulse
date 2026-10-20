# Registro de riesgos: límites de los planes gratuitos (HT-37 T01, acuerdo A5)

Cifras de los planes gratuitos tal como se conocían al redactar esto. **Los
proveedores las cambian sin aviso: confirmar cada una en su consola antes de
darla por buena** (columna "Verificado").

| Servicio | Límite relevante (plan gratuito) | Qué pasa al superarlo | Uso en UrbanPulse | Verificado |
|---|---|---|---|---|
| Gemini (Google AI Studio) | Cuota por proyecto y por modelo; del orden de 20 peticiones/día por modelo en los modelos actuales (valor citado en `ia-ops/mlops-tests/README.md`) | Errores 429 hasta que se renueva la cuota | Chat/NLQ en producción (n8n) y regresión de prompts en CI | pendiente |
| Groq | Límites por minuto y por día de peticiones y tokens, según modelo | 429 | Clasificación/LLM alterno en n8n | pendiente |
| Neon (Postgres) | Almacenamiento y horas de cómputo limitados por mes; el cómputo se suspende por inactividad | Suspensión o rechazo de conexiones | Base de datos de reportes y predicción | pendiente |
| Vercel (Hobby) | Límites de ancho de banda, invocaciones de funciones y builds por mes; uso no comercial | Despliegues o funciones bloqueados | Frontend y funciones `api/` | pendiente |
| AWS Lightsail | Sin plan gratuito permanente: la instancia se factura por hora/mes (hay periodo de prueba limitado) | Cobro, o instancia detenida si se corta el pago | n8n y servicios de apoyo | pendiente |

## Riesgos

### R-03: La CI consume la cuota de Gemini de producción
- **Causa:** las suites de CI compartían clave con producción.
- **Mitigación (HT-37 T01):** clave propia en un proyecto aparte de Google AI
  Studio, guardada como secret `GEMINI_API_KEY_CI`; `mlops-tests.yml` la usa.
- **Pendiente:** `llm-robustness-newman.yml` ataca el webhook de producción, así
  que sigue gastando la clave de producción de n8n hasta que exista un n8n de
  pruebas (o un entorno de staging) con `GEMINI_API_KEY_CI`.
- **Cuota de CI:** el dataset dorado (56 llamadas) y el RAG (~80) superan el
  límite diario del plan gratuito; la clave de CI necesita facturación o
  repartir las suites en varios días.
