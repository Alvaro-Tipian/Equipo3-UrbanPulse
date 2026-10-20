# Contrato C2: Operativos y cuadrillas (HU-09)

**Autor:** Sergio Ascurra (Arquitecto)  
**Fecha:** 20/10/2026  
**Sub-tarea:** HU-09 T01 (modelo de datos y contrato)  
**Implementa:** Emily Peralta (HU-09 T02, workflow "UrbanPulse - Operativos")  
**Consume:** Kiara Linares (HU-09 T03 y T04, `mf-gestion-incidentes`), Sergio Ascurra (HU-11 T01, KPIs)  
**Migración:** `database/migrations/20261020000001_create_operativos.sql`  
**Seeder:** `database/seeders/20261020000001_seed_cuadrillas.sql`  
**ADR:** `docs/architecture/adr/ADR-016-operativos-por-zona.md`

---

## 0. Autenticación

Todos los webhooks de este contrato usan el subworkflow "Validar token" del contrato C1 (HT-36 T01) con `rol_minimo = "operador"`.

- Petición: `Authorization: Bearer <token del login>`.
- Sin token, con firma alterada o vencido: `401 { "error": "token_invalido" }`.
- Token de ciudadano: `403 { "error": "rol_no_permitido" }`.
- `creado_por` se toma del `usuario_id` del token, nunca del cuerpo.

Mientras HT-36 T01 no esté en main, el frontend trabaja con los datos simulados de este contrato.

---

## 1. Modelo de datos

```
cuadrillas (id SERIAL, nombre UNIQUE, especialidad, activa, creada_en)
     1
     |
     0..N
operativos (id UUID, zona, estado, cuadrilla_id, creado_por,
            creado_en, asignado_en, cerrado_en)
     1
     |
     1..N
operativo_reportes (operativo_id, reporte_id, agregado_en)  ->  reports (id)
```

| Columna | Regla |
|---|---|
| `cuadrillas.especialidad` | `bacheo`, `senalizacion`, `semaforos` o `limpieza`. |
| `operativos.zona` | Clave del distrito: `distritos_lima.nombre_normalizado` (ej. `MIRAFLORES`), o `SIN_DISTRITO`. |
| `operativos.estado` | `planificado` → `asignado` → `en_curso` → `cerrado`. |
| `operativos.asignado_en` | Se llena la primera vez que se asigna cuadrilla; no se sobrescribe al reasignar. |
| `operativos.cerrado_en` | Se llena al cerrar; obligatorio si y solo si `estado = 'cerrado'`. |

La base rechaza (CHECK) un operativo fuera de `planificado` sin cuadrilla o sin `asignado_en`, y un `cerrado_en` que no corresponda al estado.

### 1.1 Zona de un reporte

La zona es el distrito del reporte, con el mismo criterio que el ranking del panel de riesgo y la ingesta RAG: la función `distrito_de_reporte(reporte_id)` (migración `20261005000002`) devuelve el `nombre_normalizado` del distrito. Si devuelve `NULL`, la zona es `SIN_DISTRITO`.

```sql
COALESCE(distrito_de_reporte(r.id), 'SIN_DISTRITO') AS zona_id
```

En la API, `zona_id` es la clave y `zona` el nombre para mostrar (`distritos_lima.nombre`, o `Sin distrito`). Para `POST /operativos` el backend acepta cualquiera de los dos y guarda `normalizar_distrito(zona)`.

### 1.2 Reportes de un operativo

- Solo entran reportes abiertos (`status` `pending` o `en_proceso`) de la misma zona del operativo.
- Un reporte no puede estar en dos operativos abiertos a la vez (estado distinto de `cerrado`). La base no lo impide con una restricción porque un reporte reabierto puede volver a un operativo nuevo; lo valida el webhook y responde `409`.
- Al cerrar el operativo, sus reportes pasan a `resuelto` con `resolved_at = now()` en la misma transacción.

---

## 2. Endpoints

Base: `{TE_N8N_BASE_URL}/urbanpulse`. Todas las respuestas son `application/json`.

### 2.1 `GET /urbanpulse/incidentes-por-zona`

Reportes abiertos que no están en un operativo abierto, agrupados por zona y ordenados por `total` descendente.

```json
[
  {
    "zona": "Miraflores",
    "zona_id": "MIRAFLORES",
    "total": 5,
    "incidentes": [
      {
        "id": "a3f1c2e4-9b7d-4e2a-9c51-0d8f2b7a1e44",
        "tipo": "bache",
        "severidad": "alta",
        "creado": "2026-10-20T10:00:00Z"
      }
    ]
  }
]
```

