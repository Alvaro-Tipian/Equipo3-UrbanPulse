# Servicio de contenedores de n8n (ya existe: se importa, no se recrea).
# Los despliegues de imagen los hace GitHub Actions (deploy-lightsail-n8n.yml);
# Terraform solo administra el servicio.
resource "aws_lightsail_container_service" "n8n" {
  name  = "urbanpulse-n8n"
  power = "micro"
  scale = 1
}

# Servicio de contenedores de la API de inferencia de riesgo vial (HT-47 T02).
# Igual que n8n: Terraform administra el servicio y GitHub Actions publica las
# imagenes (deploy-api-inferencia.yml, invocado por mlops-pipeline.yml).
# Si el servicio ya fue creado a mano, importarlo antes del primer apply:
#   terraform import aws_lightsail_container_service.api_inferencia urbanpulse-api
resource "aws_lightsail_container_service" "api_inferencia" {
  name  = "urbanpulse-api"
  power = "micro"
  scale = 1
}
