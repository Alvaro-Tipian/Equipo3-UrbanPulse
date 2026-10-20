# ADR-016: Operativos agrupados por distrito con fechas en la misma fila

- **Estado:** Propuesto (pendiente de revisión por Emily y Kiara)
- **Fecha:** 2026-10-20
- **Responsable:** Sergio Ascurra (Arquitecto)
- **Relacionado con:** HU-09 (operativos), HU-11 (KPIs de operativos), HT-51 (eventos)

## Contexto

HU-09 pide que el operador agrupe incidentes de una zona en un operativo y lo asigne a una cuadrilla. HU-11 necesita medir la efectividad de cada operativo y el tiempo de atención. Hay que decidir qué es una "zona" y dónde guardar los tiempos.

Los reportes solo tienen latitud y longitud. El proyecto ya asigna un distrito a cada reporte con `distrito_de_reporte()` (siniestro georreferenciado más cercano), que usan la ingesta RAG y el panel de riesgo.

## Decisión

1. **Zona = distrito del reporte**, obtenido con `distrito_de_reporte()` y guardado como `distritos_lima.nombre_normalizado`. Los reportes sin distrito van a `SIN_DISTRITO`.
2. **Tres tablas**: `cuadrillas`, `operativos` y `operativo_reportes` (N a N con `reports`).
3. **Fechas en la fila del operativo** (`creado_en`, `asignado_en`, `cerrado_en`) con CHECK que las ata al estado, en lugar de una tabla de historial de estados.
4. **Cerrar un operativo resuelve sus reportes** en la misma transacción y publica `operativo.cerrado` en el enrutador de eventos.

## Alternativas consideradas

| Alternativa | Por qué no se eligió ahora |
|---|---|
| Polígonos de distrito (PostGIS) | Exige cargar y mantener límites oficiales; el criterio actual ya lo comparten RAG y panel de riesgo, y cambiarlo en un solo lugar daría zonas distintas. Queda como mejora del cálculo de `distrito_de_reporte()`. |
| Zona libre (texto que escribe el operador) | Impide comparar operativos de la misma zona en los KPIs. |
| Tabla de historial de estados | Más flexible, pero HU-11 solo necesita creación, asignación y cierre; agrega joins sin un uso en el sprint. |
| `reporte_id` único en `operativo_reportes` | Impediría volver a incluir un reporte reabierto en un operativo nuevo. La regla "un operativo abierto por reporte" la valida el webhook. |

## Consecuencias

**Positivas**

- Los KPIs de HU-11 salen de una consulta sobre `operativos` sin reconstruir historiales.
- La zona coincide con la del panel de riesgo y el RAG.
- Las reglas de estado y fechas las garantiza la base, no solo n8n.

**Negativas y riesgos**

- `distrito_de_reporte()` depende de que haya un siniestro georreferenciado a menos de 3 km; si no, el reporte queda en `SIN_DISTRITO`.
- Reasignar una cuadrilla no deja rastro (solo se guarda la primera asignación).
- La regla de un operativo abierto por reporte vive en el webhook: otro cliente que escriba directo en la base podría saltarla.

## Plan de verificación

HU-09 T05 (Fabio) prueba crear, asignar y cerrar un operativo con Playwright y Newman, y el `403` para un ciudadano. HU-11 T05 verifica que cerrar un operativo cambia los KPIs.
