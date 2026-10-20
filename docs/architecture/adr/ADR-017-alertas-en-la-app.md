# ADR-017: Aviso de alertas cercanas dentro de la app en lugar de SMS

- **Estado:** Propuesto (pendiente de revisión por Emily, Kiara y Fabio)
- **Fecha:** 2026-10-20
- **Responsable:** Sergio Ascurra (Arquitecto)
- **Relacionado con:** HU-10 (alertas cercanas), HT-51 (eventos), HT-36 (token)

## Contexto

HU-10 pide avisar al ciudadano cuando se reporta un incidente crítico a menos de 500 m. Hay que decidir por qué canal llega el aviso y cómo se sabe dónde está el ciudadano.

El proyecto debe mantenerse en planes gratuitos (Neon, Vercel, Lightsail, n8n propio). Los usuarios solo tienen correo; no se registra número de teléfono.

## Decisión

1. **Aviso dentro de la app**: el host consulta `GET /urbanpulse/alertas` cada 30 s y muestra el aviso; el ciudadano lo cierra con `POST /urbanpulse/alertas/descartar`.
2. **Última ubicación con consentimiento**: la app pide el permiso de geolocalización y envía la ubicación a `POST /urbanpulse/ubicacion` como máximo cada 5 min. Se guarda solo la última en `usuarios.ultima_ubicacion` (`geography`, índice GiST) y no se usan las de más de 24 h.
3. **Cálculo al recibir el evento**: un suscriptor de `reporte.creado` (ADR-015) busca con `ST_DWithin` a los ciudadanos cercanos y registra una fila por ciudadano en `alertas_ciudadano`, idempotente por `(reporte_id, usuario_id)`.

## Alternativas consideradas

| Alternativa | Por qué no se eligió ahora |
|---|---|
| SMS (Twilio, Amazon SNS) | Costo por mensaje fuera del plan gratuito y exige pedir y validar el teléfono, un dato personal más. |
| Push del navegador (Web Push) | Requiere service worker, claves VAPID y manejo de suscripciones en los 8 microfrontends; no funciona igual en todos los navegadores móviles. Queda como evolución sobre la misma tabla. |
| Correo | Llega tarde para un incidente en curso y se mezcla con el resto del buzón. |
| WebSockets / SSE | n8n no mantiene conexiones abiertas; habría que operar otro servicio en Lightsail, que ya tiene la memoria al límite. |
| Historial de ubicaciones | No lo necesita la historia y aumenta el riesgo sobre un dato personal. |

## Consecuencias

**Positivas**

- Costo adicional de $0.
- Solo se guarda un punto por ciudadano y caduca a las 24 h.
- La tabla de alertas sirve igual si luego se agrega Web Push: cambia el canal, no el cálculo.

**Negativas y riesgos**

- El ciudadano solo ve el aviso con la app abierta; con la pestaña cerrada no se entera.
- Hasta 30 s de demora por el sondeo, y hasta 5 min de desfase en la ubicación.
- El sondeo suma peticiones a n8n: con muchos ciudadanos conectados habrá que medir la carga.
- La ubicación es un dato personal: depende de que el token identifique bien al usuario (HT-36) y de que el descarte filtre por `usuario_id`.

## Plan de verificación

HU-10 T06 (Fabio) prueba con Newman que un ciudadano a 499 m recibe la alerta y uno a 501 m no, que una alerta descartada no vuelve y que un ciudadano no puede descartar alertas ajenas; con Playwright, que el aviso aparece, se cierra y no vuelve.
