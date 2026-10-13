# Ingesta RAG de conocimiento vial (HT-50 T01)

- Migración: `database/migrations/20261005000002_create_conocimiento_vial_table.sql`
- Workflow: `ia-ops/workflows/n8n_ingesta_rag.json`
- Pruebas: `ia-ops/workflows/tests` (CI: `rag-ingesta-ci.yml`)

## Qué guarda

Una ficha por cada uno de los **43 distritos de Lima** y cada franja
(`manana`, `tarde`, `noche`), más 3 fichas de la **red vial nacional en Lima**:
132 en total. Cada ficha tiene su texto, sus métricas (`metricas`), sus fuentes
(`fuentes`) y su embedding de 768 dimensiones.

| Fuente | Tabla | Qué aporta |
|---|---|---|
| ONSV | `siniestros_fatales` | Siniestros con víctimas de los últimos 12 meses con datos, fallecidos, lesionados, clase, causa y tipo de vía más frecuentes |
| Reportes ciudadanos | `reports` (`status = 'resuelto'`) | Reportes resueltos en los últimos 90 días y su tipo más frecuente |
| SUTRAN | `siniestros_sutran` | Vías nacionales con más siniestros, por franja |

- **Ventanas:** se cuentan desde el dato más reciente de cada fuente, no desde
  hoy, porque ONSV y SUTRAN publican con meses de rezago.
- **Reportes:** no guardan distrito, así que se asignan al distrito del
  siniestro ONSV más cercano dentro de 3 km (el mismo radio que
  `ml/data/build_dataset.py`).
- **SUTRAN:** no está geocodificado (ver `ml/README.md`) y no se puede asignar
  a un distrito; por eso tiene sus propias fichas.
- **Distritos sin siniestros:** su ficha lo dice ("la ONSV no registró
  siniestros…"). El RAG puede contestar "no hubo" en lugar de "no sé".

## Cuándo corre

1. **Cada lunes a las 04:00** (Schedule Trigger): recalcula las 132 fichas.
2. **Con cada `reporte.creado` o `reporte.estado_cambiado`**, como suscriptor del
   enrutador de eventos (HT-51): recalcula solo las 3 fichas del distrito del
   reporte. El distrito se toma de `datos.distrito`; si no viene, se calcula con
   `distrito_de_reporte(datos.reporte_id)`.

En los dos casos, solo se piden embeddings de las fichas cuyo texto cambió (se
compara el SHA-256), así que una corrida sin cambios no gasta cuota de Gemini.

## Puesta en marcha en n8n

1. Ejecutar la migración en Neon. Es idempotente. Si la primera versión de la
   tabla (con vectores aleatorios) llegó a crearse, la migración la reemplaza.
2. Importar `n8n_ingesta_rag.json` y asignar las credenciales:
   - Nodos Postgres: la credencial de Neon, por el endpoint *pooled*.
   - Nodo "Generar embeddings (Gemini)": la credencial **Gemini API**
     (Query Auth), la misma que usa el flujo del chat.
3. Activar el workflow (habilita el disparo semanal).
4. Suscribirlo al enrutador. Esto se hace en **Despachar Evento** (HT-51,
   Sebastián): reemplazar la llamada al Suscriptor de Prueba por un Switch por
   `tipo` que envíe `reporte.creado` y `reporte.estado_cambiado` a este workflow
   con Execute Workflow, tal como lo indica la tabla de suscriptores de
   `docs/EVENT_ROUTER_CONTRACT.md`.

Si la ingesta falla (Gemini no responde, una respuesta incompleta, Neon caído),
el workflow termina con error: el despachador marca el evento como `fallido` y
el reproceso lo reintenta. No se guardan fichas a medias.

## Contrato para el lado de consulta (HT-50 T02)

La pregunta del ciudadano se vectoriza con **el mismo modelo y la misma
dimensión**, pero con `taskType` de consulta:

```json
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent
{
  "model": "models/gemini-embedding-001",
  "content": { "parts": [{ "text": "<pregunta>" }] },
  "taskType": "RETRIEVAL_QUERY",
  "outputDimensionality": 768
}
```

Las 5 fichas más parecidas (usa el índice HNSW por coseno):

```sql
SELECT clave, distrito, franja, contenido, fuentes,
       1 - (embedding <=> $1::vector) AS similitud
FROM conocimiento_vial
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

`fuentes` y el propio texto de la ficha permiten citar la fuente en la respuesta,
como pide HT-50 T03.

## Nota para HT-51

El ejemplo del sobre en `EVENT_ROUTER_CONTRACT.md` usa `"reporte_id": 1842`, pero
`reports.id` es UUID. La ingesta ignora un `reporte_id` que no sea UUID y usa
`datos.distrito`. Conviene que HT-51 T03 publique el UUID real.
