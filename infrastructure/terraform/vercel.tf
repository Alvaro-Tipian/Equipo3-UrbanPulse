# Proyectos de Vercel ya existentes (cuenta personal), importados a Terraform.
# Los valores reflejan la configuración real; solo se declaran atributos con valor.

locals {
  vercel_git_repo = "SergioAscurraPerez/Equipo3-UrbanPulse"

  # "Ignored Build Step" de Vercel: no construye si el commit no toca la
  # carpeta raíz del proyecto. Sin declararlo, el plan lo pone en null.
  vercel_ignore_command = "git diff --quiet HEAD^ HEAD -- ."

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
  }
}

resource "vercel_project" "mf" {
  for_each = local.vercel_projects

  name           = each.value.name
  framework      = each.value.framework
  root_directory = each.value.root_directory
  ignore_command = local.vercel_ignore_command

  # El host no tiene skew protection en Vercel; solo los microfrontends.
  skew_protection = each.key == "host" ? null : "12 hours"

  git_repository = {
    type = "github"
    repo = local.vercel_git_repo
  }

  lifecycle {
    prevent_destroy = true
  }
}
