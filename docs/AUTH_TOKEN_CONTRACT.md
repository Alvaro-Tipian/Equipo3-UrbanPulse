# Contrato C1 · Token en cada petición (HT-36 T01)

**Publica:** Álvaro (HT-36 T01). **Usan:** Emily (HU-09 T02, HU-10 T03), Sebastián (HU-11 T01), Kiara (HT-36 T03) y Fabio (HT-36 T07).

## Petición

```http
Authorization: Bearer <token del login>
```

El token es el que devuelven `/urbanpulse/auth/login` y `/urbanpulse/auth/register` (Central, nodo *Generar token*):

```
base64url(payload) + "." + HMAC-SHA256(base64url(payload), N8N_AUTH_SECRET) en hexadecimal
payload = { sub, id, role, iat, exp }      // iat y exp en milisegundos, 12 horas de vigencia
```

## Subworkflow «UrbanPulse - Validar token (HT-36 T01)»

- **Archivo:** `ia-ops/workflows/n8n_validar_token.json` (copia idéntica en `src/n8n-workflows/production/urbanpulse-validar-token.json`).
- **ID en n8n de producción:** `oZ37TgMUk25HTkmh`.

**Entrada** (Execute Workflow → *Workflow Inputs*):

| Campo | Valor |
|---|---|
| `rol_minimo` | `"ciudadano"` o `"operador"`. Un valor desconocido exige `operador`. |
| `authorization` | `{{ $json.headers.authorization }}` del webhook. |
| `permitir_sin_token` | Solo para los webhooks que ya existían (ver *Modo de transición*). Los nuevos no lo pasan. |

**Salida:** siempre un ítem.

| Caso | Salida | El webhook responde |
|---|---|---|
| Token válido | `{ valido: true, sin_token: false, usuario_id, rol, exp }` (`exp` en segundos) | sigue el flujo |
| Sin token, firma alterada, expirado o mal formado | `{ valido: false, http_code: 401, error: "token_invalido" }` | `401 { "error": "token_invalido" }` |
| Rol menor al pedido | `{ valido: false, http_code: 403, error: "rol_no_permitido" }` | `403 { "error": "rol_no_permitido" }` |
| n8n no puede leer `N8N_AUTH_SECRET` | `{ valido: false, http_code: 500, error: "autenticacion_no_configurada" }` | `500` |

El usuario sale **siempre del token** (`usuario_id`), nunca del cuerpo ni de la URL.

## Cómo usarlo en un webhook nuevo

> **Rendimiento:** llamar al subworkflow con *Execute Workflow* suma **unos 5 s por petición** en la instancia de Lightsail (medido en producción el 20/10: el mapa pasó de 4,6 s a 13 s). Para webhooks que la app llama seguido, usa la **copia en línea** (opción A). El subworkflow (opción B) sirve donde unos segundos más no importan.

**A. Copia en línea (recomendada)**

1. Webhook con *Respond* = **Using 'Respond to Webhook' Node**.
2. Copia el nodo Code **«Validar token (lista)»** de *UrbanPulse - Dashboard KPIs* y cambia solo el bloque `const entrada = {...}`:
   ```js
   const entrada = {
     rol_minimo: 'operador',          // o 'ciudadano'
     authorization: ($input.first().json.headers || {}).authorization || '',
   };                                  // sin permitir_sin_token: el token es obligatorio
   ```
3. **IF** `{{ $json.valido }}` es verdadero:
   - **true:** el resto del flujo. El usuario es `$('Validar token (...)').first().json.usuario_id`.
   - **false:** **Respond to Webhook** → JSON `{{ { error: $json.error } }}`, código `{{ $json.http_code }}`.
4. Agrega el nodo a `test_las_copias_en_linea_son_el_mismo_codigo` en `ia-ops/workflows/tests/test_validar_token.py`. Esa prueba falla si la copia se aparta del subworkflow.

**B. Subworkflow:** igual que A, pero en el paso 2 usa **Execute Workflow** → `UrbanPulse - Validar token (HT-36 T01)` con `rol_minimo` y `authorization = {{ $json.headers.authorization || '' }}`.

Los tres webhooks de *Dashboard KPIs* usan la opción A:

| Webhook | `rol_minimo` |
|---|---|
| `/urbanpulse/reports-list` | `ciudadano` |
| `/urbanpulse/reports-history` | `ciudadano` (el ciudadano ve los suyos; el operador, todos) |
| `/urbanpulse/report-resolve` | `operador` (un ciudadano recibe `403`) |

## Modo de transición

La app todavía no envía el token: lo activa Kiara en HT-36 T03 con `TE_ENVIAR_TOKEN=true`. Para no romper la app mientras tanto, los tres webhooks que ya existían validan con `permitir_sin_token: true`:

- **Sin cabecera `Authorization`:** pasa con `{ valido: true, sin_token: true, usuario_id: null }`, y el webhook usa el usuario que manda el cuerpo, como hasta ahora.
- **Con cabecera:** se valida siempre (`401`/`403`).

Los webhooks nuevos **no** pasan `permitir_sin_token`, así que exigen el token desde el primer día.

**Cuando `TE_ENVIAR_TOKEN` esté activo en producción** se cambia `const EXIGIR_TOKEN = false;` a `true` en el subworkflow y en las copias en línea, y se publican. Desde ahí, una petición sin token recibe `401` en todos los webhooks.

## Pruebas

`ia-ops/workflows/tests/test_validar_token.py` (25 casos). Ejecutan el nodo real y comprueban que acepta el token que emite el login de Central, y que las copias en línea de *Dashboard KPIs* son el mismo código.
