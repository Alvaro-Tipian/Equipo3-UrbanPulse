#!/usr/bin/env bash
# HT-51 T04 - Pruebas manuales del Enrutador de Eventos (POST /webhook/urbanpulse/eventos).
#
# Corre con curl los mismos casos que la coleccion Newman
# postman/collections/urbanpulse-eventos-router.postman_collection.json y
# muestra el codigo HTTP de cada uno.
#
# Uso (Git Bash, Linux o macOS):
#   export BASE_URL="https://<host-de-n8n>"   # sin "/" final
#   export EVENT_TOKEN="<valor del header X-Event-Token>"
#   bash scripts/test-eventos-staging.sh
#
# No guarda ni imprime el token. El UUID v4 se genera con node o PowerShell
# (no depende de uuidgen). Termina con codigo 1 si algun caso no da el codigo
# esperado.
#
# El caso g) solo comprueba que el router acepta (202). Para la prueba del
# suscriptor caido, deja SUSCRIPTOR_CAIDO = true en "Suscriptor de Prueba",
# verifica en la tabla eventos que quede 'fallido' y luego ejecuta a mano
# "Reproceso de Eventos".

set -u

if [ -z "${BASE_URL:-}" ] || [ -z "${EVENT_TOKEN:-}" ]; then
  echo "Faltan variables de entorno: define BASE_URL y EVENT_TOKEN." >&2
  exit 2
fi

ENDPOINT="${BASE_URL%/}/webhook/urbanpulse/eventos"
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT
FAILS=0

gen_uuid() {
  local u=""
  if command -v node >/dev/null 2>&1; then
    u="$(node -e "console.log(require('crypto').randomUUID())" 2>/dev/null)"
  fi
  if [ -z "$u" ]; then
    for ps in powershell.exe powershell pwsh; do
      if command -v "$ps" >/dev/null 2>&1; then
        u="$("$ps" -NoProfile -Command "[guid]::NewGuid().ToString()" 2>/dev/null)"
        [ -n "$u" ] && break
      fi
    done
  fi
  u="$(printf '%s' "$u" | tr -d '\r\n' | tr 'A-Z' 'a-z')"
  if [ -z "$u" ]; then
    echo "No se pudo generar un UUID: instala node o usa PowerShell." >&2
    exit 2
  fi
  printf '%s' "$u"
}

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# sobre <id> <tipo> <fecha> <datos_json>
sobre() {
  printf '{"id":"%s","tipo":"%s","fecha":"%s","origen":"curl/pruebas-eventos","datos":%s}' "$1" "$2" "$3" "$4"
}

DATOS_OK='{"reporte_id":1842,"distrito":"Miraflores","franja":"tarde","tipo_incidente":"choque"}'
DATOS_FALLO='{"reporte_id":1842,"distrito":"Miraflores","franja":"tarde","tipo_incidente":"choque","simular_fallo":true}'

# caso <etiqueta> <codigo_esperado> <token|none> <payload> <token_valor>
caso() {
  local etiqueta="$1" esperado="$2" modo="$3" payload="$4" codigo
  local args=(-sS -o "$BODY_FILE" -w '%{http_code}' -X POST "$ENDPOINT" -H 'Content-Type: application/json')
  case "$modo" in
    ok)    args+=(-H "X-Event-Token: ${EVENT_TOKEN}") ;;
    wrong) args+=(-H 'X-Event-Token: token-incorrecto-de-prueba') ;;
    none)  ;;
  esac
  codigo="$(curl "${args[@]}" --data "$payload")" || codigo="000"
  local estado="OK  "
  if [ "$codigo" != "$esperado" ]; then
    estado="FAIL"
    FAILS=$((FAILS + 1))
  fi
  printf '%s  %-48s esperado=%s obtenido=%s\n' "$estado" "$etiqueta" "$esperado" "$codigo"
  printf '      respuesta: %s\n' "$(head -c 200 "$BODY_FILE")"
}

ID_VALIDO="$(gen_uuid)"
ID_FALLO="$(gen_uuid)"

echo "Endpoint: ${ENDPOINT}"
echo "----------------------------------------------------------------"
caso "a) sin header X-Event-Token"            403 none  "$(sobre "$(gen_uuid)" reporte.creado "$NOW" "$DATOS_OK")"
caso "b) token incorrecto"                    403 wrong "$(sobre "$(gen_uuid)" reporte.creado "$NOW" "$DATOS_OK")"
caso "c) evento valido reporte.creado"        202 ok    "$(sobre "$ID_VALIDO" reporte.creado "$NOW" "$DATOS_OK")"
caso "d) mismo id repetido (idempotencia)"    202 ok    "$(sobre "$ID_VALIDO" reporte.creado "$NOW" "$DATOS_OK")"
caso "e) tipo desconocido"                    400 ok    "$(sobre "$(gen_uuid)" reporte.inexistente "$NOW" "$DATOS_OK")"
caso "f) fecha invalida (\"ayer\")"           400 ok    "$(sobre "$(gen_uuid)" reporte.creado ayer "$DATOS_OK")"
caso "g) datos.simular_fallo = true"          202 ok    "$(sobre "$ID_FALLO" reporte.creado "$NOW" "$DATOS_FALLO")"
echo "----------------------------------------------------------------"
echo "id caso c/d (idempotencia): ${ID_VALIDO}"
echo "id caso g (suscriptor caido): ${ID_FALLO}"

if [ "$FAILS" -gt 0 ]; then
  echo "${FAILS} caso(s) con codigo HTTP inesperado."
  exit 1
fi
echo "Todos los casos dieron el codigo esperado."
