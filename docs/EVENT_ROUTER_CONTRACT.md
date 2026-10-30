# Contrato y Especificación del Enrutador de Eventos (HT-51 T02)

**Autor:** Álvaro Tipián (MLOps & DevSecOps Leader)  
**Fecha:** 05/10/2026  
**Endpoint:** `POST /urbanpulse/eventos`  
**n8n Production URL:** `https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/webhook/urbanpulse/eventos`  
**n8n Staging URL:** `https://urbanpulse-n8n-staging.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/webhook/urbanpulse/eventos`

---

## 0. Autenticación

El webhook usa **Header Auth** de n8n. Toda petición debe enviar:

- **Header:** `X-Event-Token`
- **Credencial en n8n:** `UrbanPulse Event Router Header Auth` (tipo Header Auth; Name = `X-Event-Token`, Value = token generado por el equipo).
- **Secret en GitHub (para quien emite eventos desde Actions):** `EVENT_ROUTER_TOKEN`.

Sin el header o con un token inválido, n8n responde 403 y el evento no se persiste. No incluir el valor del token en el código ni en este documento.

---

## 1. Sobre Común de Eventos (Envelope Specification)

Todo evento enviado a `POST /urbanpulse/eventos` debe cumplir con el siguiente esquema JSON:

```json
{
  "id": "6f1c2a9e-3b7d-4e2a-9c51-0d8f2b7a1e44",
  "tipo": "reporte.creado",
  "fecha": "2026-10-06T15:02:11-05:00",
  "origen": "n8n/central-vr5",
  "datos": {
    "reporte_id": "a3f1c2e4-9b7d-4e2a-9c51-0d8f2b7a1e44",
    "distrito": "MIRAFLORES",
    "franja": "tarde",
    "tipo_incidente": "choque"
  }
}
```

### Reglas de Validación y Respuestas:
1. **Idempotencia (`id`):** Debe ser un string en formato **UUID v4**. La base de datos ejecuta `INSERT ... ON CONFLICT (id) DO NOTHING`.
2. **Tipos de Eventos Soportados (`tipo`):**
   - `reporte.creado`
   - `reporte.estado_cambiado`
   - `n8n.flujo_fallido`
   - `modelo.deriva_detectada`
   - `modelo.monitoreado`
   - `operativo.creado`
   - `operativo.cerrado`

   Los dos de operativos los publica el workflow *UrbanPulse - Operativos*
   (HU-09 T02): `operativo.creado` al agrupar los reportes de una zona y
   `operativo.cerrado` al cerrar el operativo. Sus campos están en
   `docs/architecture/eventos.md` (2.5 y 2.6). `horas_atencion` puede ser `0`,
   así que el validador comprueba que sea un número, no que sea verdadero.

   Los dos del modelo llevan los mismos `datos` (`modelo`, `version`,
   `psi_max`, `f1_real`, `reporte_url`) y los publica el mismo paso de
   `ml-monitoring.yml`: cuando hay deriva el tipo es `modelo.deriva_detectada`
   y cuando no, `modelo.monitoreado`. El monitoreo deja constancia **en cada
   ejecución**, no solo cuando hay deriva, que es de donde el webhook de estado
   de plataforma (HU-13 T01) saca el F1 real y la fecha del último monitoreo.
   Si no hay predicciones suficientes para medir, se publica igual con
   `version`, `psi_max` y `f1_real` en `null` y el campo opcional `motivo`.
3. **Catálogos: los valores son los de la base, no los bonitos.**

   | Campo | Valores admitidos | De dónde salen |
   |---|---|---|
   | `datos.franja` | `manana` · `tarde` · `noche` | Las franjas de `conocimiento_vial`, del dataset de HT-46 y de la ingesta de HT-50. **Sin eñe** |
   | `datos.estado_anterior` / `estado_nuevo` | `pending` · `en_proceso` · `resuelto` | La restricción `reports_status_check` (migración `20260914000001`) |
   | `datos.reporte_id` | UUID | `reports.id` es `UUID`, no un entero |

   Esto no es un detalle de estilo. El validador pedía antes `mañana` con eñe y
   `Pendiente`/`En Proceso`/`Resuelto`, valores que **no existen en ninguna
   tabla**: un productor que publicara lo que de verdad tiene en la base se
   habría llevado un `400`, y uno que publicara lo que pedía el contrato habría
   pasado la validación para después no casar con ninguna ficha de
   `conocimiento_vial`. Ahora el contrato habla el idioma de la base.

4. **Respuesta Exitosos:** HTTP `202 Accepted`
   ```json
   {
     "estado": "recibido",
     "id": "6f1c2a9e-3b7d-4e2a-9c51-0d8f2b7a1e44",
     "tipo": "reporte.creado",
     "timestamp": "2026-10-05T20:13:00.000Z"
   }
   ```
5. **Respuesta Evento Inválido:** HTTP `400 Bad Request`
   ```json
   {
     "error": "Validación de sobre o datos fallida",
     "detalle": "El campo \"id\" debe ser un UUID v4 válido."
   }
   ```

---

## 2. Entrega a suscriptores

Después de persistir un evento válido (estado `recibido`), el router lo entrega con el workflow **Despachar Evento**. El mismo despachador lo usa el reproceso, así que la lógica de entrega existe una sola vez.

### Mapeo tipo -> suscriptor

