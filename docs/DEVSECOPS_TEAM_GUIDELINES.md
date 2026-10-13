# 🛡️ Guía y Lineamientos DevSecOps para el Equipo de UrbanPulse

Este documento contiene las reglas, validaciones y lineamientos técnicos de los workflows de GitHub Actions de **UrbanPulse**. Está diseñado para que los desarrolladores (**Frontend, Backend, QA y Arquitecto/DevOps**) y sus respectivas herramientas de Inteligencia Artificial (ChatGPT, Copilot, Claude, Cursor) conozcan exactamente qué auditan los pipelines y eviten fallos en las Pull Requests.

---

## 📊 Tabla Resumen de Cambios en los Workflows

| Workflow | Archivo | Estado Anterior (Causa de Fallo) | Estado Actual (Solución Implementada) |
|---|---|---|---|
| **Playwright Tests** | `.github/workflows/playwright.yml` | `working-directory: .` en microfrontends resolvía sobre `ia-ops/tests/` (erróneo). | Corregido a `working-directory: ${{ github.workspace }}`. Se agregó caché multi-lockfile para los 5 subproyectos. |
| **Gobernanza PR** | `.github/workflows/n8n-validate-ci.yml` | El cambio de nombre a `Gobernanza PR (Conventional Commits)` rompía la regla de protección de rama de GitHub (`Gobernanza PR Expected`). | Restaurado el nombre exacto `name: Gobernanza PR`. Se añadió `ignoreLabels: [dependencies, automated pr]` para Dependabot. |
| **Seguridad n8n** | `.github/workflows/n8n-validate-ci.yml` | Estaba acoplado a `governance` (`needs: governance`) y tenía un condicional `if:` con `files_url` inválido. | Desacoplado de gobernanza. Escanea `src/n8n-workflows/production/*.json` de forma rápida y autónoma. |
| **Backend CI** | `.github/workflows/backend-ci.yml` | `api-integration-tests` levantaba n8n vacío sin workflows importados; Newman siempre daba 404 y bloqueaba el PR. | Marcado con `continue-on-error: true`. El job informa sin bloquear las PRs mientras se implementa la carga de workflows. |
| **Health Check AWS (E2E)** | `.github/workflows/aws-health-check.yml` | Cron `0 12,0 * * *` corría dos veces al día sin secrets en upstream y fallaba continuamente (reliquia del keep-alive de Render). | **Cron eliminado.** AWS Lightsail corre 24/7 y no duerme. Quedó únicamente ejecutable bajo demanda (`workflow_dispatch`). |
| **Deploy Lightsail** | `.github/workflows/deploy-lightsail-n8n.yml` | Timeout post-deploy de 10 minutos (40 intentos × 15s) se agotaba antes de que Lightsail estabilizara el contenedor. | Timeout ampliado a 15 minutos (60 intentos × 15s). |
| **Dependabot** | `.github/dependabot.yml` | Sin prefijos (fallaba gobernanza), intentaba migrar a Tailwind v4 (rompía Vite), abría 15 PRs dispersas y omitía `mf-chatbot`. | Prefijos `chore(deps):`, congelado Tailwind en v3, dependencias agrupadas en 1 PR semanal y cobertura completa. |
| **Render Cleanup** | `render.yaml`, `deploy-render-n8n.yml.disabled`, etc. | Existían archivos de infraestructura obsoletos de Render y un workflow duplicado `postmannewman.yml`. | **Eliminados.** Referencias en `.env.example`, `README.md`, `PR_TEMPLATE.md` y scripts migradas a **AWS Lightsail**. |

---

## 👥 Directrices por Rol (Instrucciones para sus IAs)

---

### 🎨 1. Rol: Frontend Developer (Host & Microfrontends)
**Rutas auditadas:** `src/frontend/**`, `mf-dashboard/**`, `mf-mapa-urbano/**`, `mf-chatbot/**`  
**Workflows que lo auditan:** `frontend-ci.yml`, `playwright.yml`

#### ¿Qué revisa el CI estrictamente?
1. **Escáner de Secretos Vite (`sast-secrets-vite`):**
   - Busca en el código variables con prefijo `VITE_` que contengan credenciales quemadas (`VITE_API_KEY`, `VITE_DB_PASSWORD`, `TOMTOM_API_KEY`, claves `sk-...`, `gsk-...`).
