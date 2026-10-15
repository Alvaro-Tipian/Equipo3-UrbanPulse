# Proyectos de Vercel ya existentes (cuenta personal), importados a Terraform.
# Los valores reflejan la configuración real; solo se declaran atributos con valor.

locals {
  vercel_git_repo = "SergioAscurraPerez/Equipo3-UrbanPulse"

  # "Ignored Build Step" de Vercel: no construye si el commit no toca la
  # carpeta raíz del proyecto. Sin declararlo, el plan lo pone en null.
  # En la rama staging construye siempre (exit 1 = construir), para que cada
  # proyecto tenga su URL fija de staging (remotes.staging.json, HT-42 T02).
  vercel_ignore_command = "[ \"$VERCEL_GIT_COMMIT_REF\" = \"staging\" ] && exit 1; git diff --quiet HEAD^ HEAD -- ."

  vercel_projects = {
    host = {
      name           = "equipo3-urban-pulse"
      framework      = null
      root_directory = "src/frontend"
    }
    chatbot = {
      name           = "equipo3-urban-pulse-chatbot"
      framework      = "vite"
      root_directory = "mf-chatbot"
    }
    ajustes = {
      name           = "equipo3-urban-pulse-ajustes"
      framework      = "vite"
      root_directory = "mf-ajustes"
    }
    gestion-incidentes = {
      name           = "equipo3-urban-pulse-gestion-incidentes"
      framework      = "vite"
      root_directory = "mf-gestion-incidentes"
    }
    mapa-urbano = {
      name           = "equipo3-urban-pulse-mapa-urbano"
      framework      = "vite"
      root_directory = "mf-mapa-urbano"
    }
    auth = {
      name           = "equipo3-urban-pulse-auth"
      framework      = "vite"
      root_directory = "mf-auth"
    }
    historial-reportes = {
      name           = "equipo3-urban-pulse-historial-reportes"
      framework      = "vite"
      root_directory = "mf-historial-reportes"
    }
    dashboard = {
      name           = "equipo3-urban-pulse-dashboard"
      framework      = "vite"
      root_directory = "mf-dashboard"
    }
    panel-riesgo = {
      name           = "equipo3-urbanpulse-panel-riesgo"
      framework      = "vite"
      root_directory = "mf-panel-riesgo"
    }
  }
}

# mf-panel-riesgo (HU-08) se creó a mano en Vercel; se importa en el apply.
import {
  to = vercel_project.mf["panel-riesgo"]
  id = "prj_qwELVvFArP3QM34zzL4MiSqHtMgI"
}

resource "vercel_project" "mf" {
  for_each = local.vercel_projects

  name           = each.value.name
  framework      = each.value.framework
  root_directory = each.value.root_directory
  # panel-riesgo se creó sin Ignored Build Step; se declara igual que en Vercel.
  ignore_command = each.key == "panel-riesgo" ? null : local.vercel_ignore_command

  # El host no tiene skew protection en Vercel; solo los microfrontends.
  skew_protection = each.key == "host" ? null : "12 hours"

  # El host de staging carga el remoteEntry.js de cada microfrontend desde su
  # URL de rama; con Vercel Authentication esa carga redirige al login. Los
  # microfrontends quedan sin protección (son bundles públicos, igual que en
  # producción) y el host conserva la estándar.
  vercel_authentication = {
    deployment_type = each.key == "host" ? "standard_protection_new" : "none"
  }

  git_repository = {
    type = "github"
    repo = local.vercel_git_repo
  }

  lifecycle {
    prevent_destroy = true
  }
}

# HT-42 T01: variables de entorno del proyecto host (src/frontend) que usa la
# funcion serverless api/cambio-despliegue. Se marcan sensitive tambien en
# Vercel, que solo admite este modo en production y preview.
locals {
  host_env_vars = {
    DEPLOY_WEBHOOK_SECRET = var.deploy_webhook_secret
    JIRA_BASE_URL         = var.jira_base_url
    JIRA_EMAIL            = var.jira_email
    JIRA_API_TOKEN        = var.jira_api_token
  }
}

resource "vercel_project_environment_variable" "host" {
  # nonsensitive solo sobre las claves: los valores siguen siendo sensibles.
  for_each = nonsensitive(toset(keys(local.host_env_vars)))

  project_id = vercel_project.mf["host"].id
  key        = each.key
  value      = local.host_env_vars[each.key]
  target     = ["production", "preview"]
  sensitive  = true
}
