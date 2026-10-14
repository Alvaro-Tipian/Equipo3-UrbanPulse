"""
HT-49 T02 - Monitoreo semanal de deriva del modelo de riesgo vial.

Compara con Evidently (PSI por variable) las predicciones de la ultima semana
(tabla prediccion_riesgo, HT-49 T01) contra el dataset con que se entreno el
modelo en produccion (artefacto en MLflow), y mide el F1 real cruzando cada
prediccion con los reportes ciudadanos que llegaron despues en la misma zona
y franja.

Salidas:
  - docs/DRIFT_MONITORING_REPORT.json: mismas claves que ia-ops/scripts/
    monitor_drift.py (las consume el paso de evento de ml-monitoring.yml).
  - ml/monitoring/output/reporte_evidently.html: reporte para el artefacto.
  - Run "monitoreo-AAAA-SS" en el experimento "riesgo-vial" de MLflow, y en la
    version del modelo los tags monitoreo_fecha y monitoreo_deriva (HU-08/13).
  - stdout: DERIVA_DETECTADA=true|false (lo lee el workflow).

Uso:
  python ml/monitoring/monitor.py [--dias 7] [--sin-mlflow]

Variables: PREDICCION_LECTURA_DB_URL o DATABASE_URL / DB_* (lectura sobre
prediccion_riesgo, reports y puntos_monitoreo), MLFLOW_TRACKING_URI.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote_plus

import numpy as np
import pandas as pd
from sklearn.metrics import f1_score
from sklearn.neighbors import BallTree
from sqlalchemy import create_engine, text

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = Path(__file__).resolve().parent / "output"

MODELO = "riesgo_vial"
EXPERIMENTO = "riesgo-vial"
ALIAS = os.environ.get("MODEL_ALIAS", "challenger")

# Mismas variables que la API guarda en prediccion_riesgo.variables.
VARIABLES = [
    "siniestros_12m", "severidad_media", "congestion_media", "reportes_30d",
    "congestion_x_siniestros", "severidad_flag", "congestion_alta",
]
NIVELES = ["bajo", "medio", "alto"]

UMBRAL_PSI = 0.20          # criterio de aceptacion HT-49: PSI > 0,2 en una variable
CAIDA_F1_MAX = 0.10        # F1 real cae mas de 10 puntos
MIN_FILAS = 30             # con menos filas el PSI no es confiable
HORIZONTE_DIAS = 7         # igual que HORIZONTE_ETIQUETA_DIAS de build_dataset.py
RADIO_MAX_KM = 3.0
RADIO_TIERRA_KM = 6371.0


# --------------------------------------------------------------------------
# Datos
# --------------------------------------------------------------------------
def get_engine():
    url = os.environ.get("PREDICCION_LECTURA_DB_URL") or os.environ.get("DATABASE_URL")
    if not url:
        password = quote_plus(os.environ["DB_PASSWORD"])
        url = (
            f"postgresql://{os.environ['DB_USER']}:{password}@{os.environ['DB_HOST']}"
            f":{os.environ.get('DB_PORT', '5432')}/{os.environ['DB_DATABASE']}?sslmode=require"
        )
    return create_engine(url)


def cargar_predicciones(engine, desde, hasta) -> pd.DataFrame:
    df = pd.read_sql(
        text(
            "SELECT creado_en, zona_id, franja, fecha_objetivo, variables, nivel "
            "FROM prediccion_riesgo WHERE creado_en >= :d AND creado_en < :h"
        ),
        engine, params={"d": desde, "h": hasta},
    )
    if df.empty:
        return df
    # n8n puede llamar varias veces por zona y dia: se queda la ultima.
    df = (df.sort_values("creado_en")
            .drop_duplicates(["zona_id", "franja", "fecha_objetivo"], keep="last")
            .reset_index(drop=True))
    variables = df["variables"].apply(lambda v: v if isinstance(v, dict) else json.loads(v))
    for col in VARIABLES:
        df[col] = variables.apply(lambda v, c=col: float(v.get(c, 0.0)))
    df["fecha_objetivo"] = pd.to_datetime(df["fecha_objetivo"])
    return df


def franja_de(hora: int) -> str:
    return "manana" if 6 <= hora < 12 else ("tarde" if 12 <= hora < 18 else "noche")


def nivel_real(conteo: int) -> str:
    """Mismos cortes que etiquetar_nivel_riesgo() de build_dataset.py."""
    return "bajo" if conteo <= 0 else ("medio" if conteo == 1 else "alto")


def calcular_f1_real(engine, pred: pd.DataFrame):
    """F1 macro de las predicciones contra los reportes de los 7 dias siguientes.

    Cada reporte ciudadano se asigna a la zona de monitoreo mas cercana
    (<= 3 km), como hace build_dataset.py, y a la franja de su hora.
    """
    if pred.empty:
        return None, 0
    ini = pred["fecha_objetivo"].min()
    fin = pred["fecha_objetivo"].max() + pd.Timedelta(days=HORIZONTE_DIAS)
    zonas = pd.read_sql(
        "SELECT nombre AS zona_id, latitude, longitude FROM puntos_monitoreo", engine
    ).dropna()
    reportes = pd.read_sql(
        text("SELECT created_at, latitude, longitude FROM reports "
             "WHERE latitude IS NOT NULL AND longitude IS NOT NULL "
             "AND created_at >= :i AND created_at < :f"),
        engine, params={"i": ini, "f": fin},
    )
    if zonas.empty:
        return None, 0
    if not reportes.empty:
        tree = BallTree(np.radians(zonas[["latitude", "longitude"]].values), metric="haversine")
        dist, idx = tree.query(np.radians(reportes[["latitude", "longitude"]].values), k=1)
        reportes["zona_id"] = zonas["zona_id"].values[idx[:, 0]]
        reportes = reportes[dist[:, 0] * RADIO_TIERRA_KM <= RADIO_MAX_KM].copy()
        ts = pd.to_datetime(reportes["created_at"], utc=True).dt.tz_localize(None)
        reportes["fecha"] = ts.dt.normalize()
        reportes["franja"] = ts.dt.hour.apply(franja_de)

    reales = []
    for fila in pred.itertuples():
        if reportes.empty:
            conteo = 0
        else:
            m = (
                (reportes["zona_id"] == fila.zona_id) & (reportes["franja"] == fila.franja)
                & (reportes["fecha"] >= fila.fecha_objetivo)
                & (reportes["fecha"] < fila.fecha_objetivo + pd.Timedelta(days=HORIZONTE_DIAS))
            )
            conteo = int(m.sum())
        reales.append(nivel_real(conteo))
    f1 = f1_score(reales, pred["nivel"], labels=NIVELES, average="macro", zero_division=0)
    return float(f1), len(pred)


# --------------------------------------------------------------------------
# Referencia (MLflow)
# --------------------------------------------------------------------------
def cargar_referencia(client, version):
    """Dataset de entrenamiento del modelo en produccion + F1 de validacion.

    version.run_id es el run anidado del modelo; su padre (comparacion_<fecha>)
    guarda fecha_corte, con la que se ubica el run dataset_<fecha> que subio
    el parquet (build_dataset.py).
    """
    import mlflow

    run = client.get_run(version.run_id)
    f1_base = run.data.metrics.get("f1_macro")
    padre = client.get_run(run.data.tags["mlflow.parentRunId"])
    fecha_corte = padre.data.params["fecha_corte"]
    exp = client.get_experiment_by_name(EXPERIMENTO)
    runs = client.search_runs(
        [exp.experiment_id], f"tags.mlflow.runName = 'dataset_{fecha_corte}'",
        order_by=["start_time DESC"], max_results=1,
    )
    if not runs:
        raise RuntimeError(f"No hay run dataset_{fecha_corte} en MLflow con el dataset de referencia.")
    ruta = mlflow.artifacts.download_artifacts(
        run_id=runs[0].info.run_id, artifact_path=f"dataset_{fecha_corte}.parquet",
        dst_path=str(SALIDA / "referencia"),
    )
    ref = pd.read_parquet(ruta)
    ref["franja"] = ref["franja"].fillna("desconocido").astype(str)
    ref["congestion_x_siniestros"] = ref["congestion_media"] * ref["siniestros_12m"]
    ref["severidad_flag"] = (ref["severidad_media"] > 0).astype(float)
    ref["congestion_alta"] = (ref["congestion_media"] > 30).astype(float)
    return ref, f1_base, fecha_corte


def predecir_referencia(ref: pd.DataFrame, version) -> pd.Series:
    import mlflow.sklearn

    modelo = mlflow.sklearn.load_model(f"models:/{MODELO}/{version.version}")
    return pd.Series(modelo.predict(ref[VARIABLES + ["franja"]]), index=ref.index)


# --------------------------------------------------------------------------
# Evidently
# --------------------------------------------------------------------------
def correr_evidently(ref: pd.DataFrame, act: pd.DataFrame, ruta_html: Path) -> dict:
    """PSI por variable (datos) y PSI de la columna de prediccion."""
    from evidently import DataDefinition, Dataset, Report
    from evidently.presets import DataDriftPreset

    columnas = VARIABLES + ["prediccion"]
    definicion = DataDefinition(
        numerical_columns=VARIABLES, categorical_columns=["prediccion"],
    )
    ds_ref = Dataset.from_pandas(ref[columnas], data_definition=definicion)
    ds_act = Dataset.from_pandas(act[columnas], data_definition=definicion)

    reporte = Report([DataDriftPreset(method="psi", threshold=UMBRAL_PSI)])
    resultado = reporte.run(ds_act, ds_ref)
    ruta_html.parent.mkdir(parents=True, exist_ok=True)
    resultado.save_html(str(ruta_html))

    psi = {}
    for m in resultado.dict()["metrics"]:
        # metric_id: "ValueDrift(column=<col>,method=psi,threshold=0.2)"
        coincide = re.match(r"ValueDrift\(column=([^,]+),", m.get("metric_id", ""))
        if coincide and coincide.group(1) in columnas:
            psi[coincide.group(1)] = float(m["value"])
    return psi


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=7)
    ap.add_argument("--sin-mlflow", action="store_true")
    args = ap.parse_args()

    import mlflow
    from mlflow.tracking import MlflowClient

    if not os.environ.get("MLFLOW_TRACKING_URI"):
        sys.exit("Falta MLFLOW_TRACKING_URI.")
    client = MlflowClient()
    version = client.get_model_version_by_alias(MODELO, ALIAS)

    ahora = datetime.now(timezone.utc)
    engine = get_engine()
    actuales = cargar_predicciones(engine, ahora - timedelta(days=args.dias), ahora)
    if len(actuales) < MIN_FILAS:
        print(f"Solo {len(actuales)} predicciones en {args.dias} dias (minimo {MIN_FILAS}); "
              "no hay base para medir deriva.", file=sys.stderr)
        print("DERIVA_DETECTADA=false")
        sys.exit(0)

    ref, f1_base, fecha_corte = cargar_referencia(client, version)
    ref["prediccion"] = predecir_referencia(ref, version)
    actuales["prediccion"] = actuales["nivel"]

    ruta_html = SALIDA / "reporte_evidently.html"
    psi = correr_evidently(ref, actuales, ruta_html)
    psi_vars = {k: v for k, v in psi.items() if k in VARIABLES}
    psi_max = max(psi_vars.values()) if psi_vars else 0.0
    pct_deriva = 100.0 * sum(v > UMBRAL_PSI for v in psi_vars.values()) / max(len(psi_vars), 1)

    # F1 real solo sobre predicciones cuyo horizonte ya se cumplio.
    madura = actuales[actuales["fecha_objetivo"] + pd.Timedelta(days=HORIZONTE_DIAS)
                      <= pd.Timestamp(ahora.date())]
    f1_real, n_f1 = calcular_f1_real(engine, madura)

    caida_f1 = (f1_base - f1_real) if (f1_real is not None and f1_base is not None) else 0.0
    deriva = psi_max > UMBRAL_PSI or caida_f1 > CAIDA_F1_MAX

    iso = ahora.isocalendar()
    nombre_run = f"monitoreo-{iso.year}-{iso.week:02d}"
    reporte = {
        "model_name": MODELO,
        "active_version": version.version,
        "psi_score": round(psi_max, 4),
        "psi_umbral": UMBRAL_PSI,
        "psi_por_variable": {k: round(v, 4) for k, v in psi.items()},
        "pct_variables_con_deriva": round(pct_deriva, 1),
        "f1_actual": None if f1_real is None else round(f1_real, 4),
        "f1_baseline": f1_base,
        "f1_filas_evaluadas": n_f1,
        "deriva": bool(deriva),
        "lote_referencia": f"dataset_{fecha_corte}.parquet",
        "predicciones_auditadas": len(actuales),
        "timestamp": ahora.isoformat(),
    }
    destino = RAIZ / "docs"
    destino.mkdir(exist_ok=True)
    (destino / "DRIFT_MONITORING_REPORT.json").write_text(
        json.dumps(reporte, indent=2, ensure_ascii=False), encoding="utf-8")

    if not args.sin_mlflow:
        mlflow.set_experiment(EXPERIMENTO)
        with mlflow.start_run(run_name=nombre_run):
            mlflow.log_param("model_version", version.version)
            mlflow.log_param("lote_referencia", reporte["lote_referencia"])
            mlflow.log_metric("psi_max", psi_max)
            mlflow.log_metric("pct_variables_con_deriva", pct_deriva)
            if f1_real is not None:
                mlflow.log_metric("f1_real", f1_real)
            mlflow.log_artifact(str(ruta_html))
        client.set_model_version_tag(MODELO, version.version, "monitoreo_fecha", ahora.date().isoformat())
        client.set_model_version_tag(MODELO, version.version, "monitoreo_deriva", str(bool(deriva)).lower())

    print(json.dumps(reporte, indent=2, ensure_ascii=False), file=sys.stderr)
    print(f"DERIVA_DETECTADA={str(bool(deriva)).lower()}")


if __name__ == "__main__":
    main()
