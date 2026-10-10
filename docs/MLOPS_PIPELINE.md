# Pipeline MLOps del modelo de riesgo vial (HT-47 T03)

Workflow: `.github/workflows/mlops-pipeline.yml`.

```
PR ───────────► pruebas API + scripts ─┐
                suite HT-48 (Fabio) ───┴─► fin (no toca MLflow ni la nube)

main / manual / deriva (HT-49)
  ├─ pruebas API + scripts, suite HT-48           (quality gates)
  ├─ registrar prompts nuevos o modificados        (HT-47 T01)
  └─ build_dataset.py ─► validar_dataset ─► train.py ─► evaluar
                                                         │
                       no supera ─► aviso, sigue el champion actual
                       supera ────► promover ─► desplegar API ─► /health = vN
                                                    │ falla
                                                    └─► champion vuelve atrás
manual rollback ─► alias champion ─► redesplegar la imagen actual con vN
```

## Aliases del Model Registry (`riesgo_vial` en DagsHub)

| Alias | Quién lo pone | Significado |
|---|---|---|
| `challenger` | `ml/train/train.py` (HT-46) | Último modelo entrenado |
| `champion` | `promover_modelo.py promover` | Versión en producción |
| `champion_anterior` | `promover_modelo.py promover` | Destino por defecto del rollback |

## Cuándo se promueve

`ia-ops/scripts/promover_modelo.py evaluar` evalúa el challenger, el champion y la
heurística de Central vr5 **sobre el mismo split de validación** del dataset recién
construido, con el código de `ml/train/train.py`. Las métricas guardadas en cada run
vienen de fechas de corte distintas y no son comparables entre sí.

1. El challenger supera a la heurística en F1-macro (criterio de HT-46).
2. Si hay champion: no empeora el F1-macro.
3. Si hay champion: no empeora el recall de `alto`.

Además deben pasar las pruebas de la API y la suite de HT-48 (`mlops-tests.yml`).

Un challenger rechazado **no** hace fallar el pipeline: queda en el resumen de la
ejecución (`decision_promocion.md`) como aviso y producción sigue igual. Con los
datos actuales ningún modelo supera a la heurística (ver `ml/README.md`), así que
hoy el resultado esperado es "no promover" y la API sirve la heurística, diciéndolo.

## Rollback en un solo paso

Actions → *MLOps - Pipeline del modelo de riesgo vial* → Run workflow →
`rollback_to_version` (con versión o vacío para `champion_anterior`).
Mueve el alias y redespliega la imagen que ya está en producción con esa versión,
sin reconstruir. Termina en verde solo si `/health` en la nube devuelve la versión
restaurada; si no, el alias vuelve a donde estaba.

## Antes del primer uso

- En `main`: `ml/` (HT-46, Emily) y `mlops-tests.yml` + `ia-ops/mlops-tests/` (HT-48, Fabio).
  Sin ellos el pipeline falla y dice cuál falta.
- Secrets: `MLFLOW_TRACKING_URI`, `MLFLOW_TRACKING_USERNAME`, `MLFLOW_TRACKING_PASSWORD`,
  `DB_*` (Neon), `INFERENCE_API_KEY`, `AWS_*`.
- Servicio `urbanpulse-api` creado con Terraform (`terraform apply` de HT-42).
- Opcional: variable de repositorio `FECHA_CORTE_RIESGO` (por defecto `2025-03-31`).
