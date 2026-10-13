# Infraestructura de UrbanPulse

## 1. Resumen

Este directorio contiene la infraestructura como código (Terraform, en `terraform/`) de:

- El servicio de contenedores de **n8n en AWS Lightsail** de producción (`urbanpulse-n8n`, región `us-east-1`).
- El servicio de contenedores de la **API de riesgo vial** (`urbanpulse-api`, HT-47 T02), separado del de n8n. Despliega la API de HT-46 T03 (`ml/api`) con `deploy-api-inferencia.yml` y `lightsail-api-containers.json.template`. n8n la encuentra en `URBANPULSE_RIESGO_API_URL`.
- Los **8 proyectos de Vercel** (host + microfrontends), importados desde la cuenta personal.

También hay archivos de apoyo: `docker-compose.yml`, `postgres.Dockerfile` (entorno local) y `lightsail-containers.json.template` (despliegue de la imagen de n8n, que hace GitHub Actions con `deploy-lightsail-n8n.yml`).

**Qué NO cubre:** DagsHub/MLflow ni Neon (base de datos). Ambos se administran fuera de Terraform. El entorno de staging (sección 3) tampoco está declarado todavía en los `.tf`.

## 2. Proyectos de Vercel

Fuente: `terraform/vercel.tf` (repo `SergioAscurraPerez/Equipo3-UrbanPulse`) y constantes `PROD_REMOTE_*_URL` de `src/frontend/vite.config.js`.

| Proyecto (Vercel) | Carpeta raíz | URL de producción | URL de staging |
|---|---|---|---|
| `equipo3-urban-pulse` (host) | `src/frontend` | POR COMPLETAR (no figura en el código) | POR COMPLETAR |
| `equipo3-urban-pulse-dashboard` | `mf-dashboard` | https://equipo3-urban-pulse-jti7.vercel.app | POR COMPLETAR |
| `equipo3-urban-pulse-mapa-urbano` | `mf-mapa-urbano` | https://equipo3-urban-pulse-e9i8.vercel.app | POR COMPLETAR |
| `equipo3-urban-pulse-chatbot` | `mf-chatbot` | https://equipo3-urban-pulse-jbf3.vercel.app | POR COMPLETAR |
| `equipo3-urban-pulse-gestion-incidentes` | `mf-gestion-incidentes` | https://equipo3-urban-pulse-gestion-inciden.vercel.app | POR COMPLETAR |
| `equipo3-urban-pulse-historial-reportes` | `mf-historial-reportes` | https://equipo3-urban-pulse-historial-repor.vercel.app | POR COMPLETAR |
| `equipo3-urban-pulse-auth` | `mf-auth` | https://equipo3-urban-pulse-auth.vercel.app | POR COMPLETAR |
| `equipo3-urban-pulse-ajustes` | `mf-ajustes` | https://equipo3-urban-pulse-ajustes-pi.vercel.app | POR COMPLETAR |

Las URLs de producción del host hacia cada microfrontend terminan en `/remoteEntry.js`. Las URLs de staging las define Kiara cuando exista rama/alias de staging.

## 3. Entorno de staging

- **n8n staging:** servicio de contenedores de Lightsail `urbanpulse-n8n-staging` (región `us-east-1`).
  URL: https://urbanpulse-n8n-staging.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com
- **Base de datos:** base `n8n_staging` dentro de la rama `staging` del proyecto Neon `urbanpulse`. Está vacía e independiente de producción. Las credenciales no se documentan aquí.
- **Cifrado y workflows:** usa su propio `N8N_ENCRYPTION_KEY`. Los workflows se importan a mano, inactivos, con credenciales de prueba.
- **Vercel:** la variable `VITE_N8N_BASE_URL` está definida solo en el entorno **Preview** (tipo Config) y apunta al n8n de staging. Producción no se ve afectada.
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
| `VERCEL_API_TOKEN` (provider de Vercel en Terraform) | Variable de entorno local / gestor personal; en CI se agrega en T03 |
| Credenciales de AWS para Terraform (backend S3) | Perfil/variables de entorno locales; en CI se agregan en T03 |
| `N8N_ENCRYPTION_KEY` y credenciales de Neon de staging | Gestor personal (POR CONFIRMAR) |

Los secretos de Terraform en CI se agregan en T03.

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

- **T03:** workflow de GitHub Actions con `fmt`, `validate` y `plan`, y alta de sus secretos.
- Alta de `mf-panel-riesgo` en Terraform cuando Kiara avise nombre y carpeta raíz.
- Declarar en Terraform el servicio `urbanpulse-n8n-staging` (hoy solo existe el de producción en `main.tf`).
- Completar URLs de staging y de producción del host, y `MLFLOW_TRACKING_URI`.
