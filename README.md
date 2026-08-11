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

## Gobernanza y seguridad

- El pipeline CI verifica que los títulos de PR sigan Conventional Commits.
- Se escanean los workflows n8n para detectar credenciales hardcodeadas.
- No se deben subir archivos con credenciales, claves o datos sensibles.

## Scripts

- `scripts/setup-structure.ps1` - Crea la estructura de carpetas en PowerShell.
- `scripts/setup-structure.sh` - Crea la estructura de carpetas en Bash.

## Notas de Sprint 0

Esta base está diseñada para Semana 2A / Sprint 0 con enfoque en:
- estructura y gobernanza estricta,
- trazabilidad extrema,
- separación clara de componentes,
- cumplimiento de buenas prácticas DevSecOps.
