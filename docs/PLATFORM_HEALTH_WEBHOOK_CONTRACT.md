# 📊 Contrato del Webhook: Estado de la Plataforma (HU-13 T01)

**Endpoint:** `GET /webhook/urbanpulse/estado-plataforma`
**Workflow:** `ia-ops/workflows/n8n_estado_plataforma.json`
**Autor:** Álvaro Tipián (MLOps & DevSecOps Leader)
**Versión del contrato:** `1.2.0`
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
| `ultimo_despliegue` | La última ejecución exitosa en `main` de los workflows de despliegue (n8n y API de riesgo), por la API pública de GitHub Actions |
| `monitoreo_modelo` | El modelo y la versión que **sirve la API**, más el último evento publicado por `ml-monitoring.yml` (HT-49 T03) a través del enrutador de HT-51 |
| `service_desk_jira` | Tres consultas JQL al Jira del equipo |

Cubre los criterios de aceptación 1 a 3 de HU-13; la pantalla que los muestra al
operador es HU-13 T02 (Frontend), y el criterio 4 (el ciudadano solo ve el
estado básico) lo resuelve esa pantalla según el rol de la sesión.

**CORS:** la pantalla de Ajustes lo llama desde el navegador y el cliente
compartido envía `Authorization`, que provoca una consulta previa (preflight).
Desde HT-36 T02 el nodo Webhook solo admite los orígenes de la app (producción,
staging y localhost), no `*`: ver `docs/CORS_WEBHOOKS.md`.

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
  "version": "1.2.0",
  "servicios": [
    { "nombre": "n8n_engine",    "estado": "ONLINE", "latencia_ms": 45 },
    { "nombre": "fastapi_mlops", "estado": "ONLINE", "latencia_ms": 22 },
    { "nombre": "neon_postgres", "estado": "ONLINE", "latencia_ms": 18 }
  ],
  "ultimo_despliegue": {
    "fecha": "2026-10-14T21:40:05.000Z",
    "commit": "e24aedf",
    "workflow": "MLOps - Despliegue de la API de riesgo vial",
    "url": "https://github.com/SergioAscurraPerez/Equipo3-UrbanPulse/actions/runs/130"
  },
  "monitoreo_modelo": {
    "modelo": "riesgo_vial",
    "version": "7",
    "f1_score": 0.91,
    "deriva_detectada": false,
    "ultimo_monitoreo": "2026-10-13T06:00:00.000Z",
    "monitoreo_vigente": true,
    "observacion": null
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
| El monitoreo corrió sin predicciones suficientes | `f1_score: null`, `deriva_detectada: false`, `observacion` con el motivo |
| GitHub no responde (o se superan sus 60 consultas por hora sin token) | `ultimo_despliegue: null` |
| Jira no responde o rechaza las credenciales | `tickets_abiertos: null`, `cumplimiento_sla_porcentaje: null`; el resto se responde igual |
| Neon no responde | `neon_postgres` OFFLINE y `monitoreo_modelo` sin F1; `modelo` y `version` siguen saliendo de la API |

`deriva_detectada: null` no es lo mismo que `false`: significa que no hay ningún
monitoreo publicado, no que no haya deriva.

### Cumplimiento de SLA

El criterio 3 de HU-13 pide el cumplimiento **del mes**. Se calcula con
consultas JQL sobre el proyecto `UPTI`, pidiendo solo el contador con
`POST /rest/api/3/search/approximate-count` (cuerpo `{"jql": ...}`, respuesta
`{"count": N}`):

```
abiertos = project = UPTI AND statusCategory != Done
del_mes  = project = UPTI AND created >= startOfMonth()
           AND ("Tiempo de primera respuesta" = running() OR "Tiempo de primera respuesta" = completed()
                OR "Tiempo de primera respuesta" = paused())
vencidos = project = UPTI AND created >= startOfMonth() AND "Tiempo de primera respuesta" = breached()

cumplimiento = (del_mes - vencidos) / del_mes * 100     (100 si no hubo tickets con SLA)
```

`tickets_abiertos` es el número de tickets abiertos hoy y no entra en el
porcentaje. Para "tiene el SLA" se usan las funciones `running()`,
`completed()` y `paused()`, que son las que documenta Atlassian para los campos
de SLA (`IS NOT EMPTY` no está documentado para ellos).

Se mide con el SLA **"Tiempo de primera respuesta"** (24 h), que es el que el
portal UPTI aplica a todas las solicitudes desde que se crean. El otro SLA del
portal, "Time to close after resolution", solo corre después de resolver, así
que no mide la atención. Si el nombre del SLA cambia en Jira, esa consulta falla
y el porcentaje sale `null`, sin tumbar el resto de la respuesta.

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
   - los tres nodos de Jira → credencial `Jira API` (la que ya usa *UrbanPulse - Errores a Service Desk*)
   - el nodo *GitHub: ultimo despliegue* no lleva credencial (repositorio público)
3. Activar el workflow y probar:
   ```bash
   curl -s https://<n8n>/webhook/urbanpulse/estado-plataforma | jq
   ```
4. Si `f1_score` sale `null`, mirar `observacion`: si trae un motivo, el
   monitoreo corrió pero no tenía datos; si es `null` y `ultimo_monitoreo`
   también, todavía no se publicó ningún `modelo.monitoreado` (hace falta el
   secret `EVENT_ROUTER_TOKEN`, ver `docs/EVENT_ROUTER_CONTRACT.md`).
5. Si `cumplimiento_sla_porcentaje` sale `null` con `tickets_abiertos` lleno,
   el SLA del proyecto cambió de nombre: poner el nombre exacto (hoy
   `"Tiempo de primera respuesta"`) en
   los nodos *Jira: tickets del mes con SLA* y *Jira: tickets con SLA vencido*.

Las dos URLs sondeadas (n8n y API de riesgo) están juntas al inicio del nodo
*Sondar n8n y la API de riesgo*; si cambia el despliegue, se tocan ahí.

## 🧪 Pruebas

`ia-ops/workflows/tests/test_estado_plataforma.py` ejecuta el nodo que arma la
respuesta en Node.js, igual que n8n: servicios caídos, Neon fallando mientras
la API responde, monitoreo ausente, viejo o sin datos, deriva, Jira caído, SLA
del mes, último despliegue y GitHub caído. También comprueba la estructura del
workflow: el orden de los nodos (para que la latencia de Neon sea solo de
Neon), los endpoints de Jira, el CORS del webhook y que la copia de producción
sea idéntica.