`tipo` = `reports.incident_type`, `severidad` = `reports.severity`, `creado` = `reports.created_at`.

### 2.2 `POST /urbanpulse/operativos`

Crea un operativo en estado `planificado`.

```json
{ "zona": "Miraflores", "reportes": ["uuid", "uuid"] }
```

| Respuesta | Cuándo |
|---|---|
| `201 { "id": "uuid", "estado": "planificado" }` | Creado. |
| `400 { "error": "datos_invalidos" }` | Falta `zona`, `reportes` vacío o algún id no es UUID. |
| `409 { "error": "reporte_no_disponible", "reportes": ["uuid"] }` | Algún reporte no existe, no está abierto, es de otra zona o ya está en un operativo abierto. |

### 2.3 `GET /urbanpulse/operativos`

Lista los operativos, del más reciente al más antiguo. Acepta `?estado=asignado` para filtrar.

```json
[
  {
    "id": "uuid",
    "zona": "Miraflores",
    "zona_id": "MIRAFLORES",
    "estado": "asignado",
    "cuadrilla": { "id": 1, "nombre": "Bacheo 1" },
    "reportes": 5,
    "creado_en": "2026-10-20T10:00:00Z",
    "asignado_en": "2026-10-20T11:30:00Z",
    "cerrado_en": null
  }
]
```

`cuadrilla` es `null` mientras el operativo está `planificado`. `reportes` es el número de reportes incluidos.

### 2.4 `GET /urbanpulse/cuadrillas`

Lista de cuadrillas activas para el selector del tablero (HU-09 T04).

```json
[{ "id": 1, "nombre": "Bacheo 1", "especialidad": "bacheo" }]
```

### 2.5 `POST /urbanpulse/operativos/asignar`

Asigna cuadrilla y/o cambia el estado.

```json
{ "operativo_id": "uuid", "cuadrilla_id": 1, "estado": "asignado" }
```

| `estado` pedido | Desde | Efecto |
|---|---|---|
| `asignado` | `planificado`, `asignado` | Exige `cuadrilla_id`. Guarda `asignado_en` si estaba vacío. Reasignar no lo cambia. |
| `en_curso` | `asignado` | `cuadrilla_id` opcional (si viene, reasigna). |
| `cerrado` | `asignado`, `en_curso` | Guarda `cerrado_en`, marca sus reportes como `resuelto` y publica `operativo.cerrado`. |

| Respuesta | Cuándo |
|---|---|
| `200` con el operativo en el formato de 2.3 | Cambio aplicado. |
| `400 { "error": "datos_invalidos" }` | Estado desconocido o falta `cuadrilla_id` al asignar. |
| `404 { "error": "operativo_no_encontrado" }` | El id no existe. |
| `409 { "error": "transicion_invalida", "estado_actual": "cerrado" }` | La transición no está en la tabla (ej. reabrir un cerrado). |

---

## 3. Eventos

Los publica HU-09 T02 en el enrutador de eventos (`POST /urbanpulse/eventos`, `docs/EVENT_ROUTER_CONTRACT.md`) con el sobre común. Se agregan al catálogo de `docs/architecture/eventos.md` en ese mismo PR.

```json
{ "tipo": "operativo.creado",
  "datos": { "operativo_id": "uuid", "zona_id": "MIRAFLORES", "reportes": 5 } }

{ "tipo": "operativo.cerrado",
  "datos": { "operativo_id": "uuid", "zona_id": "MIRAFLORES",
             "cuadrilla_id": 1, "reportes": 5, "horas_atencion": 26.5 } }
```

`horas_atencion` = horas entre `creado_en` y `cerrado_en` (mismo cálculo que el contrato C4 de HU-11).

---

## 4. Datos simulados para el frontend

Mientras HU-09 T02 no esté en staging, `mf-gestion-incidentes/src/mock` usa respuestas con este mismo formato. Las cuadrillas simuladas son las del seeder:

| id | nombre | especialidad |
|---|---|---|
| 1 | Bacheo 1 | bacheo |
| 2 | Señalización 1 | senalizacion |
| 3 | Semáforos 1 | semaforos |
| 4 | Limpieza 1 | limpieza |

Un cambio de este contrato se anuncia en la Daily antes de hacerlo (regla 3 del guion del Sprint 4).
