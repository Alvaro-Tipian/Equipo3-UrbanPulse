"""
HT-46 T03 - Descarga el modelo registrado (riesgo_vial, alias challenger)
desde el Model Registry de MLflow y lo guarda localmente, dentro de la
imagen Docker, para que la API no dependa del servidor de MLflow en
cada peticion (solo lo necesita una vez, al construirse).

Se ejecuta UNA SOLA VEZ, durante el build de la imagen (ver Dockerfile).
No se ejecuta en cada peticion ni al arrancar el contenedor.

Uso:
  python ml/api/export_model.py
"""
import json
import os

import mlflow
import mlflow.sklearn
from dotenv import load_dotenv
from mlflow.tracking import MlflowClient

load_dotenv()

MODEL_NAME = "riesgo_vial"
# El alias se elige al construir la imagen: el pipeline MLOps (HT-47 T03)
# construye con MODEL_ALIAS=champion para hornear la version ya promovida.
# Por defecto sigue siendo "challenger", asi que el build manual de HT-46 T03
# no cambia.
MODEL_ALIAS = os.environ.get("MODEL_ALIAS", "challenger")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "model")


def main():
    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI")
    if not tracking_uri:
        raise RuntimeError(
            "Falta MLFLOW_TRACKING_URI. Debe pasarse como build secret al "
            "construir la imagen (ver Dockerfile), nunca como ARG en texto plano."
        )
    mlflow.set_tracking_uri(tracking_uri)

    client = MlflowClient()
    version = client.get_model_version_by_alias(MODEL_NAME, MODEL_ALIAS)

    model_uri = f"models:/{MODEL_NAME}@{MODEL_ALIAS}"
    print(f"Descargando {model_uri} (version {version.version}, run {version.run_id})...")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    ruta_modelo = os.path.join(OUTPUT_DIR, "sklearn_model")
    mlflow.sklearn.save_model(mlflow.sklearn.load_model(model_uri), ruta_modelo)

    run = client.get_run(version.run_id)
    # HU-10 T05: las metricas del run que produjo ESTA version se copian aqui,
    # para que /health pueda exponer el F1 del modelo que realmente esta
    # sirviendo. Es la unica lectura de MLflow en toda la cadena: ocurre al
    # hornear la imagen, no en cada peticion, y evita que n8n o el panel
    # necesiten credenciales de MLflow para mostrar el dato.
    metricas = run.data.metrics or {}
    metadata = {
        "model_name": MODEL_NAME,
        "alias": MODEL_ALIAS,
        "version": version.version,
        "model_version_tag": f"{MODEL_NAME}@{version.version}",
        "run_id": version.run_id,
        "entrenado": run.info.start_time,  # epoch ms; main.py lo formatea a fecha
        "supera_heuristico": version.tags.get("supera_heuristico", "desconocido"),
        "f1_macro": metricas.get("f1_macro"),
        "recall_alto": metricas.get("recall_alto"),
        "roc_auc_bajo_vs_resto": metricas.get("roc_auc_bajo_vs_resto"),
    }
    with open(os.path.join(OUTPUT_DIR, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"Modelo guardado en {ruta_modelo}")
    print(f"Metadata: {metadata}")


if __name__ == "__main__":
    main()
