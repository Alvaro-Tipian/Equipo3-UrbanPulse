# Infraestructura de UrbanPulse

## 1. Resumen

Este directorio contiene la infraestructura como código (Terraform, en `terraform/`) de:

- Los servicios de contenedores de **n8n en AWS Lightsail**: producción (`urbanpulse-n8n`) y staging (`urbanpulse-n8n-staging`), región `us-east-1`.
- El servicio de contenedores de la **API de riesgo vial** (`urbanpulse-api`, HT-47 T02), separado del de n8n. Despliega la API de HT-46 T03 (`ml/api`) con `deploy-api-inferencia.yml` y `lightsail-api-containers.json.template`. n8n la encuentra en `URBANPULSE_RIESGO_API_URL`.
- Los **9 proyectos de Vercel** (host + 8 microfrontends, incluido `mf-panel-riesgo`), importados desde la cuenta personal.

También hay archivos de apoyo: `docker-compose.yml`, `postgres.Dockerfile` (entorno local) y `lightsail-containers.json.template` (despliegue de la imagen de n8n, que hace GitHub Actions con `deploy-lightsail-n8n.yml`).

**Conexiones de n8n a su base (`DB_POSTGRESDB_POOL_SIZE = 10`).** Por defecto n8n abre solo 2 conexiones a su propia base de datos y espera 20 s por una libre. Con 2, el mapa (5 o 6 webhooks a la vez) dejaba peticiones en cola hasta agotar la espera: n8n respondía error sin cabeceras CORS y el navegador lo informaba como "falta Access-Control-Allow-Origin" (ejecución 8599, 30/10/2026). La base de n8n está en Neon `sa-east-1` y el contenedor en `us-east-1`, así que cada consulta interna suma la latencia entre regiones.

**Qué NO cubre:** DagsHub/MLflow ni Neon (base de datos). Ambos se administran fuera de Terraform.

## 2. Proyectos de Vercel

Fuente: `terraform/vercel.tf` (repo `SergioAscurraPerez/Equipo3-UrbanPulse`) y constantes `PROD_REMOTE_*_URL` de `src/frontend/vite.config.js`.

| Proyecto (Vercel) | Carpeta raíz | URL de producción | URL de staging |
|---|---|---|---|
| `equipo3-urban-pulse` (host) | `src/frontend` | https://equipo3-urban-pulse.vercel.app | https://equipo3-u-git-cc0c7a-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app |
| `equipo3-urban-pulse-dashboard` | `mf-dashboard` | https://equipo3-urban-pulse-jti7.vercel.app | https://equipo3-u-git-a1f9d8-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app |
| `equipo3-urban-pulse-mapa-urbano` | `mf-mapa-urbano` | https://equipo3-urban-pulse-e9i8.vercel.app | https://equipo3-u-git-c9d258-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app |
| `equipo3-urban-pulse-chatbot` | `mf-chatbot` | https://equipo3-urban-pulse-jbf3.vercel.app | https://equipo3-u-git-4a1be3-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app |
| `equipo3-urban-pulse-gestion-incidentes` | `mf-gestion-incidentes` | https://equipo3-urban-pulse-gestion-inciden.vercel.app | https://equipo3-u-git-20071a-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app |
| `equipo3-urban-pulse-historial-reportes` | `mf-historial-reportes` | https://equipo3-urban-pulse-historial-repor.vercel.app | https://equipo3-u-git-6e4baf-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app |
| `equipo3-urban-pulse-auth` | `mf-auth` | https://equipo3-urban-pulse-auth.vercel.app | https://equipo3-u-git-b725fd-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app |
| `equipo3-urban-pulse-ajustes` | `mf-ajustes` | https://equipo3-urban-pulse-ajustes-pi.vercel.app | https://equipo3-u-git-20fea2-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app |
| `equipo3-urbanpulse-panel-riesgo` | `mf-panel-riesgo` | POR COMPLETAR (Kiara) | https://equipo3-u-git-89eec9-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app |

Las URLs de producción del host hacia cada microfrontend terminan en `/remoteEntry.js`. Las URLs de staging son las URLs fijas de la rama `staging` de cada proyecto y están en `src/frontend/public/remotes.staging.json`. En la rama `staging` Vercel construye siempre (`ignore_command`), y los microfrontends no tienen Vercel Authentication para que el host pueda cargar su `remoteEntry.js`; el host sí la conserva.

## 3. Entorno de staging

- **n8n staging:** servicio de contenedores de Lightsail `urbanpulse-n8n-staging` (región `us-east-1`).
  URL: https://urbanpulse-n8n-staging.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com
