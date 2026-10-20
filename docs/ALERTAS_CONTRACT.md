# Contrato C3: Alertas cercanas al ciudadano (HU-10)

**Autor:** Sergio Ascurra (Arquitecto)  
**Fecha:** 20/10/2026  
**Sub-tarea:** HU-10 T01 (modelo de datos y contrato)  
**Implementa:** Emily Peralta (HU-10 T02 suscriptor de `reporte.creado`, HU-10 T03 webhooks)  
**Consume:** Kiara Linares (HU-10 T04, componente `AvisoAlerta` del host)  
**Prueba:** Fabio Saavedra (HU-10 T06)  
**Migración:** `database/migrations/20261020000002_create_alertas_ciudadano.sql`  
**ADR:** `docs/architecture/adr/ADR-017-alertas-en-la-app.md`

---

## 0. Reglas

| Regla | Valor |
|---|---|
| Radio | 500 m (`ST_DWithin` sobre `geography`, en metros) |
| Ubicaciones válidas | `ubicacion_actualizada_en` de las últimas 24 h |
| Reporte crítico | `reports.severity = 'alta'` (ver 0.1) |
| Destinatarios | Usuarios con `role = 'ciudadano'`, sin incluir al autor del reporte |
| Canal | Aviso dentro de la app; **sin SMS ni correo** (ADR-017) |
| Identidad | El `usuario_id` sale del token (contrato C1), nunca del cuerpo |

### 0.1 Qué es un reporte crítico

El clasificador del flujo "UrbanPulse - Central" solo devuelve `severity` en `baja | media | alta`; no existe un valor `critica`. Para este sprint, **crítico = `severity = 'alta'`**. Si más adelante se agrega un nivel mayor, se cambia solo el filtro del suscriptor (HU-10 T02) y se anuncia en la Daily.

---

## 1. Modelo de datos

```
usuarios
  + ultima_ubicacion          GEOGRAPHY(POINT, 4326)   índice GiST
  + ubicacion_actualizada_en  TIMESTAMPTZ

alertas_ciudadano
  id             UUID PK
  reporte_id     UUID  -> reports(id)   ON DELETE CASCADE
  usuario_id     UUID  -> usuarios(id)  ON DELETE CASCADE
  distancia_m    INT   >= 0
  creada_en      TIMESTAMPTZ
  descartada_en  TIMESTAMPTZ  (NULL = pendiente)
  UNIQUE (reporte_id, usuario_id)
```

- Solo se guarda la **última** ubicación (se sobrescribe); no hay historial de recorridos.
- `UNIQUE (reporte_id, usuario_id)`: el enrutador de eventos entrega al menos una vez (ADR-015), así que el suscriptor inserta con `ON CONFLICT DO NOTHING` y un evento repetido no duplica alertas.

### 1.1 Consulta del suscriptor (HU-10 T02)

Referencia para Emily; `$1` es el `reporte_id` del evento `reporte.creado`.

```sql
INSERT INTO alertas_ciudadano (reporte_id, usuario_id, distancia_m)
SELECT r.id, u.id,
       ROUND(ST_Distance(u.ultima_ubicacion, p.punto))::int
FROM reports AS r
CROSS JOIN LATERAL (
  SELECT ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::geography AS punto
) AS p
JOIN usuarios AS u
  ON u.role = 'ciudadano'
 AND u.id IS DISTINCT FROM r.usuario_id
 AND u.ubicacion_actualizada_en > now() - interval '24 hours'
 AND ST_DWithin(u.ultima_ubicacion, p.punto, 500)
WHERE r.id = $1::uuid
  AND r.severity = 'alta'
  AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL
ON CONFLICT (reporte_id, usuario_id) DO NOTHING;
```

---

## 2. Endpoints

Base: `{TE_N8N_BASE_URL}/urbanpulse`. Los tres usan "Validar token" con `rol_minimo = "ciudadano"`.

- Sin token, firma alterada o vencido: `401 { "error": "token_invalido" }`.
- Mientras HT-36 T01 no esté en main, el frontend trabaja con los datos simulados de la sección 3.

### 2.1 `POST /urbanpulse/ubicacion`

Guarda la ubicación que comparte la app (como máximo cada 5 minutos, solo con el permiso de geolocalización concedido).

```json
{ "lat": -12.1211, "lng": -77.0297 }
```

| Respuesta | Cuándo |
|---|---|
| `204` sin cuerpo | Guardada en `usuarios.ultima_ubicacion` con `ubicacion_actualizada_en = now()`. |
| `400 { "error": "datos_invalidos" }` | `lat` fuera de [-90, 90], `lng` fuera de [-180, 180] o no numéricos. |

### 2.2 `GET /urbanpulse/alertas`

Alertas **pendientes** (`descartada_en IS NULL`) del ciudadano del token, más recientes primero, de los últimos 7 días.

```json
[
  {
    "id": "5d1e7b0a-2c3f-4f6e-9a8b-1c2d3e4f5a6b",
    "reporte_id": "a3f1c2e4-9b7d-4e2a-9c51-0d8f2b7a1e44",
    "tipo": "infraestructura_vial",
    "severidad": "alta",
    "distancia_m": 320,
    "lat": -12.1203,
    "lng": -77.0311,
    "creada_en": "2026-10-24T15:02:11Z"
  }
]
```

`tipo` = `reports.incident_type`, `severidad` = `reports.severity`, `lat`/`lng` = ubicación del reporte (para "Ver en el mapa"). Sin alertas: `[]`.

### 2.3 `POST /urbanpulse/alertas/descartar`

```json
{ "id": "5d1e7b0a-2c3f-4f6e-9a8b-1c2d3e4f5a6b" }
```

| Respuesta | Cuándo |
|---|---|
| `200 { "ok": true }` | Se marcó `descartada_en = now()`. Descartar dos veces también responde `200` (idempotente). |
| `404 { "error": "alerta_no_encontrada" }` | No existe **o pertenece a otro ciudadano**. No se distingue entre ambos casos para no revelar alertas ajenas. |

El `UPDATE` filtra por `id` **y** `usuario_id` del token.

> El guion indica `403` para "otro ciudadano descarta alertas ajenas"; este contrato usa `404` para no confirmar que la alerta existe. HU-10 T06 debe esperar `404`. Se confirma en la Daily del 21/10.

---

## 3. Datos simulados para el frontend

`src/frontend/src/mock/alertas.json` (o donde lo ubique HU-10 T04) usa el formato de 2.2. Casos mínimos:

| Caso | Datos |
|---|---|
| Sin alertas | `[]` |
| Una alerta | La del ejemplo de 2.2 |
| Varias | Dos alertas, a 120 m y a 480 m |

---

## 4. Privacidad

- La app pide el permiso de ubicación con un texto que explica que solo se usa para avisar de incidentes graves cercanos.
- Si el ciudadano niega el permiso, no se envía nada y no recibe alertas; la app sigue funcionando.
- Solo se guarda la última ubicación; las de más de 24 h no se usan.
- Ningún endpoint devuelve la ubicación de otros usuarios.

Un cambio de este contrato se anuncia en la Daily antes de hacerlo (regla 3 del guion del Sprint 4).
