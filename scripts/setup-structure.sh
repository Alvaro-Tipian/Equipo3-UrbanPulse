#!/usr/bin/env bash
set -e
mkdir -p .github/workflows
mkdir -p src/frontend
mkdir -p src/n8n-workflows/production
mkdir -p src/n8n-workflows/templates
mkdir -p database/migrations
mkdir -p database/seeders
mkdir -p ia-ops/prompts
mkdir -p ia-ops/tests
mkdir -p infrastructure

touch src/frontend/.gitkeep
touch src/n8n-workflows/production/.gitkeep
touch src/n8n-workflows/templates/.gitkeep
touch database/migrations/.gitkeep
touch database/seeders/.gitkeep
touch ia-ops/prompts/.gitkeep
touch ia-ops/tests/.gitkeep

echo "Estructura inicial creada con placeholders."
