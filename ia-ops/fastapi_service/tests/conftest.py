import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from features import FEATURES, FEATURES_CAT, FEATURES_NUM_BASE, FEATURES_NUM_DERIVADAS, construir_matriz  # noqa: E402


def entrenar_pipeline_como_ht46(semilla: int = 0):
    """Entrena un Pipeline con la misma estructura que ml/train/train.py
    (ColumnTransformer + HistGradientBoostingClassifier, etiquetas de texto)
    sobre datos sinteticos. Sirve de doble del modelo real de Emily."""
    from sklearn.compose import ColumnTransformer
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler

    rng = np.random.default_rng(semilla)
    n = 300
    filas = [
        {
            "siniestros_12m": int(rng.integers(0, 15)),
            "severidad_media": float(rng.uniform(0, 3)),
            "congestion_media": float(rng.uniform(0, 80)),
            "reportes_30d": int(rng.integers(0, 10)),
            "franja": str(rng.choice(["manana", "tarde", "noche"])),
        }
        for _ in range(n)
    ]
    X = construir_matriz(filas)
    y = np.where(X["siniestros_12m"] > 10, "alto", np.where(X["siniestros_12m"] > 5, "medio", "bajo"))
    pipe = Pipeline([
        ("prep", ColumnTransformer([
            ("num", StandardScaler(), FEATURES_NUM_BASE + FEATURES_NUM_DERIVADAS),
            ("cat", OneHotEncoder(handle_unknown="ignore"), FEATURES_CAT),
        ])),
        ("clf", HistGradientBoostingClassifier(random_state=42, max_iter=30)),
    ])
    pipe.fit(X[FEATURES], pd.Series(y))
    return pipe


@pytest.fixture(scope="session")
def pipeline_ht46():
    return entrenar_pipeline_como_ht46()


def zona(**cambios):
    base = {
        "zona_id": "Av. Javier Prado / Via Expresa",
        "franja": "tarde",
        "fecha_objetivo": "2026-10-12",
        "siniestros_12m": 12,
        "severidad_media": 1.5,
        "congestion_media": 45.0,
        "reportes_30d": 3,
    }
    base.update(cambios)
    return base
