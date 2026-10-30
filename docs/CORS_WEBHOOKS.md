# CORS de los webhooks `/urbanpulse/*` (HT-36 T02)

**Antes:** los webhooks tenían `Allowed Origins = *` o no tenían la opción, que en n8n es lo mismo: cualquier página podía llamarlos desde el navegador de un usuario.
**Ahora:** solo los orígenes de la app. La cabecera `Authorization` del token (contrato C1, `docs/AUTH_TOKEN_CONTRACT.md`) se acepta en el preflight.

## Lista de orígenes

Va en **Webhook → Options → Allowed Origins (CORS)**, separada por comas y **sin espacios**:

```
https://equipo3-urban-pulse.vercel.app,https://equipo3-u-git-cc0c7a-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app,http://localhost:3000,http://localhost:3003,http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://localhost:5177,http://localhost:5178,http://localhost:5181
```

| Origen | Qué es |
|---|---|
| `https://equipo3-urban-pulse.vercel.app` | Host de producción. **Va primero** (ver *Cómo responde n8n*). |
| `https://equipo3-u-git-cc0c7a-…vercel.app` | Host de staging, rama `staging` (`infrastructure/README.md`) |
| `http://localhost:3000` | `src/frontend` (host) |
| `http://localhost:3003` | `mf-chatbot` |
| `http://localhost:5173` | `mf-gestion-incidentes` |
| `http://localhost:5174` | `mf-mapa-urbano` |
| `http://localhost:5175` | `mf-dashboard` |
| `http://localhost:5176` | `mf-historial-reportes` |
| `http://localhost:5177` | `mf-auth` |
| `http://localhost:5178` | `mf-ajustes` |
| `http://localhost:5181` | `mf-panel-riesgo` |

Basta con los **hosts**: los microfrontends se cargan dentro del host con Module Federation, así que su código llama a n8n con el origen del host. Abrir el dominio de un microfrontend por separado ya no puede llamar a n8n.

## Webhooks

| Workflow | Webhooks | Producción |
|---|---|---|
| UrbanPulse - Dashboard KPIs | 9 (`chat-history-append`, `chat-history`, `dashboard-kpis`, `reports-list`, `reports-history`, `report-image`, `report-resolve`, `mapa-siniestros-onsv`, `mapa-siniestros-sutran`) | Aplicado y publicado (20/10) |
| UrbanPulse - Dashboard KPIs (HU-11 T01) | `kpis-operativos` | **Pendiente:** se aplica al importar y publicar el workflow |
| UrbanPulse - Riesgo Predictivo (HU-08 T04) | `riesgo-predictivo` | Aplicado y publicado (20/10) |
| UrbanPulse - Estado de la Plataforma (HU-13 T01) | `estado-plataforma` | Aplicado y publicado (20/10) |
| UrbanPulse - Operativos (HU-09 T02) | 5 (`incidentes-por-zona`, `operativos` GET y POST, `cuadrillas`, `operativos/asignar`) | **Pendiente:** se aplica al importar y publicar el workflow |
| UrbanPulse - Alertas del Ciudadano (HU-10 T03) | 3 (`alertas`, `alertas/descartar`, `ubicacion`) | **Pendiente:** se aplica al importar y publicar el workflow |
| UrbanPulse - Enrutador de Eventos (HT-51 T02) | `eventos` | Aplicado y publicado (20/10) |
| UrbanPulse - Registrar Despliegue (HT-41 T03) | `despliegue` | Aplicado y publicado (20/10) |
| UrbanPulse - Central | 5 (`chat`, `auth/login`, `auth/register`, `auth/forgot`, `auth/reset`) | **Pendiente, a mano:** el workflow no está disponible para el MCP. Pegar la lista en los 5 webhooks y publicar. |

`eventos` y `despliegue` los llaman servidores (n8n, GitHub Actions y la función de Vercel), que no envían `Origin`, así que la lista no les cambia nada. Se les pone igual porque, sin la opción, n8n acepta cualquier origen.

## Cómo responde n8n

Según `WebhookRequestHandler.setupCorsHeaders` (n8n 2.x), y solo si la petición trae `Origin`:

- **Origen de la lista:** `Access-Control-Allow-Origin` devuelve ese mismo origen.
- **Origen ajeno:** devuelve el **primero de la lista** (producción). El navegador ve que no es el suyo y **bloquea la respuesta**.
- **Preflight (`OPTIONS`):** responde `204`, con `Access-Control-Allow-Methods` y `Access-Control-Max-Age: 300`. `Access-Control-Allow-Headers` repite lo que pide el navegador, así que `Authorization` y `Content-Type` pasan sin configurar nada más.
- La lista se separa por comas **sin recortar espacios**: `", http://localhost:3000"` no coincidiría nunca.

## Agregar un dominio

1. Agregarlo al final de la lista, sin espacios, en **todos** los webhooks de la tabla, y publicar.
2. Actualizar `ORIGENES` en `ia-ops/workflows/tests/test_cors_webhooks.py` y la tabla de arriba.
3. Exportar los workflows al repositorio. La prueba falla si algún webhook `/urbanpulse/*` no tiene exactamente la lista.

## Comprobarlo

PowerShell (Windows):

```powershell
$url = "https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/webhook/urbanpulse/reports-list"
foreach ($o in "https://equipo3-urban-pulse.vercel.app", "https://atacante.example") {
  $r = Invoke-WebRequest -Uri $url -Method Options -UseBasicParsing -Headers @{
    "Origin" = $o
    "Access-Control-Request-Method" = "GET"
    "Access-Control-Request-Headers" = "authorization,content-type"
  }
  "$o -> $($r.StatusCode) | ACAO: $($r.Headers['Access-Control-Allow-Origin']) | Headers: $($r.Headers['Access-Control-Allow-Headers'])"
}
```

curl:

```bash
curl -s -o /dev/null -D - -X OPTIONS "$URL" \
  -H "Origin: https://atacante.example" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization,content-type" | grep -i "^HTTP\|access-control"
```

Esperado:

| Origen | Estado | `Access-Control-Allow-Origin` |
|---|---|---|
| `https://equipo3-urban-pulse.vercel.app` | `204` | `https://equipo3-urban-pulse.vercel.app` |
| `https://atacante.example` | `204` | `https://equipo3-urban-pulse.vercel.app` (no el suyo: el navegador bloquea) |

## Pruebas

`ia-ops/workflows/tests/test_cors_webhooks.py`:

- cada webhook `/urbanpulse/*` de `ia-ops/workflows` y `src/n8n-workflows/production` tiene exactamente la lista, sin `*` ni espacios;
- con la lógica de n8n, cada origen de la app recibe el suyo y un origen ajeno (incluido `…vercel.app.atacante.example` y `null`) recibe el de producción.