| Tipo de evento | Suscriptor destino | Estado |
|---|---|---|
| `reporte.creado` | Ingesta RAG (HT-50 T01) **y** Alertas cercanas (HU-10 T02) | **Enrutado** |
| `reporte.estado_cambiado` | Ingesta RAG (HT-50 T01) | **Enrutado** |
| `n8n.flujo_fallido` | Suscriptor Service Desk (HT-41) | **Enrutado** (nodo *If* del despachador) |
| `modelo.deriva_detectada` | Service Desk (HT-41) | Pendiente: va al Suscriptor de Prueba |
| `modelo.monitoreado` | Ninguno; se persiste y se consulta | Va al Suscriptor de Prueba; lo lee HU-13 T01 desde `eventos` |
| `operativo.creado` | Ninguno; se persiste y se consulta | Va al Suscriptor de Prueba; lo leerá HU-11 T01 desde `eventos` |
| `operativo.cerrado` | Ninguno; se persiste y se consulta | Va al Suscriptor de Prueba; lo leerá HU-11 T01 desde `eventos` |

El despachador decide con dos nodos IF:

- **¿Es evento de reporte?**: los tipos que empiezan por `reporte.` van a la
  Ingesta RAG y a *Alertas cercanas*.
- **If**: del resto, `n8n.flujo_fallido` va al *Suscriptor Service Desk*
  (HT-41) y los demás al Suscriptor de Prueba.

Desde HU-10 T02, la salida de reportes alimenta **dos** suscriptores en
paralelo: la Ingesta RAG y *Alertas cercanas*. Van en paralelo y no en cadena
porque un aviso de incidente grave a menos de 500 m no puede esperar al
pipeline del RAG ni caerse con el. *Alertas cercanas* tambien recibe
`reporte.estado_cambiado` y lo descarta con su propio nodo IF, asi que el filtro
de HU-10 vive en ese workflow y no en el despachador.

> **Pendiente de HT-51.** Con dos suscriptores en la misma rama, los dos marcan
> el mismo evento en `eventos` y gana el ultimo `UPDATE`: si la Ingesta RAG va
> bien y las alertas fallan, el evento queda `entregado` y el reproceso no lo
> reintenta. La solucion es un estado de entrega por suscriptor; se anuncia en
> la Daily.

> **Service Desk.** *UrbanPulse - Errores a Service Desk* (HT-41 T02) arranca
> con un **Error Trigger**, que no se puede invocar con Execute Workflow; por
> eso existe *UrbanPulse - Suscriptor Service Desk*, con `executeWorkflowTrigger`,
> que recibe `n8n.flujo_fallido`. `modelo.deriva_detectada` todavía va al
> Suscriptor de Prueba: el ticket de deriva lo crea directamente
> `ml-monitoring.yml`. *Suscriptor Service Desk* no tiene copia en el
> repositorio ni está habilitado para el MCP de n8n: hay que exportarlo.

### Puesta en marcha del enrutamiento en n8n

La copia del repositorio es la exportación de producción (30/10/2026) y lleva
los id de los workflows destino **de producción**. Al importarla en otra
instancia (staging), esos id no existen allí:

1. En cada nodo Execute Workflow, seleccionar de la lista el workflow destino
   de esa instancia: *Ingesta RAG conocimiento vial*, *Alertas cercanas*,
   *Suscriptor Service Desk* y *Suscriptor de Prueba*.
2. Comprobar que en todos la salida de error (la roja) va a
   *Marcar Evento Fallido* y la de éxito a *Marcar Evento Entregado*.

### Estados e intentos

| Resultado de la entrega | Cambio en `eventos` |
|---|---|
| Éxito | `estado = 'entregado'`, `entregado_en = now()`, `ultimo_error = NULL` |
| Error | `estado = 'fallido'`, `intentos = intentos + 1`, `ultimo_error = <mensaje>` |

Un `id` duplicado no se vuelve a entregar desde el router (`ON CONFLICT DO NOTHING` no devuelve fila).

## 3. Reproceso

El workflow **Reproceso de Eventos** corre cada hora (Schedule Trigger) y también se puede ejecutar a mano (Manual Trigger). Reintenta, hasta 50 eventos por corrida, los que cumplan:

- `estado = 'fallido'` y `intentos < 3`, o
- `estado = 'recibido'` y `actualizado_en` con más de 10 minutos de antigüedad.

Los reenvía por Despachar Evento sin volver a insertar. Un evento `fallido` con `intentos = 3` queda para revisión manual.

## 4. Puesta en marcha en n8n

1. Ejecutar en Neon las migraciones `20261005000001_create_eventos_table.sql` y `20261006000001_eventos_entrega.sql` (ambas idempotentes).
2. Importar los workflows en este orden: `Suscriptor de Prueba`, `Despachar Evento`, el router y `Reproceso de Eventos`.
3. En cada nodo Postgres seleccionar la credencial de Neon, y en cada nodo Execute Workflow seleccionar el workflow destino (los JSON no incluyen ids de workflow ni de credencial).
4. Crear la credencial Header Auth descrita en la sección 0.

### Prueba de "suscriptor caído" (staging)

1. En `Suscriptor de Prueba`, dejar `SUSCRIPTOR_CAIDO = true`.
2. Enviar un evento válido con `datos.simular_fallo = true`. Debe quedar `fallido` con `intentos = 1`.
3. Cambiar `SUSCRIPTOR_CAIDO` a `false` y ejecutar a mano `Reproceso de Eventos`. Debe pasar a `entregado`.
