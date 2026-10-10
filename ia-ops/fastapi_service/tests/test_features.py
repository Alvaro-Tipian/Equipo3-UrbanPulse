import pandas as pd
import pytest

from features import FEATURES, construir_matriz, score_a_nivel, score_heuristico


def test_columnas_iguales_a_train_py():
    # Orden y nombres de ml/train/train.py (FEATURES = NUM_BASE + NUM_DERIVADAS + CAT).
    assert FEATURES == [
        "siniestros_12m", "severidad_media", "congestion_media", "reportes_30d",
        "congestion_x_siniestros", "severidad_flag", "congestion_alta",
        "franja",
    ]


def test_variables_derivadas_como_train_py():
    X = construir_matriz([
        {"siniestros_12m": 4, "severidad_media": 0.0, "congestion_media": 30.0, "reportes_30d": 1, "franja": "noche"},
        {"siniestros_12m": 2, "severidad_media": 0.5, "congestion_media": 30.1, "reportes_30d": 0, "franja": None},
    ])
    assert X["congestion_x_siniestros"].tolist() == [120.0, 60.2]
    assert X["severidad_flag"].tolist() == [0.0, 1.0]
    assert X["congestion_alta"].tolist() == [0.0, 1.0]  # 30 no es "alta"; > 30 si
    assert X["franja"].tolist() == ["noche", "desconocido"]


@pytest.mark.parametrize(
    "siniestros, severidad, congestion, score, nivel",
    [
        (0, 0.0, 0.0, 0.0, "bajo"),
        (8, 0.0, 0.0, 4.0, "bajo"),     # borde: pd.cut incluye el 4 en "bajo"
        (9, 0.0, 0.0, 4.5, "medio"),
        (6, 1.0, 31.0, 7.0, "medio"),   # borde: el 7 queda en "medio"
        (7, 1.0, 31.0, 7.5, "alto"),
        (40, 2.0, 90.0, 10.0, "alto"),  # tope de 6 por siniestros + 2 + 2
    ],
)
def test_heuristica_central_vr5(siniestros, severidad, congestion, score, nivel):
    X = construir_matriz([{"siniestros_12m": siniestros, "severidad_media": severidad,
                           "congestion_media": congestion, "reportes_30d": 0, "franja": "tarde"}])
    s = score_heuristico(X)
    assert s.tolist() == [score]
    assert score_a_nivel(s) == [nivel]


def test_cortes_iguales_a_pd_cut_de_train_py():
    import numpy as np
    scores = np.arange(0, 10.5, 0.5)
    esperado = pd.cut(scores, bins=[-np.inf, 4, 7, np.inf], labels=["bajo", "medio", "alto"]).astype(str).tolist()
    assert score_a_nivel(scores) == esperado
