"""
Contrato de variables del modelo de riesgo vial (HT-46) para la API de
inferencia (HT-47 T02).

El modelo que entrena ml/train/train.py (Emily, HT-46 T02) es un Pipeline de
scikit-learn que espera estas columnas exactas. Tres de ellas (las derivadas)
NO las calcula el Pipeline sino train.py antes de entrenar, asi que la API
tiene que calcularlas igual; si cambian alla, hay que cambiarlas aqui. Las
pruebas de tests/test_features.py fijan este contrato.

La heuristica de respaldo es la misma "linea base" con la que HT-46 compara
el modelo (nodo "Calcular score de riesgo" del workflow Central vr5), no una
formula nueva: si no hay modelo campeon, la API responde lo mismo que el
sistema respondia antes de tener modelo.
"""

from typing import Dict, List

import numpy as np
import pandas as pd

FRANJAS = ("manana", "tarde", "noche")
NIVELES = ("bajo", "medio", "alto")

# ml/train/train.py: FEATURES_NUM_BASE, FEATURES_NUM_DERIVADAS, FEATURES_CAT.
FEATURES_NUM_BASE: List[str] = ["siniestros_12m", "severidad_media", "congestion_media", "reportes_30d"]
FEATURES_NUM_DERIVADAS: List[str] = ["congestion_x_siniestros", "severidad_flag", "congestion_alta"]
FEATURES_CAT: List[str] = ["franja"]
FEATURES: List[str] = FEATURES_NUM_BASE + FEATURES_NUM_DERIVADAS + FEATURES_CAT

# Umbral de congestion "alta" (%) compartido por train.py y la heuristica.
UMBRAL_CONGESTION_ALTA = 30


def construir_matriz(filas: List[Dict]) -> pd.DataFrame:
    """Arma el DataFrame de entrada del modelo a partir de las variables base.

    Replica cargar_dataset() de ml/train/train.py: mismos rellenos de nulos y
    mismas variables derivadas.
    """
    df = pd.DataFrame(filas)
    df["franja"] = df["franja"].fillna("desconocido").astype(str)
    df[FEATURES_NUM_BASE] = df[FEATURES_NUM_BASE].astype(float).fillna(0.0)
    df["congestion_x_siniestros"] = df["congestion_media"] * df["siniestros_12m"]
    df["severidad_flag"] = (df["severidad_media"] > 0).astype(float)
    df["congestion_alta"] = (df["congestion_media"] > UMBRAL_CONGESTION_ALTA).astype(float)
    return df[FEATURES]


def score_heuristico(df: pd.DataFrame) -> np.ndarray:
    """Score 0-10 de Central vr5 (ver score_heuristico() en ml/train/train.py)."""
    score = np.minimum(df["siniestros_12m"].astype(float).to_numpy() * 0.5, 6.0)
    score = score + np.where(df["severidad_media"].to_numpy() > 0, 2.0, 0.0)
    score = score + np.where(df["congestion_media"].to_numpy() > UMBRAL_CONGESTION_ALTA, 2.0, 0.0)
    return np.minimum(np.round(score, 1), 10.0)


def score_a_nivel(score: np.ndarray) -> List[str]:
    """Convierte el score a nivel con los mismos cortes que score_a_nivel() de
    train.py: pd.cut(bins=[-inf, 4, 7, inf]), que incluye el borde derecho.
    Es decir bajo <= 4, medio (4, 7], alto > 7. (El docstring de train.py dice
    "bajo < 4", pero la comparacion de HT-46 se hizo con este codigo.)"""
    return [NIVELES[0] if s <= 4 else NIVELES[1] if s <= 7 else NIVELES[2] for s in score]
