import os
import sys

import numpy as np
import pandas as pd
import pytest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAIZ = os.path.abspath(os.path.join(SCRIPTS, "..", ".."))
sys.path.insert(0, SCRIPTS)


def panel_sintetico(semilla: int = 0, senal: bool = True, semanas: int = 60,
                    fecha_corte: str = "2025-03-31") -> pd.DataFrame:
    """Panel zona x franja x dia con las columnas de ml/data/build_dataset.py.

    Con senal=True el nivel depende de reportes_30d, que la heuristica de
    Central vr5 no usa: un modelo entrenado le gana. Con senal=False el nivel
    es ruido y ningun modelo deberia superarla.
    """
    rng = np.random.default_rng(semilla)
    fin = pd.Timestamp(fecha_corte) - pd.Timedelta(days=7)
    filas = []
    for semana in pd.date_range(end=fin, periods=semanas, freq="W-MON"):
        for z in range(12):
            for franja in ("manana", "tarde", "noche"):
                reportes = int(rng.integers(0, 10))
                if senal:
                    nivel = "alto" if reportes >= 8 else "medio" if reportes >= 5 else "bajo"
                else:
                    nivel = str(rng.choice(["bajo", "medio", "alto"], p=[0.7, 0.2, 0.1]))
                filas.append({
                    "zona_id": f"Z{z}", "distrito": f"D{z % 4}", "franja": franja,
                    "dia_semana": int(rng.integers(0, 7)),
                    "siniestros_12m": int(rng.integers(0, 6)),
                    "severidad_media": float(rng.uniform(0, 2)),
                    "congestion_media": float(rng.uniform(0, 60)),
                    "reportes_30d": reportes, "tipo_via_frecuente": "AVENIDA",
                    "siniestros_semana_siguiente": 0, "nivel_riesgo": nivel, "semana_corte": semana,
                })
    return pd.DataFrame(filas)


@pytest.fixture()
def registry(tmp_path, monkeypatch):
    import mlflow

    monkeypatch.chdir(tmp_path)
    uri = f"sqlite:///{tmp_path}/mlflow.db"
    monkeypatch.setenv("MLFLOW_TRACKING_URI", uri)
    mlflow.set_tracking_uri(uri)
    yield uri
    mlflow.set_tracking_uri("")
