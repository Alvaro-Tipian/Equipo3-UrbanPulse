# ADR-015: Arquitectura basada en eventos con n8n y Neon

- **Estado:** Propuesto (pendiente de revisión por Alvaro, Kiara y Emily)
- **Fecha:** 2026-10-05
- **Responsable:** Sergio Ascurra (Arquitecto)
- **Relacionado con:** HT-51, HT-41 (Service Desk), HT-49 (monitoreo del modelo), HT-50 (RAG)

## Contexto

Hasta el Sprint 2, los flujos de n8n se llaman de forma directa: el flujo que crea un reporte conoce y ejecuta cada paso que depende de él. Agregar un consumidor nuevo obliga a modificar el flujo productor.

El Sprint 3 suma tres consumidores que reaccionan a hechos que ocurren en otros flujos:

- La ingesta del RAG (HT-50) debe enterarse de cada reporte nuevo y de cada cambio de estado.
- El Service Desk (HT-41) debe abrir un incidente cuando falla un workflow de n8n o cuando el monitoreo detecta deriva del modelo (HT-49).

Acoplar estos consumidores a los flujos productores haría cada cambio más riesgoso y más difícil de probar.

## Decisión

Adoptar una arquitectura basada en eventos de dominio, sobre la infraestructura que ya existe:

1. Un **catálogo de 4 eventos** (`reporte.creado`, `reporte.estado_cambiado`, `n8n.flujo_fallido`, `modelo.deriva_detectada`) con un **sobre común** (`id`, `tipo`, `fecha`, `origen`, `datos`), definido en `docs/architecture/eventos.md` y `docs/architecture/eventos/sobre.schema.json`.
2. Un **enrutador en n8n** (`POST /urbanpulse/eventos`) que autentica al productor, valida el sobre, guarda el evento en la tabla `eventos` de Neon y lo entrega a sus suscriptores con Execute Workflow. Responde `202` sin esperar a los suscriptores.
3. **Idempotencia por `id`** (`INSERT ... ON CONFLICT (id) DO NOTHING`) y **reproceso horario** de los eventos fallidos con menos de 3 intentos.

El productor no conoce a los consumidores: agregar un suscriptor es una rama nueva en el enrutador, sin tocar el flujo que produce el evento.

## Alternativas consideradas

| Alternativa | Por qué no se eligió ahora |
|---|---|
| Amazon SQS | Agrega un servicio, permisos de IAM y código de consumo para un volumen que el proyecto no justifica en este sprint. Queda como evolución. |
| Amazon EventBridge | Mismo motivo; además suma reglas y destinos que mantener fuera de n8n. |
| Redis (colas o pub/sub) | Requiere un servidor adicional que operar y monitorear; el servicio de Lightsail ya tiene la memoria al límite. |
| Llamadas directas entre flujos (situación actual) | Acopla productor y consumidores; cada consumidor nuevo obliga a modificar el flujo productor. |

## Consecuencias

**Positivas**

- Costo adicional de $0: usa n8n y Neon, que ya están en producción y en staging.
- Los consumidores se agregan sin modificar a los productores.
- Cada evento queda auditado en la tabla `eventos`, incluidos los rechazados y los fallidos.
- El sobre es independiente del transporte: se puede migrar a una cola administrada sin cambiar productores ni contratos.

**Negativas y riesgos**

- La entrega es **al menos una vez**: los consumidores deben ser idempotentes.
- El enrutador es un punto único: su disponibilidad depende de n8n en Lightsail, cuya memoria es una brecha conocida (ver el SAD v4).
- No hay orden garantizado entre eventos; los consumidores no deben depender del orden de llegada.
- El reproceso es horario, no inmediato.

## Plan de verificación

HT-51 T04 prueba en staging tres casos: evento válido, evento inválido (`400` y registrado como rechazado) y suscriptor caído (queda fallido y el reproceso lo entrega al reactivarlo). Los resultados se documentan en el SAD v4.
