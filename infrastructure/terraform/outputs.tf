output "n8n_url" {
  value = aws_lightsail_container_service.n8n.url
}

output "n8n_staging_url" {
  value = aws_lightsail_container_service.n8n_staging.url
}

output "api_inferencia_url" {
  value = aws_lightsail_container_service.api_inferencia.url
}
