# API de inferencia de riesgo vial (HT-47 T02)

Servicio FastAPI que sirve el modelo `riesgo_vial` de HT-46 por zona × franja.
Código: `ia-ops/fastapi_service/`. Despliegue: `deploy-api-inferencia.yml`
(Container Service `urbanpulse-api` de AWS Lightsail, declarado en Terraform).

La consume n8n desde el servidor (HU-08 T04, panel de riesgo; HU-13, estado de
la plataforma). No está pensada para llamarse desde el navegador.

## Contrato de entrada

Las variables son las del dataset de HT-46 T01 (`ml/README.md`). La API calcula
las tres variables derivadas igual que `ml/train/train.py`; quien la llama solo
envía las variables base.

| Campo | Tipo | Notas |
|---|---|---|
| `zona_id` | texto | Punto de monitoreo de TomTom (`puntos_monitoreo.nombre`) |
| `franja` | `manana` \| `tarde` \| `noche` | Sin ñ, igual que el dataset |
| `fecha_objetivo` | fecha ISO | Día para el que se predice |
| `siniestros_12m` | entero ≥ 0 | |
| `severidad_media` | número ≥ 0 | (fallecidos + lesionados) / siniestro |
| `congestion_media` | 0–100 | % de congestión TomTom en esa zona × franja |
| `reportes_30d` | entero ≥ 0 | |

## Endpoints

Todos menos `/health` exigen la cabecera `X-API-Key` (secret `INFERENCE_API_KEY`).

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Liveness. Informa `modo` (`modelo` o `heuristico`) y `version_modelo`. |
| GET | `/model/info` | Versión servida, `run_id`, tag `supera_heuristico`, motivo si está en modo heurístico, último error de inferencia y si Neon responde. |
| POST | `/predict` | Una zona. |
| POST | `/predict/lote` | `{"zonas": [...]}`, hasta 500. Pensado para el panel: todas las zonas en una llamada. |

Respuesta de cada predicción:

```json
{
  "zona_id": "Av. Javier Prado / Via Expresa",
  "franja": "tarde",
  "fecha_objetivo": "2026-10-12",
  "nivel": "medio",
  "probabilidad": 0.612,
  "probabilidades": {"bajo": 0.301, "medio": 0.612, "alto": 0.087},
  "model_version": "4",
  "fuente": "modelo",
  "registrada": true
}
```

- `fuente: "heuristico"` significa que no hay modelo cargado y se respondió con la
  fórmula de Central vr5 (la misma línea base de HT-46). En ese caso
  `probabilidad` es el score normalizado (score / 10) y `probabilidades` es `null`.
- `registrada: false` significa que la predicción no se pudo guardar en
  `prediccion_riesgo`; el monitoreo de deriva (HT-49) no la verá.

## Qué versión se sirve

El pipeline MLOps despliega siempre una versión fija (`MODEL_VERSION`). El alias
`champion` del Model Registry indica cuál es la versión promovida; la API solo lo
usa si `MODEL_VERSION` está vacío (desarrollo local). Mientras ningún modelo
supere a la heurística (hallazgo de HT-46 T02), no habrá `champion` y la API
responderá en modo heurístico, diciéndolo en cada respuesta.

## Correr las pruebas

```bash
cd ia-ops/fastapi_service
pip install -r requirements-dev.txt   # Python 3.12
pytest
# Con un Postgres que tenga la migración de prediccion_riesgo:
TEST_DATABASE_URL=postgresql://usuario@localhost:5432/urbanpulse pytest
```