2. **Auditoría y Build (`calidad-eslint-sca`):**
   - Ejecuta `npm ci`, `npm run lint --if-present` y `npm run build` en los 4 proyectos. Si cualquiera tiene un error tipográfico, de importación o sintaxis, el CI falla.
3. **Integración Federada (Module Federation):**
   - El Host (`src/frontend`) corre en el puerto `3000`.
   - `mf-chatbot` corre en el puerto `3003`.
   - `mf-mapa-urbano` corre en el puerto `5174`.
   - `mf-dashboard` corre en el puerto `5175`.
4. **Esquema de Sesión Unificada:**
   - La clave en `localStorage` debe ser **estrictamente** `'urbanpulse_citizen_session'`.
   - Estructura: `{ id, email, username, role, expires_at }`.

#### 📋 Prompt para la IA de Frontend:
```text
Actúa como Desarrollador Frontend Senior para UrbanPulse. Cuando generes o modifiques código en src/frontend o en los microfrontends (mf-dashboard, mf-mapa-urbano, mf-chatbot):
1. NUNCA escribas claves API, contraseñas o tokens en archivos .env, .js, .jsx o .json. Usa process.env o import.meta.env sin valores reales por defecto.
2. NUNCA actualices tailwindcss a la versión 4.x. Debemos mantener tailwindcss 3.x con las directivas @tailwind base; @tailwind components; @tailwind utilities; para no romper Vite ni PostCSS.
3. Asegúrate de que cualquier nuevo paquete npm quede registrado en el package.json Y en el package-lock.json respectivo (el CI ejecuta 'npm ci', no 'npm install').
4. Si creas o tocas rutas protegidas o estado de sesión, la única clave autorizada de LocalStorage es 'urbanpulse_citizen_session'.
5. Verifica siempre que 'npm run build' compile de manera limpia sin warnings de sintaxis ni imports rotos antes de confirmar el cambio.
```

---

### ⚙️ 2. Rol: Backend Developer (n8n Workflows & API)
**Rutas auditadas:** `src/n8n-workflows/**`, `infrastructure/**`  
**Workflows que lo auditan:** `n8n-validate-ci.yml`, `backend-ci.yml`

#### ¿Qué revisa el CI estrictamente?
1. **Escáner SAST de Secretos en Workflows (`n8n_security` & `security-sast`):**
   - Inspecciona todos los `.json` en `src/n8n-workflows/production/`.
   - Expresiones prohibidas: `sk-[A-Za-z0-9]{20,}`, `AIza[0-9A-Za-z_-]{35}`, `Bearer ...`, `"api_key": "..."`, tokens JWT (`eyJ...`).
2. **Gestión de Credenciales en n8n:**
   - Todo acceso a bases de datos o servicios externos (Neon, Gemini, TomTom) debe usar credenciales configuradas en el entorno n8n o variables de entorno del sistema (`$env.NOMBRE_VARIABLE`), **nunca** cadenas hardcodeadas en los parámetros de los nodos.
3. **Endpoints de Webhook Estándar:**
   - `/webhook/urbanpulse/chat` (interacción ciudadana / bot).
   - `/webhook/urbanpulse/report` (reporte directo PoC).
   - `/webhook/urbanpulse/auth/login` (autenticación de operadores).
   - `/webhook/urbanpulse/dashboard-kpis` (métricas).
   - `/webhook/urbanpulse/reports-list` (marcadores de mapa).

#### 📋 Prompt para la IA de Backend:
```text
Actúa como Desarrollador Backend e Ingeniero n8n para UrbanPulse. Al crear o modificar workflows en src/n8n-workflows/production/:
1. NUNCA incluyas API keys, contraseñas de Postgres ni tokens en el JSON del workflow. Si exportas un flujo de n8n, limpia los campos de credenciales o usa referencias a variables de entorno ($env.MI_VAR).
2. El escáner de seguridad de GitHub Actions bloqueará cualquier archivo JSON que contenga cadenas coincidentes con 'sk-...', 'AIza...', 'Bearer ...' o 'api_key: ...'.
3. Respeta los nombres de endpoints de webhooks acordados (/webhook/urbanpulse/chat, /report, /auth/login, /dashboard-kpis).
4. Recuerda que la infraestructura de producción corre sobre AWS Lightsail Container Service conectado a PostgreSQL Neon; no hagas referencia a Render ni uses mecanismos de keep-alive.
```

