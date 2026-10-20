# 🎫 Registro de despliegues en el Service Desk (HT-41 T03)

**Endpoint:** `POST /webhook/urbanpulse/despliegue`
**Workflow:** `ia-ops/workflows/n8n_registrar_despliegue.json`
**Autor:** Álvaro Tipián (MLOps & DevSecOps Leader)

---

## Por qué existe

`deploy-lightsail-n8n.yml` y `ml-monitoring.yml` ya hacían `POST` a
`SERVERLESS_JIRA_WEBHOOK_URL` cuando un despliegue terminaba bien o mal. **No
había nada escuchando en esa URL**, así que el paso terminaba con un aviso y
ningún ticket llegaba al Service Desk.

El workflow *UrbanPulse - Errores a Service Desk* (HT-41, Emily) sí sabe hablar
con Jira, pero arranca con un **Error Trigger**, que n8n solo dispara cuando otro
workflow falla: **no se puede invocar por webhook**. Este workflow es la pieza que
faltaba, y reutiliza su misma credencial `Jira API`.

## Contrato

### Petición

```http
POST /webhook/urbanpulse/despliegue
Authorization: Bearer <DEPLOY_WEBHOOK_SECRET>
Content-Type: application/json

{
  "eventType": "deployment_success",
  "projectKey": "UPTI",
  "commitSha": "9f3c1d2a9f3c1d2a9f3c1d2a9f3c1d2a9f3c1d2a",
  "repository": "SergioAscurraPerez/Equipo3-UrbanPulse",
  "runId": "38460872588",
  "message": "Despliegue automático de n8n en AWS Lightsail exitoso."
}
```

Es **exactamente** el sobre que ya mandan los dos workflows de despliegue. No hay
que tocarlos.

### Qué ticket abre cada evento

| `eventType` | Tipo de solicitud en el portal | ID |
|---|---|---|
| `deployment_success` | Solicitud de cambio | `19` |
| `deployment_failure` | Fallo de la plataforma | `16` |
| `model_drift` | Fallo de la plataforma (resumen `[Deriva del modelo]`) | `16` |

`model_drift` lo envía `ml-monitoring.yml` cuando el monitoreo detecta deriva
(HT-49 T03), con los mismos campos obligatorios más `modelName`,
`modelVersion` y `psi`, que van al resumen y a la descripción del ticket.

El resumen del ticket lleva el commit corto y el `runId`:

```
[Solicitud de cambio] SergioAscurraPerez/Equipo3-UrbanPulse @ 9f3c1d2 (run 38460872588)
```

El `runId` va ahí a propósito: si un despliegue reintenta el aviso, el ticket
repetido se reconoce de un vistazo en el portal.

El detalle (mensaje, repositorio, commit y enlace a la ejecución) va en la
**descripción** solo si el formulario del tipo de solicitud tiene ese campo. El
de *Solicitud de cambio* no lo tiene, y Jira rechaza la solicitud entera si se
lo manda (`400`: "El campo 'description' no es válido para este tipo de
solicitud"). Por eso el workflow lee antes los campos del tipo
(`/servicedeskapi/servicedesk/{id}/requesttype/{tipo}/field`) y, si no hay
descripción, agrega el detalle como **comentario interno** de la solicitud ya
creada. La función de Vercel de HT-41 T06 hace lo mismo.

### Respuestas

| Código | Cuándo | Cuerpo |
|---|---|---|
| `201` | Ticket creado | `{ "estado": "creado", "ticket": "UPTI-42", "tipo": "...", "portal": "..." }` |
| `400` | Falta un campo o el `eventType` no es uno de los dos | `{ "error": "..." }` |
| `403` | La cabecera `Authorization` no coincide | lo devuelve n8n |
| `502` | El proyecto no tiene portal, o Jira rechazó la solicitud | `{ "error": "...", "detalle": ... }` |

Un `502` **devuelve el error de Jira tal cual**, para que quede en el log del
despliegue y no haya que adivinar qué pasó.

## Por qué resuelve el portal en cada llamada

La API del portal (`/rest/servicedeskapi/request`) pide el `serviceDeskId`
numérico, que no es la clave del proyecto. El workflow lo busca con
`GET /rest/servicedeskapi/servicedesk` y lo cruza con `projectKey` en vez de
dejarlo escrito a mano: si alguien recrea el proyecto, el id cambia y esto sigue
funcionando. Si no encuentra el portal, el `502` **dice qué portales sí ve**, que
es la mitad del trabajo de diagnosticarlo.

## 🏗️ Puesta en marcha

1. **Credencial nueva en n8n** — Header Auth llamada
   `UrbanPulse Deploy Webhook Auth`:
   - *Name:* `Authorization`
   - *Value:* `Bearer <el valor del secret DEPLOY_WEBHOOK_SECRET>`

   Ojo: el valor lleva **`Bearer ` delante**, con el espacio. Es lo que manda
   `curl --header "Authorization: Bearer ${WEBHOOK_SECRET}"`.

2. **Credencial existente** — los dos nodos de Jira usan `Jira API`, la misma de
   *UrbanPulse - Errores a Service Desk*. No hay que crear nada.

3. **Importar y activar** `n8n_registrar_despliegue.json`.

4. **Secrets en GitHub:**
   - `DEPLOY_WEBHOOK_SECRET`: el mismo valor que pusiste en la credencial (sin el
     `Bearer `).
   - `SERVERLESS_JIRA_WEBHOOK_URL`: la URL del webhook,
     `https://<n8n>/webhook/urbanpulse/despliegue`.

   > El nombre del secret dice *serverless* porque se eligió cuando se pensaba
   > resolver con una función serverless. Se mantiene para no tocar los dos
   > workflows de despliegue, que ya están en `main`.

5. **Probar sin esperar un despliegue:**
   ```bash
   curl -i -X POST https://<n8n>/webhook/urbanpulse/despliegue \
     -H "Authorization: Bearer <DEPLOY_WEBHOOK_SECRET>" \
     -H "Content-Type: application/json" \
     -d '{"eventType":"deployment_success","projectKey":"UPTI","commitSha":"0000000000000000000000000000000000000000","repository":"prueba/prueba","runId":"1","message":"Prueba de HT-41 T03"}'
   ```
   Debe responder `201` con la clave del ticket. Si responde `403`, la credencial
   no lleva el `Bearer `.

## 🧪 Pruebas

`ia-ops/workflows/tests/test_registrar_despliegue.py` ejecuta los nodos Code en
Node.js, igual que n8n: el mapeo de cada `eventType` a su tipo de solicitud, cada
campo obligatorio que falta, el evento desconocido, el resumen con commit y
`runId`, la resolución del portal, el proyecto sin portal, y la respuesta cuando
Jira rechaza la solicitud.
