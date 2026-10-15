# 📊 Contrato del Webhook: Estado de la Plataforma (HU-13 T01)

**Endpoint:** `GET /webhook/urbanpulse/estado-plataforma`
**Workflow:** `ia-ops/workflows/n8n_estado_plataforma.json`
**Autor:** Álvaro Tipián (MLOps & DevSecOps Leader)
**Versión del contrato:** `1.1.0`
**Objetivo de tiempo de respuesta:** < 3000 ms

---

## 📋 Qué hace

Centraliza en una sola respuesta el estado real de la plataforma. Cada dato sale
de una medición propia; **ninguno se deduce de otro**:

| Dato | De dónde sale |
|---|---|
| `n8n_engine` | `GET /healthz` del n8n de producción, con el tiempo que tardó |
| `fastapi_mlops` | `GET /health` de la API de riesgo (HT-46 T03, Emily) |
| `neon_postgres` | Una consulta real a Neon; si no responde, está OFFLINE |
| `monitoreo_modelo` | El modelo y la versión que **sirve la API**, más el último evento publicado por `ml-monitoring.yml` (HT-49 T03) a través del enrutador de HT-51 |
| `service_desk_jira` | Dos consultas JQL al Jira del equipo |

La consulta a Neon hace las dos cosas de una vez —comprobar que la base responde
y leer el último monitoreo—, así que es **una sola ida y vuelta** y la latencia
que se reporta es la de esa consulta. Para que sea así, el workflow consulta
Jira **antes** de las sondas, y Neon va directo al nodo que arma la respuesta:
cuando Jira iba entre Neon y ese nodo, su tiempo se sumaba a la latencia de la
base. Una latencia alta en la primera llamada del día es el arranque en frío de
Neon (el plan gratuito suspende la base cuando no se usa), no un fallo:

```sql
SELECT 1 AS ok, m.tipo, m.fecha, m.datos
FROM (SELECT 1) AS ping
LEFT JOIN LATERAL (
  SELECT tipo, fecha, datos
  FROM eventos
  WHERE tipo IN ('modelo.monitoreado', 'modelo.deriva_detectada')
  ORDER BY fecha DESC
  LIMIT 1
) AS m ON true;
```

## 📤 Respuesta (200 OK)

```json
{
  "estado_plataforma": "OPERATIVO",
  "timestamp": "2026-10-13T20:55:00.000Z",
  "version": "1.1.0",
  "servicios": [
    { "nombre": "n8n_engine",    "estado": "ONLINE", "latencia_ms": 45 },
    { "nombre": "fastapi_mlops", "estado": "ONLINE", "latencia_ms": 22 },
    { "nombre": "neon_postgres", "estado": "ONLINE", "latencia_ms": 18 }
  ],
  "monitoreo_modelo": {
    "modelo": "riesgo_vial",
    "version": "7",
    "f1_score": 0.91,
    "deriva_detectada": false,
    "ultimo_monitoreo": "2026-10-13T06:00:00.000Z",
    "monitoreo_vigente": true
  },
  "service_desk_jira": {
    "tickets_abiertos": 10,
    "cumplimiento_sla_porcentaje": 90.0,
    "portal_url": "https://urbanpulse-ti.atlassian.net"
  }
}
```

### `estado_plataforma`

| Valor | Cuándo |
|---|---|
| `OPERATIVO` | Los tres servicios ONLINE |
| `DEGRADADO` | Al menos uno ONLINE y al menos uno no |
| `CAIDO` | Ninguno responde |

### `monitoreo_modelo`

`modelo` y `version` los manda la API, porque es el modelo que de verdad está
respondiendo `/predict`. `f1_score` y `deriva_detectada` salen del último evento
que publicó el monitoreo diario:

- `modelo.monitoreado` → `deriva_detectada: false`
- `modelo.deriva_detectada` → `deriva_detectada: true`

`monitoreo_vigente` es `false` si ese evento tiene más de **7 días**: el dato se
sigue mostrando, pero avisa de que el monitoreo no corrió.

### Qué pasa cuando algo no se puede medir

**Lo que no se sabe sale en `null`, nunca inventado ni copiado de otro servicio.**

| Situación | Respuesta |
|---|---|
| Nunca corrió el monitoreo | `f1_score: null`, `deriva_detectada: null`, `monitoreo_vigente: false` |
| Jira no responde o rechaza las credenciales | `tickets_abiertos: null`, `cumplimiento_sla_porcentaje: null`; el resto se responde igual |
| Neon no responde | `neon_postgres` OFFLINE y `monitoreo_modelo` sin F1; `modelo` y `version` siguen saliendo de la API |

`deriva_detectada: null` no es lo mismo que `false`: significa que no hay ningún
monitoreo publicado, no que no haya deriva.

### Cumplimiento de SLA

Se calcula con dos consultas JQL sobre el proyecto `UPTI`, pidiendo solo el
contador con `POST /rest/api/3/search/approximate-count` (cuerpo `{"jql": ...}`,
respuesta `{"count": N}`):

```
abiertos  = project = UPTI AND statusCategory != Done
vencidos  = project = UPTI AND statusCategory != Done AND "Time to resolution" = breached()

cumplimiento = (abiertos - vencidos) / abiertos * 100     (100 si no hay abiertos)
```

Si el campo `"Time to resolution"` no existe en el Jira Service Management del
proyecto, esa consulta falla y el porcentaje sale `null`, sin tumbar el resto de
la respuesta.

> **Por qué `approximate-count` y no `/rest/api/3/search`.** El webhook usaba
> `GET /rest/api/3/search?maxResults=0` y leía `total`. Atlassian retiró ese
> endpoint de Jira Cloud, y su reemplazo (`/rest/api/3/search/jql`) ya no
> devuelve `total` ni acepta `maxResults=0`; por eso los dos contadores salían
> siempre en `null`. El conteo aproximado es el endpoint que Atlassian indica
> para obtener solo el número de resultados.

## 🏗️ Puesta en marcha

1. Importar `ia-ops/workflows/n8n_estado_plataforma.json` en n8n.
2. Asignar las credenciales existentes, **no hay que crear ninguna**:
   - nodo *Neon: ping y ultimo monitoreo* → credencial Postgres `Postgres account`
   - los dos nodos de Jira → credencial `Jira API` (la que ya usa *UrbanPulse - Errores a Service Desk*)
3. Activar el workflow y probar:
   ```bash
   curl -s https://<n8n>/webhook/urbanpulse/estado-plataforma | jq
   ```
4. Si `f1_score` sale `null`, es que todavía no se publicó ningún
   `modelo.monitoreado`: hace falta el secret `EVENT_ROUTER_TOKEN` para que
   `ml-monitoring.yml` pueda publicar (ver `docs/EVENT_ROUTER_CONTRACT.md`).

Las dos URLs sondeadas (n8n y API de riesgo) están juntas al inicio del nodo
*Sondar n8n y la API de riesgo*; si cambia el despliegue, se tocan ahí.

## 🧪 Pruebas

`ia-ops/workflows/tests/test_estado_plataforma.py` ejecuta el nodo que arma la
respuesta en Node.js, igual que n8n, con 13 casos: servicios caídos, Neon
fallando mientras la API responde (el defecto que tenía antes: copiaba el estado
de la API), monitoreo ausente, monitoreo viejo, deriva, Jira caído y cero
tickets abiertos.