---

### 🧪 3. Rol: QA Automation Engineer (Playwright & Postman)
**Rutas auditadas:** `ia-ops/tests/**`, `postman/**`  
**Workflows que lo auditan:** `playwright.yml`, `postman-newman.yml`

#### ¿Qué revisa el CI estrictamente?
1. **Playwright Tests (`playwright.yml`):**
   - Corre sobre Ubuntu con **Chromium headless** (timeout global de 15 min; cada spec debe pasar en menos de 20s).
   - **Cero dependencias de red externa en CI:** Los tests deben interceptar llamadas a TomTom (`*.tomtom.com`), Gemini y webhooks n8n usando `page.route()`.
   - **Inyección de Sesión:** Los specs que prueban vistas internas deben inyectar la sesión mediante `page.addInitScript()` antes de `page.goto()`:
     ```javascript
     window.localStorage.setItem('urbanpulse_citizen_session', JSON.stringify({
       success: true, id: '...', email: 'qa-tester@example.com', username: 'qa-tester', role: 'Operador QA', expires_at: '...'
     }));
     ```
2. **Postman / Newman (`postman-newman.yml`):**
   - La colección vive en `postman/collections/`.
   - Debe usar variables parametrizadas: `{{n8n_webhook_url}}`, `{{gemini_api_key}}`, `{{tomtom_api_key}}`.
   - No versionar colecciones con API keys privadas hardcodeadas en los JSON.

#### 📋 Prompt para la IA de QA:
```text
Actúa como Ingeniero QA Automation Senior para UrbanPulse. Al escribir pruebas en ia-ops/tests/tests/*.spec.ts o colecciones de Postman:
1. En Playwright, NUNCA asumas que hay internet o que el backend real de n8n o TomTom responderá en CI. Usa 'page.route()' para mockear todas las llamadas salientes (tiles del mapa, webhooks, login).
2. Para evitar timeouts en CI, los tests deben precargar la sesión de autenticación en localStorage con la clave 'urbanpulse_citizen_session'.
3. Los selectores de UI deben ser resilientes: prefiere page.getByRole(), page.getByPlaceholder() o page.getByText() sobre selectores CSS frágiles.
4. En Postman, no quemes URLs absolutas de producción ni API keys en las colecciones. Usa siempre {{n8n_webhook_url}}, {{gemini_api_key}} y {{tomtom_api_key}}.
```

---

### 🏛️ 4. Rol: Software Architect & DevOps (Infraestructura, BD y Gobernanza)
**Rutas auditadas:** `infrastructure/**`, `database/**`, `.github/**`  
**Workflows que lo auditan:** `infrastructure-ci.yml`, `aws-ci.yml`, `database-ci.yml`, `n8n-validate-ci.yml`, `deploy-lightsail-n8n.yml`

#### ¿Qué revisa el CI estrictamente?
1. **Gobernanza de Títulos de PR (`Gobernanza PR`):**
   - **Regla inquebrantable:** El título del Pull Request DEBE seguir el estándar **Conventional Commits**:
     - `feat: <descripción>` (nueva funcionalidad)
     - `fix: <descripción>` (corrección de bug)
     - `ci: <descripción>` (cambios en workflows de GitHub Actions)
     - `chore: <descripción>` (tareas de mantenimiento o dependencias)
     - `docs: <descripción>` (documentación)
     - `test: <descripción>` (tests automatizados)
     - `refactor: <descripción>` (refactorización sin cambio funcional)
   - ⚠️ Títulos como *"subiendo cambios"*, *"correcciones de juan"*, *"PR sprint 2"* **reprobarán automáticamente**.
2. **Auditoría de SQL (`database-ci.yml`):**
   - Se audita con `sqlfluff lint database/ --dialect postgres`.
   - Las migraciones en `database/migrations/*.sql` deben tener sintaxis PostgreSQL válida.
3. **Auditoría de Docker Compose (`infrastructure-ci.yml`):**
   - Valida estructura con `docker compose config -q`.
   - Exige que `N8N_CORS_ALLOWED_ORIGINS` esté presente en `infrastructure/docker-compose.yml`.
