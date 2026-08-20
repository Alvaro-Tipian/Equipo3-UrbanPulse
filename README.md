# Equipo3-UrbanPulse

## Descripción

Repositorio base del proyecto UrbanPulse, orientado a una solución con:
- n8n para orquestación de workflows.
- PostgreSQL + pgvector para almacenamiento vectorial y semántico.
- IA multimodal para análisis y generación.
- Microfrontend para front-end desacoplado.

## Estructura principal

- `.github/` - Plantillas y workflows de CI/CD.
- `src/frontend/` - Código del microfrontend.
- `src/n8n-workflows/production/` - Workflows n8n de producción.
- `src/n8n-workflows/templates/` - Plantillas de workflows n8n.
- `database/migrations/` - Migraciones de base de datos.
- `database/seeders/` - Seeders de datos.
- `ia-ops/prompts/` - Prompts y definiciones para IA.
- `ia-ops/tests/` - Pruebas enfocadas en IA y prompts.
- `infrastructure/` - Infraestructura local y despliegue.

## Uso local

1. Clona el repositorio.
2. Revisa `.github/PULL_REQUEST_TEMPLATE.md` para gobernanza de PR.
3. Levanta la infraestructura local:

```bash
cd infrastructure
docker-compose up -d
```

4. Accede a n8n en `http://localhost:5678`.
5. Administra el servicio PostgreSQL en `localhost:5433`.

## Cómo correr la PoC end-to-end

Flujo: **Frontend → n8n → PostgreSQL+pgvector → LLM (mock)**.

1. Levanta la infraestructura local (PostgreSQL+pgvector y n8n):

   ```bash
   cd infrastructure
   docker-compose up -d
   ```

2. Corre la migración de base de datos (activa `pgvector` y crea la tabla `reports`):

   ```bash
   docker exec -i urbanpulse-db psql -U urban_admin -d urbanpulse_db \
     < database/migrations/20260814000001_create_reports_table.sql
   ```

3. Importa el workflow en n8n:
   - Abre `http://localhost:5678` y crea tu cuenta local de n8n (solo la primera vez).
   - Ve a **Credentials → New → Postgres** y crea una credencial llamada exactamente `Postgres UrbanPulse` con los datos de `.env.example` (host `postgres`, database `urbanpulse_db`, user `urban_admin`, password `urban_password_local`, port `5432`). Las credenciales nunca se exportan en el JSON del workflow, así que este paso es obligatorio.
   - Ve a **Workflows → Import from File** y selecciona `src/n8n-workflows/production/urbanpulse-report.json`.
   - Abre el nodo **Webhook** y confirma que en **Options → Allowed Origins (CORS)** esté configurado `http://localhost:8080` (el puerto en el que sirves el frontend en el paso 4). Ya viene incluido en el JSON exportado; si lo configuras a mano, este valor es el que evita que el navegador bloquee la petición del frontend por CORS.
   - En el editor del workflow, haz clic en **Publish** para activarlo (esta versión de n8n ya no usa el toggle **Active**).

4. Abre el frontend mínimo:

   ```bash
   cd src/frontend
   python -m http.server 8080
   ```

   Entra a `http://localhost:8080`, completa el formulario (descripción, imagen opcional, ubicación opcional) y presiona **Enviar reporte**. El tipo de incidente, gravedad y prioridad se muestran en pantalla.

5. (Opcional) Verifica los reportes guardados directamente en la base de datos:

   ```bash
   docker exec -it urbanpulse-db psql -U urban_admin -d urbanpulse_db \
     -c "SELECT id, incident_type, severity, priority, status, created_at FROM reports ORDER BY created_at DESC LIMIT 5;"
   ```

> Esta PoC no tiene configurada una clave de API de Gemini ni de Groq (ver `.env.example`), así que la clasificación del incidente la simula un nodo de código dentro del workflow (reglas por palabras clave), no un LLM real. El nodo está comentado explícitamente como mock.

### Troubleshooting

- **El navegador da error de CORS** o **n8n devuelve "webhook not registered"**: haz clic en **Publish** en el editor del workflow. Esta versión de n8n ya no usa el toggle **Active** para (re)activar un workflow y registrar su webhook; sin publicar, el webhook no queda escuchando y las peticiones del frontend fallan.

## Verificación end-to-end de la PoC desplegada

`scripts/verify-poc-deployment.js` recorre en orden los tres componentes ya
desplegados (Frontend en Vercel → Webhook n8n en Render → PostgreSQL en Neon),
envía un reporte de prueba real y confirma que quedó persistido correctamente.

No requiere instalar ningún paquete npm: usa `fetch` nativo de Node.js para
los pasos 1 y 2, y para el paso 3 invoca directamente el cliente `psql` de
PostgreSQL.

1. Asegúrate de tener `psql` (cliente de PostgreSQL) instalado y disponible
   en el PATH del sistema.

2. Define las variables de entorno documentadas en `.env.example`
   (`FRONTEND_URL`, `N8N_WEBHOOK_URL`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`,
   `DB_USER`, `DB_PASSWORD`) con los valores reales del despliegue, y corre:

   ```bash
   node scripts/verify-poc-deployment.js
   ```

   El script imprime ✅/❌ por cada paso y un resumen final; termina con
   código de salida `1` si alguna verificación falló, o `0` si todas pasaron.

## Gobernanza y seguridad

- El pipeline CI verifica que los títulos de PR sigan Conventional Commits.
- Se escanean los workflows n8n para detectar credenciales hardcodeadas.
- No se deben subir archivos con credenciales, claves o datos sensibles.

## Scripts

- `scripts/setup-structure.ps1` - Crea la estructura de carpetas en PowerShell.
- `scripts/setup-structure.sh` - Crea la estructura de carpetas en Bash.
- `scripts/verify-poc-deployment.js` - Verifica end-to-end la PoC desplegada (Frontend → n8n → PostgreSQL). Ver [sección dedicada](#verificación-end-to-end-de-la-poc-desplegada).

## Notas de Sprint 0

Esta base está diseñada para Semana 2A / Sprint 0 con enfoque en:
- estructura y gobernanza estricta,
- trazabilidad extrema,
- separación clara de componentes,
- cumplimiento de buenas prácticas DevSecOps.
