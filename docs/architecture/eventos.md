# Catálogo de eventos de dominio de UrbanPulse

HT-51 T01 · Contrato 4.7 · Responsable: Sergio Ascurra (Arquitecto)

Este documento define los eventos que publican los flujos de UrbanPulse y el sobre común que todos usan. El enrutador de n8n (`POST /urbanpulse/eventos`, HT-51 T02) valida cada evento contra este contrato, lo guarda en la tabla `eventos` de Neon y lo entrega a sus suscriptores. El productor no conoce a los consumidores.

## 1. Sobre común

Todo evento usa el mismo sobre. El esquema formal está en `docs/architecture/eventos/sobre.schema.json`.

| Campo | Tipo | Regla |
|---|---|---|
| `id` | UUID v4 | Lo genera el productor. Es la clave de idempotencia: un `id` repetido no se procesa dos veces. |
| `tipo` | texto | Uno de los 4 tipos del catálogo. |
| `fecha` | ISO 8601 con zona horaria | Momento en que ocurrió el hecho. Ejemplo: `2026-10-06T15:02:11-05:00`. |
| `origen` | texto | Quién publica. Ejemplos: `n8n/central-vr5`, `github/ml-monitoring`. |
| `datos` | objeto | Contenido propio de cada tipo (sección 2). |

Ejemplo:

```json
{
  "id": "6f1c2a9e-3b7d-4e2a-9c51-0d8f2b7a1e44",
  "tipo": "reporte.creado",
  "fecha": "2026-10-06T15:02:11-05:00",
  "origen": "n8n/central-vr5",
  "datos": {
    "reporte_id": 1842,
    "distrito": "Miraflores",
    "franja": "tarde",
    "tipo_incidente": "choque"
  }
}
```

## 2. Catálogo

### 2.1 `reporte.creado`

- Productor: flujo del chat de n8n, después del nodo que guarda el reporte.
- Suscriptores: Ingesta RAG (HT-50).
- Datos:

| Campo | Tipo | Notas |
|---|---|---|
| `reporte_id` | entero | Identificador del reporte en `reports`. |
| `distrito` | texto | Distrito del reporte. |
| `franja` | `mañana`, `tarde` o `noche` | Franja horaria. |
| `tipo_incidente` | texto | Tipo de incidente (por ejemplo `choque`). |

### 2.2 `reporte.estado_cambiado`

- Productor: flujo `/report-resolve` y cualquier flujo que cambie el estado de un reporte.
- Suscriptores: Ingesta RAG (HT-50), que actualiza la ficha en `conocimiento_vial`.
- Datos:

| Campo | Tipo | Notas |
|---|---|---|
| `reporte_id` | entero | Identificador del reporte. |
| `estado_anterior` | `Pendiente`, `En Proceso` o `Resuelto` | Estado antes del cambio. |
| `estado_nuevo` | `Pendiente`, `En Proceso` o `Resuelto` | Estado después del cambio. |
| `distrito` | texto (opcional) | Útil para la ficha del RAG. |
| `franja` | `mañana`, `tarde` o `noche` (opcional) | Útil para la ficha del RAG. |

### 2.3 `n8n.flujo_fallido`

- Productor: Error Trigger de n8n (HT-41).
- Suscriptores: subworkflow "Service Desk - Crear incidente" (HT-41).
- Datos:

| Campo | Tipo | Notas |
|---|---|---|
| `workflow_id` | texto | Identificador del workflow que falló. |
| `workflow_nombre` | texto | Nombre legible. |
| `ejecucion_id` | texto | Identificador de la ejecución fallida. |
| `nodo_fallido` | texto (opcional) | Nodo donde ocurrió el error. |
| `mensaje_error` | texto | Mensaje del error. **No incluir credenciales, tokens ni datos de ciudadanos.** |

### 2.4 `modelo.deriva_detectada`

- Productor: job semanal `ml-monitoring.yml` de GitHub Actions (HT-49), cuando `deriva=true`.
- Suscriptores: subworkflow "Service Desk - Crear incidente" (HT-41). El pipeline MLOps se dispara aparte con `workflow_dispatch` (HT-49 T03).
- Datos:

| Campo | Tipo | Notas |
|---|---|---|
| `modelo` | texto | Nombre del modelo, por ejemplo `riesgo_vial`. |
| `version` | entero | Versión del modelo en producción. |
| `psi_max` | número | PSI máximo entre las variables. Umbral propuesto: mayor a 0,2. |
| `variables_con_deriva_pct` | número (opcional) | Porcentaje de variables con deriva. |
| `f1_real` | número entre 0 y 1 | F1 medido contra los incidentes reportados. |
| `reporte_url` | URL | Enlace al reporte HTML de Evidently. |

## 3. Reglas del enrutador

1. **Autenticación.** El `POST` lleva una cabecera de autenticación (Header Auth) que solo conocen los productores. No va en el repositorio.
2. **Respuestas.** `202 {"estado": "recibido"}` si el sobre es válido; `400` si no lo es. El productor no espera a los suscriptores.
3. **Validación.** Tipo conocido, `id` UUID, `fecha` válida y `datos` con los campos requeridos de su tipo. Un evento inválido se guarda como `rechazado` y no se entrega.
4. **Idempotencia.** `INSERT ... ON CONFLICT (id) DO NOTHING`. Un evento repetido no se procesa dos veces.
5. **Entrega al menos una vez.** Un suscriptor puede recibir un evento más de una vez, por lo que los consumidores deben ser idempotentes.
6. **Estados en la tabla `eventos`.** `recibido`, `entregado`, `fallido` y `rechazado`, con el contador `intentos`.
7. **Reproceso.** Un workflow cada hora reintenta los eventos `fallido` con menos de 3 intentos.

## 4. Evolución futura

El sobre es independiente del transporte. Si el volumen o la fiabilidad lo exigen, el enrutador se puede reemplazar por una cola administrada (Amazon SQS o EventBridge) sin cambiar el sobre ni los productores. Ver el ADR "Arquitectura basada en eventos con n8n y Neon".