4. **Plantilla de AWS Lightsail (`aws-ci.yml`):**
   - `infrastructure/lightsail-containers.json.template` debe ser un JSON estrictamente válido.
   - Solo se permiten los placeholders: `__DB_POSTGRESDB_PASSWORD__`, `__N8N_ENCRYPTION_KEY__`, `__N8N_AUTH_SECRET__`.
5. **Políticas de Despliegue en Lightsail:**
   - Corre solo en merge a `main`. Requiere secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `DB_POSTGRESDB_PASSWORD`, `N8N_ENCRYPTION_KEY`, `N8N_AUTH_SECRET`.
   - Render está **completamente deprecado**. No introducir archivos `.disabled`, `render.yaml` ni crons de keep-alive.

#### 📋 Prompt para la IA de Arquitecto / DevOps:
```text
Actúa como Arquitecto de Software y Especialista DevOps para UrbanPulse:
1. El título de TODO Pull Request debe cumplir estrictamente con Conventional Commits: '<tipo>: <descripción>' (ejemplos: 'feat: agregar endpoint de login', 'fix: resolver error de CORS', 'ci: actualizar timeout'). Sin esto, la gobernanza requerida del repo rechazará el PR.
2. Todo script SQL en database/migrations/ debe compilar limpiamente bajo 'sqlfluff lint database/ --dialect postgres'.
3. En infrastructure/docker-compose.yml, nunca elimines la variable N8N_CORS_ALLOWED_ORIGINS (el pipeline de infraestructura valida su presencia obligatoria).
4. La arquitectura está migrada a AWS Lightsail Container Service con PostgreSQL Neon. No generes blueprints de Render ni tareas cron de keep-alive, ya que los contenedores en Lightsail corren de forma ininterrumpida 24/7.
```

---

## 🚀 Checklist Rápido previo a abrir un Pull Request

Antes de presionar "Create Pull Request", verifica:
- [ ] **Título del PR:** ¿Empieza con `feat:`, `fix:`, `chore:`, `ci:`, `test:`, `docs:` o `refactor:`?
- [ ] **Secretos:** ¿Revisaste con `git diff` que no haya ninguna API key ni contraseña real?
- [ ] **Build:** ¿Probaste `npm run build` en tu componente?
- [ ] **Lockfiles:** ¿Subiste tu `package-lock.json` junto con cualquier cambio en `package.json`?

---

## 🧱 Análisis de seguridad de IaC (HT-44 T02)

`terraform-ci.yml` analiza `infrastructure/terraform/` con **Trivy en modo config**
antes del `terraform plan`. Se usa Trivy y no el binario `tfsec` porque Aqua
Security fusionó tfsec dentro de Trivy; el repositorio de tfsec está en
mantenimiento y su propio README remite a Trivy. Así el análisis de IaC usa el
mismo motor y las mismas reglas que el escaneo de imágenes de HT-44 T01.

Dos pasos, a propósito:

| Paso | Severidades | ¿Bloquea? | Para qué |
|---|---|---|---|
| Informe | CRITICAL, HIGH, MEDIUM | No | Publica el SARIF en la pestaña **Security** |
| Gate | CRITICAL | Sí, antes del `plan` | Impide aplicar IaC con un hallazgo crítico |

**Pendiente de calibración:** el gate arranca solo en `CRITICAL`. El umbral que
queremos es `CRITICAL,HIGH`, pero subirlo sin haber triado los hallazgos
preexistentes dejaría en rojo los PR de todo el equipo. Después de la primera
ejecución:

1. Abrir la pestaña **Security → Code scanning**, categoría `trivy-iac`.
2. Revisar los hallazgos HIGH: corregir el Terraform, o justificar la excepción
   con un comentario `#trivy:ignore:<ID-de-regla>` en la línea correspondiente.
3. Cambiar `severity: CRITICAL` por `severity: CRITICAL,HIGH` en el paso
   *Análisis de seguridad de IaC - gate* y borrar esta nota.

## 🐳 Escaneo de imágenes y excepciones (HT-44 T01)

`trivy-scan.yml` escanea en cada Pull Request la imagen de **n8n**, la de
**Postgres** y el árbol de dependencias de **`ml/api`**. Cada uno corre dos
pasos con el mismo reparto que el análisis de IaC: un informe que publica todo
en **Security → Code scanning** y un *gate* que bloquea solo ante `CRITICAL`
**con parche disponible** (`ignore-unfixed: true`). Una CVE crítica sin parche
publicado no se puede arreglar actualizando nada, así que se reporta pero no
frena el merge.

