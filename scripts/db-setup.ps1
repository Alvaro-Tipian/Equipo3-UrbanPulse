$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"
Write-Host "== Aplicando migraciones =="
Get-ChildItem "database/migrations" -Filter "*.sql" | Sort-Object Name | ForEach-Object {
    Write-Host "-> $($_.Name)"
    Get-Content $_.FullName -Encoding UTF8 | docker exec -i urbanpulse-db psql -U urban_admin -d urbanpulse_db
}
Write-Host "== Aplicando seeders =="
Get-ChildItem "database/seeders" -Filter "*.sql" | Sort-Object Name | ForEach-Object {
    Write-Host "-> $($_.Name)"
    Get-Content $_.FullName -Encoding UTF8 | docker exec -i urbanpulse-db psql -U urban_admin -d urbanpulse_db
}
Write-Host "== Listo. Tablas actuales =="
docker exec -i urbanpulse-db psql -U urban_admin -d urbanpulse_db -c "\dt"