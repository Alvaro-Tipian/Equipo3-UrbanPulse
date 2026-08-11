$paths = @(
  '.github',
  '.github/workflows',
  'src/frontend',
  'src/n8n-workflows/production',
  'src/n8n-workflows/templates',
  'database/migrations',
  'database/seeders',
  'ia-ops/prompts',
  'ia-ops/tests',
  'infrastructure'
)
foreach ($path in $paths) {
  if (-not (Test-Path $path)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }
}
$keepFiles = @(
  'src/frontend/.gitkeep',
  'src/n8n-workflows/production/.gitkeep',
  'src/n8n-workflows/templates/.gitkeep',
  'database/migrations/.gitkeep',
  'database/seeders/.gitkeep',
  'ia-ops/prompts/.gitkeep',
  'ia-ops/tests/.gitkeep'
)
foreach ($file in $keepFiles) {
  if (-not (Test-Path $file)) {
    New-Item -ItemType File -Path $file -Force | Out-Null
  }
}
Write-Host 'Estructura inicial creada con placeholders.'