### Cuando el gate se pone rojo

El orden de preferencia para resolverlo, de mejor a peor:

1. **Tomar el parche.** Si la imagen la construimos nosotros, actualizar la
   versión del paquete en el Dockerfile. Si la dependencia es de Python, subir
   la versión en el `requirements.txt` que corresponda.
2. **Quitar el componente vulnerable.** Muchas veces la pieza afectada ni
   siquiera se usa en ejecución. La API de riesgo instalaba `mlflow` completo
   —servidor de tracking, AI gateway y *model serving*, que es donde se
   publican casi todas sus CVE— cuando `main.py` solo necesita
   `mlflow.sklearn.load_model` sobre la carpeta horneada en la imagen. Pasar a
   **`mlflow-skinny`** y dejar el cliente de base de datos solo en la etapa
   *builder* (`ml/api/requirements-build.txt`) saca ese código del contenedor
   que queda expuesto: es una corrección real, no silenciar al escáner.
3. **Documentar la excepción**, solo si ninguna de las dos anteriores aplica,
   en `security/trivy-excepciones.yaml`. Ese archivo **no** se aplica solo:
   se pasa a mano con `trivyignores:` y únicamente en los pasos que bloquean,
   así que lo exceptuado sigue apareciendo en la pestaña Security.

### Reglas de una excepción

Toda entrada lleva las tres cosas o no entra:

- **`paths`**, para acotarla al binario o archivo concreto. La misma CVE en
  otro componente vuelve a bloquear.
- **`statement`**, explicando por qué el camino vulnerable no es alcanzable
  aquí, o por qué no existe versión parchada que podamos tomar.
- **`expired_at`**, una fecha de revisión. Cuando vence, Trivy deja de aplicar
  la excepción y el gate vuelve a bloquear. Es a propósito: obliga a volver a
  mirarlo en vez de acumular deuda silenciosa.

Hoy hay dos casos, los dos en la imagen de Postgres de desarrollo.

**`libgnutls30`.** El parche existe (`3.7.1-5+deb11u10`) y aun así no se puede
tomar: la base `postgis/postgis:16-3.5` está sobre **Debian 11 (bullseye), que
llegó a fin de vida**. Los índices siguen anunciando los paquetes de
`bullseye-security`, pero los `.deb` ya no se sirven desde `deb.debian.org`, así
que un `apt-get upgrade` termina en una pared de 404 y rompe el build entero
(pasó en la ejecución #56 de esta PR).

Eso convierte el hallazgo en algo más grande que dos CVE: **la imagen local está
sobre una distribución que ya no recibe parches**, así que de aquí en adelante
cualquier CVE nueva de esa base va a salir como "sin arreglo disponible" y el
gate ni siquiera la va a mostrar. La corrección de verdad es mover la imagen a
una base soportada — `pgvector/pgvector:pg16-bookworm` más PostGIS desde PGDG es
el camino más corto, porque mantiene PostgreSQL 16 y las dos extensiones.

No va en esta PR porque arrastra un detalle que rompería al equipo:
`backend-integration-tests.yml` y `rag-ingesta-ci.yml` esperan a que
`SELECT postgis_version()` responda **antes** de aplicar las migraciones, y eso
hoy funciona porque la imagen de PostGIS trae un script de `initdb` que activa
la extensión sola. Al cambiar de base hay que reponer ese script, o los dos
workflows se quedan esperando para siempre. Es un cambio propio, con su propia
prueba.

**`gosu`.** Lo compilaron con Go 1.18 y Trivy le atribuye las CVE de esa biblioteca estándar, pero `gosu`
solo baja de root al usuario `postgres` — no renderiza plantillas HTML, no abre
TLS y no parsea direcciones de red. No hay versión parchada en Debian bullseye,
y además esa imagen es solo de desarrollo y CI: en producción la base de datos
es **Neon**, gestionada.

### Probar que el gate bloquea de verdad

Actions → *DevSecOps - Escaneo Trivy de imagenes* → **Run workflow** → en
`imagen_prueba` escribir por ejemplo `python:3.8-slim-buster`. Ese job no usa
el archivo de excepciones, así que debe terminar en rojo.
