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
    "reporte_id": 1842,
    "distrito": "Miraflores",
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
3. **Respuesta Exitosos:** HTTP `202 Accepted`
   ```json
   {
     "estado": "recibido",
     "id": "6f1c2a9e-3b7d-4e2a-9c51-0d8f2b7a1e44",
     "tipo": "reporte.creado",
     "timestamp": "2026-10-05T20:13:00.000Z"
   }
   ```
4. **Respuesta Evento Inválido:** HTTP `400 Bad Request`
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
| `reporte.creado` | Ingesta RAG (HT-50) | Pendiente de implementar como subworkflow |
| `reporte.estado_cambiado` | Ingesta RAG (HT-50) | Pendiente de implementar como subworkflow |
| `n8n.flujo_fallido` | Service Desk (HT-41) | Pendiente de implementar en n8n |
| `modelo.deriva_detectada` | Service Desk (HT-41) | Pendiente de implementar en n8n |

> **Suscriptor de Prueba (solo staging).** Mientras los flujos de Ingesta RAG y Service Desk no existan como subworkflows, **todos** los tipos se entregan al workflow `Suscriptor de Prueba`. No debe usarse en producción. Al implementar los reales, se reemplaza el nodo de entrega del despachador por un Switch por `tipo` según la tabla anterior.

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
