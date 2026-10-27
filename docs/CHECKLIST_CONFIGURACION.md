# Checklist de configuración en los entornos (acuerdo A3)

**Acuerdo A3 de la Retrospectiva del Sprint 3.** Dueño: Álvaro Tipián.

Un ítem está **Hecho** cuando su código está integrado en `main` **y** su configuración está verificada en staging y en producción.

**Por qué existe.** En el Sprint 3, cinco fallas llegaron a producción con el código correcto y la configuración mal:

| Falla | Causa | Ítem de la checklist |
|---|---|---|
| Aviso de despliegue con 403 | El secreto de GitHub y el de n8n eran distintos | S2 |
| Solicitud de cambio con 502 | El formulario de Jira no tenía el campo que se enviaba | F3 |
| API de riesgo caída | Le faltaba un paquete y nadie la levantó antes de publicar | D2 |
| Mapa en blanco | El código leía `TE_TOMTOM_API_KEY` y la variable de Vercel se llamaba `VITE_TOMTOM_API_KEY` | S3 |
| Evento sin enviar | La URL de un nodo tenía espacios al inicio | U1 |

Se marca en el PR (sección **Checklist de configuración (A3)** de la plantilla) y se firma aquí cuando el ítem cierra.

## La checklist

**Secretos**
- [ ] **S1.** Cada secreto o variable nueva existe en **todos** los lugares que lo leen: GitHub, Vercel (por proyecto y por entorno: Production y Preview), credenciales de n8n y Lightsail. En staging y en producción.
- [ ] **S2.** Cuando el mismo valor vive en dos lugares (por ejemplo `DEPLOY_WEBHOOK_SECRET` en GitHub, n8n y Vercel), los dos coinciden. Se comprueba con una llamada real, no a ojo.
- [ ] **S3.** El **nombre** de la variable es exactamente el que lee el código: mismo prefijo (`VITE_`, `TE_`) y mismas mayúsculas.
- [ ] **S4.** Ningún secreto quedó en el código, en un log ni en la descripción del PR.

**URLs**
- [ ] **U1.** Ninguna URL tiene espacios ni saltos de línea al inicio o al final, ni en n8n, ni en Vercel, ni en GitHub.
- [ ] **U2.** Cada entorno apunta a lo suyo: staging a staging y producción a producción (n8n, Neon, `remotes.*.json`).
- [ ] **U3.** Si el ítem agrega un dominio que llama a n8n desde el navegador, está en la lista de `docs/CORS_WEBHOOKS.md`.

**Flujos de n8n**
- [ ] **F1.** El workflow está **publicado** en producción, y la copia del repositorio es la exportación de lo publicado.
- [ ] **F2.** Cada nodo tiene su credencial asignada, y en el editor no aparece ningún aviso rojo.
- [ ] **F3.** Se probó el camino feliz y al menos un error con una llamada real (`curl` o la app), y la respuesta coincide con el contrato.
- [ ] **F4.** Los webhooks nuevos validan el token (contrato C1) y usan la lista de orígenes (HT-36 T02).

**Despliegue**
- [ ] **D1.** El despliegue que quedó en producción es el **nuevo**: en Vercel, *Ready* y *Current*, no *Canceled* por el Ignored Build Step; en Lightsail, la versión nueva *Active*.
- [ ] **D2.** El health check del servicio responde (`/healthz` de n8n, `/health` de la API) y el pipeline terminó en verde.
- [ ] **D3.** Se probó en la app desplegada, no solo en local.

## Firmas

Una fila por ítem cerrado. "Verificado por" es quien comprobó la configuración, no quien escribió el código.

| Ítem | Entorno | Verificado por | Fecha | Observaciones |
|---|---|---|---|---|
| HT-36 T06 (rotación de claves) | staging | | | `verificar_rotacion.py`: todas RECHAZADA |
| HT-36 T06 (rotación de claves) | producción | | | `verificar_rotacion.py`: todas RECHAZADA |