- **Base de datos:** base `n8n_staging` dentro de la rama `staging` del proyecto Neon `urbanpulse`. Está vacía e independiente de producción. Las credenciales no se documentan aquí.
- **Cifrado y workflows:** usa su propio `N8N_ENCRYPTION_KEY`. Los workflows se importan a mano, inactivos, con credenciales de prueba.
- **Vercel:** la variable `VITE_N8N_BASE_URL` está definida solo en el entorno **Preview** (tipo Config) y apunta al n8n de staging. En el host, `VITE_IS_STAGING=true` (Preview, rama `staging`) hace que cargue `remotes.staging.json`. Producción no se ve afectada.
- **Host de staging:** https://equipo3-u-git-cc0c7a-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app (rama `staging`).
- **Estado:** Verificación pendiente: falta redeploy de un preview para confirmar que las llamadas van al n8n de staging (bloqueado por límite de deploys del plan gratuito de Vercel).

## 4. MLflow

El tracking de experimentos usa **DagsHub** (un servidor MLflow por repositorio).

- `MLFLOW_TRACKING_URI`: POR COMPLETAR con la URL del repo en DagsHub.
- Plan B descartado: Lightsail Nano.

## 5. Secretos

Nunca se documentan valores. Esta tabla indica dónde vive cada uno (según workflows de `.github/workflows` y `.env.example`).

| Secreto | Dónde vive |
|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | GitHub Secrets (deploy de n8n) |
| `DB_POSTGRESDB_PASSWORD`, `N8N_ENCRYPTION_KEY`, `N8N_AUTH_SECRET` | GitHub Secrets (deploy de n8n producción) |
| `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD` | GitHub Secrets (CI de base de datos y health check) |
| `FRONTEND_URL`, `N8N_WEBHOOK_URL`, `N8N_CHAT_WEBHOOK_URL`, `N8N_GEOJSON_ONSV_URL`, `N8N_GEOJSON_SUTRAN_URL` | GitHub Secrets |
| `GEMINI_API_KEY`, `GEMINI_API_KEY_QA`, `GROQ_API_KEY`, `TOMTOM_API_KEY` | GitHub Secrets (tests) |
| `JIRA_API_TOKEN`, `JIRA_SERVICE_DESK_TOKEN` | GitHub Secrets |
| `MLFLOW_TRACKING_URI`, `MLFLOW_TRACKING_USERNAME`, `MLFLOW_TRACKING_PASSWORD` | GitHub Secrets (pipeline MLOps y build de la API de riesgo) |
| `RIESGO_API_KEY` | GitHub Secrets (se inyecta como `API_KEY` en el contenedor de la API) y credencial Header Auth de n8n que llama a la API |
| `VITE_TOMTOM_API_KEY`, variables `TE_N8N_*` | Vercel (consola, ver `docs/VERCEL_PRODUCTION_KEYS_HARDENING.md`) |
| `VITE_N8N_BASE_URL` (solo Preview) | Vercel |
| `VERCEL_API_TOKEN` (provider de Vercel en Terraform) | Variable de entorno local; en CI, secret `TF_VERCEL_API_TOKEN` |
| Credenciales de AWS para Terraform (backend S3) | Perfil/variables de entorno locales; en CI, secrets `TF_AWS_ACCESS_KEY_ID` y `TF_AWS_SECRET_ACCESS_KEY` |
| `N8N_ENCRYPTION_KEY` y credenciales de Neon de staging | Gestor personal (POR CONFIRMAR) |

El plan corre en cada PR que toca `infrastructure/terraform/**` (`terraform-ci.yml`) y el apply es manual (`workflow_dispatch` en `main`) con aprobación del entorno `production`.

## 6. Correr `terraform plan` localmente

El backend es S3 (`urbanpulse-tfstate-976991912762`, key `urbanpulse/terraform.tfstate`, `us-east-1`, con lockfile) y requiere Terraform `>= 1.10`.

```bash
# Credenciales de AWS ya configuradas (perfil o variables de entorno)
export VERCEL_API_TOKEN=...   # token de Vercel, nunca se sube al repo

cd infrastructure/terraform
terraform init
terraform fmt -check
terraform validate
terraform plan
```

En PowerShell, usa `$env:VERCEL_API_TOKEN = "..."`. Los proyectos de Vercel tienen `prevent_destroy = true`.

## 7. Pendientes

- Completar `MLFLOW_TRACKING_URI` y la URL de producción de `mf-panel-riesgo`.
- Variables de la función serverless del host (`DEPLOY_WEBHOOK_SECRET`, `JIRA_*`) como `vercel_project_environment_variable`, cuando Emily las defina (HT-41 T06).
