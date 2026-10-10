# Pipeline MLOps del modelo de riesgo vial (HT-47)

- Pipeline: `.github/workflows/mlops-pipeline.yml` (HT-47 T01 y T03)
- Despliegue: `.github/workflows/deploy-api-inferencia.yml` (HT-47 T02)

El pipeline no tiene modelo ni API propios: orquesta lo que entregan las tareas
anteriores del sprint.

| Pieza | Tarea | Responsable | Qué usa el pipeline |
|---|---|---|---|
| `ml/data/build_dataset.py` | HT-46 T01 | Emily | Construye el dataset desde Neon |
| `ml/train/train.py` | HT-46 T02 | Emily | Entrena y registra `riesgo_vial` con alias `challenger` |
| `ml/api/` | HT-46 T03 | Emily | La API que se despliega (modelo horneado en la imagen) |
| `mlops-tests.yml` + `ia-ops/mlops-tests/` | HT-48 | Fabio | Quality gate antes de promover |
| `urbanpulse-api` en Terraform | HT-42 | Sebastián (apply) | Container Service de la API, separado del de n8n |

```
PR ───────────► pruebas de los scripts + suite HT-48 ──► fin (no toca MLflow ni la nube)

main / manual / deriva (HT-49)
  ├─ pruebas de los scripts, suite HT-48            (quality gates)
  ├─ registrar prompts nuevos o modificados          (HT-47 T01)
  └─ build_dataset.py ─► validar_dataset ─► train.py ─► evaluar
                                                         │
                       no supera ─► aviso, sigue el champion actual
                       supera ────► promover ─► build ml/api (champion) ─► Lightsail ─► /health = riesgo_vial@N
                                                    │ falla
                                                    └─► champion vuelve atrás
manual rollback ─► alias champion = N ─► build ml/api ─► Lightsail ─► /health = riesgo_vial@N
```

## Aliases del Model Registry (`riesgo_vial` en DagsHub)

| Alias | Quién lo pone | Significado |
|---|---|---|
| `challenger` | `ml/train/train.py` | Último modelo entrenado |
| `champion` | `promover_modelo.py promover` | Versión en producción (la que se hornea en la imagen) |
| `champion_anterior` | `promover_modelo.py promover` | Destino por defecto del rollback |

## Cuándo se promueve

`ia-ops/scripts/promover_modelo.py evaluar` evalúa el challenger, el champion y la
heurística de Central vr5 **sobre el mismo split de validación** del dataset recién
construido, con el código de `ml/train/train.py`.

1. El challenger supera a la heurística en F1-macro (criterio de HT-46).
2. Si hay champion: no empeora el F1-macro.
3. Si hay champion: no empeora el recall de `alto`.

Además deben pasar las pruebas de los scripts y la suite de HT-48.

Un challenger rechazado **no** hace fallar el pipeline: queda en el resumen
(`decision_promocion.md`) como aviso y producción sigue igual. Con los datos
actuales ningún modelo supera a la heurística (ver `ml/README.md`), así que hoy
el resultado esperado es "no promover".

## Rollback en un solo paso

Actions → *MLOps - Pipeline del modelo de riesgo vial* → Run workflow →
`rollback_to_version` (con versión o vacío para `champion_anterior`).
Mueve el alias `champion` y reconstruye la imagen de `ml/api`, que hornea esa
versión. Termina en verde solo si `/health` en la nube devuelve
`riesgo_vial@<versión>`; si no, el alias vuelve a donde estaba.

## Cambio pedido a HT-46 T03 (Emily)

`ml/api/export_model.py` hornea siempre el alias `challenger`, que según el propio
HT-46 no debe ir a producción sin pasar la promoción. Para que el pipeline decida
qué versión se despliega hace falta que el alias se pueda elegir al construir:

```diff
--- ml/api/export_model.py
-MODEL_ALIAS = "challenger"
+# El pipeline MLOps (HT-47) construye con MODEL_ALIAS=champion.
+MODEL_ALIAS = os.environ.get("MODEL_ALIAS", "challenger")
```

```diff
--- ml/api/Dockerfile  (etapa builder, antes del RUN que monta los secretos)
 COPY ml/api/export_model.py ml/api/build_lookup.py ./
+
+ARG MODEL_ALIAS=challenger
+ENV MODEL_ALIAS=${MODEL_ALIAS}
```

El valor por defecto sigue siendo `challenger`, así que su comando de build actual
no cambia. Probado de punta a punta en local: con `champion` = v1 y `challenger`
= v2, la imagen hornea v1 y `/health` responde `riesgo_vial@1`. Mientras el cambio
no esté, el despliegue falla en la verificación y lo explica en el log.

## Cómo llega n8n a la API

`urbanpulse-api` es un Container Service propio de Lightsail, con endpoint HTTPS
y `X-API-Key`. No comparte la memoria del servicio `micro` de n8n (limitado a
300 MB), y se despliega o revierte sin redesplegar n8n.

- `URBANPULSE_RIESGO_API_URL` está en `infrastructure/lightsail-containers.json.template`
  y llega a n8n en su próximo despliegue (`deploy-lightsail-n8n.yml`).
- La clave va en una credencial **Header Auth** de n8n (`X-API-Key`), igual que el
  token del enrutador de eventos, con el mismo valor que el secret `RIESGO_API_KEY`.

## Antes del primer uso

1. En `main`: `ml/` de Emily (con el cambio de arriba) y `mlops-tests.yml` +
   `ia-ops/mlops-tests/` de Fabio. Sin ellos el pipeline falla y dice cuál falta.
2. Servicio `urbanpulse-api` creado con el `terraform apply` de HT-42. Si ya existe:
   `terraform import aws_lightsail_container_service.api_inferencia urbanpulse-api`.
3. Secrets: `MLFLOW_TRACKING_URI`, `MLFLOW_TRACKING_USERNAME`,
   `MLFLOW_TRACKING_PASSWORD`, `RIESGO_API_KEY` (nuevos); `DB_*` y `AWS_*` ya existen.
4. Opcional: variable de repositorio `FECHA_CORTE_RIESGO` (por defecto `2025-03-31`).
