variable "aws_region" {
  type    = string
  default = "us-east-1"
}

# HT-42 T01: variables de entorno de la funcion serverless cambio-despliegue
# (src/frontend/api/cambio-despliegue.js) en el proyecto host de Vercel.
# Los valores llegan como TF_VAR_* desde los secrets de GitHub (terraform-ci.yml);
# nunca se escriben en el repositorio.
variable "deploy_webhook_secret" {
  description = "Secreto compartido con el pipeline que firma el POST de cambio de despliegue."
  type        = string
  sensitive   = true
}

variable "jira_base_url" {
  description = "URL base de Jira, p.ej. https://urbanpulse-ti.atlassian.net."
  type        = string
  sensitive   = true
}

variable "jira_email" {
  description = "Cuenta de servicio con acceso al portal de Jira."
  type        = string
  sensitive   = true
}

variable "jira_api_token" {
  description = "Token de API de la cuenta de servicio de Jira."
  type        = string
  sensitive   = true
}
