"""
HT-46 T02 - Entrena y compara tres enfoques para predecir nivel_riesgo
(bajo / medio / alto) por zona x franja x dia_semana:

  1. Linea base heuristica: reimplementacion en Python del nodo
     "Calcular score de riesgo" del workflow n8n "Central vr5".
  2. Modelo base: regresion logistica (one-hot + escalado, class_weight
     balanceado, tal como pide la guia del sprint).
  3. Ensamble: Gradient Boosting (HistGradientBoostingClassifier de
     scikit-learn, misma familia que XGBoost) con una busqueda pequena de
     hiperparametros.

NOTA IMPORTANTE (hallazgo de HT-46 T02, verificado empiricamente el
2026-10-08): con las features actuales (siniestros_12m, severidad_media,
congestion_media, reportes_30d + categoricas), NINGUN modelo supera al
heuristico en F1-macro. Se probo class_weight="balanced" (empeora:
inunda de falsos positivos), ajuste de umbral de decision sobre train
(mejor umbral posible da F1 binario = 0.006, practicamente nulo), y 3
algoritmos (regresion logistica, Random Forest, Gradient Boosting) con
y sin las features de interaccion agregadas aqui. El techo esta en la
separabilidad real de los datos (ROC-AUC binario bajo/no-bajo: Random
Forest 0.50 -- al azar --, logreg 0.65, Gradient Boosting 0.69), no en
el ajuste del modelo. Mejorar esto de verdad requiere nuevas features
(ej. tendencia de las ultimas semanas) que se calculan en T01
(build_dataset.py) contra Neon -- decision de alcance pendiente con el
equipo, no resoluble dentro de T02.

Por eso se cambio el ensamble de Random Forest a Gradient Boosting (AUC
0.50 -> 0.69: mejora real, aunque el F1 final quede empatado con el
heuristico) y se quitaron distrito/dia_semana/tipo_via_frecuente del
modelo: en las pruebas, agregaban ruido (alta cardinalidad, sin senal
real a esta granularidad) en vez de ayudar.

Los tres enfoques quedan registrados en el experimento "riesgo-vial" de
MLflow (parametros, metricas F1-macro / recall de "alto" y matriz de
confusion). El mejor de los dos modelos entrenados se registra en el
Model Registry como "riesgo_vial" con el alias "challenger" -- el
heuristico no es un modelo entrenable, se usa solo como referencia.

Uso:
  python ml/train/train.py --fecha-corte 2025-03-31

IMPORTANTE: usa una --fecha-corte dentro del periodo con reporte
completo del ONSV (ver ml/README.md); los ultimos ~9 meses antes de la
fecha de "hoy" del sistema no tienen datos reales por rezago de reporte
policial, y dejan la validacion vacia de "medio"/"alto".
"""
import argparse
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mlflow
import mlflow.sklearn
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    classification_report,
    confusion_matrix,
    f1_score,
    recall_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

load_dotenv()

# Features base de HT-46 T01.
FEATURES_NUM_BASE = ["siniestros_12m", "severidad_media", "congestion_media", "reportes_30d"]
# Features de interaccion (calculadas aqui, a partir de columnas que ya
# trae el dataset -- no requieren tocar build_dataset.py). Se agregaron
# tras comprobar en las pruebas que mejoran la separabilidad frente a usar
# solo las 4 base.
FEATURES_NUM_DERIVADAS = ["congestion_x_siniestros", "severidad_flag", "congestion_alta"]
FEATURES_NUM = FEATURES_NUM_BASE + FEATURES_NUM_DERIVADAS
# Solo "franja" como categorica: distrito, dia_semana y tipo_via_frecuente
# se probaron y, en esta granularidad (zona x franja x dia, datos 99%+
# "bajo"), restaban mas de lo que aportaban (ruido de alta cardinalidad).
FEATURES_CAT = ["franja"]
FEATURES = FEATURES_NUM + FEATURES_CAT
TARGET = "nivel_riesgo"
NIVELES = ["bajo", "medio", "alto"]  # orden fijo para metricas y matriz de confusion
OUTPUT_DIR = "ml/train/output"

# Pequena busqueda de hiperparametros para el Gradient Boosting. Se evalua
# cada combinacion directamente contra el split de validacion temporal (no
# con cross-validation): la clase "alto" tiene muy pocos ejemplos en total
# (8 en 4 anos de historico) y un StratifiedKFold de GridSearchCV falla si
# una clase tiene menos miembros que el numero de folds. Usar el split
# temporal ya existente evita ese problema y es consistente con como el
# resto del pipeline evalua el modelo (sin fuga de informacion futura).
GRID_GRADIENT_BOOSTING = [
    {"max_depth": 3, "learning_rate": 0.1, "max_iter": 100},
    {"max_depth": 4, "learning_rate": 0.05, "max_iter": 200},
    {"max_depth": 5, "learning_rate": 0.03, "max_iter": 300},
]


def cargar_dataset(fecha_corte: pd.Timestamp, ruta: str | None) -> pd.DataFrame:
    if ruta is None:
        ruta = f"ml/data/output/dataset_{fecha_corte.date()}.parquet"
    if not os.path.exists(ruta):
        raise FileNotFoundError(
            f"No se encontro {ruta}. Genera primero el dataset con "
            f"'python ml/data/build_dataset.py --fecha-corte {fecha_corte.date()}'."
        )
    df = pd.read_parquet(ruta)

    columnas_requeridas = set(FEATURES_NUM_BASE + FEATURES_CAT + [TARGET, "semana_corte"])
    faltantes = columnas_requeridas - set(df.columns)
    if faltantes:
        raise ValueError(f"Al dataset le faltan columnas esperadas: {sorted(faltantes)}")

    df[TARGET] = df[TARGET].astype(str)
    df[FEATURES_CAT] = df[FEATURES_CAT].fillna("desconocido").astype(str)
    df[FEATURES_NUM_BASE] = df[FEATURES_NUM_BASE].fillna(0.0)

    # Features derivadas (ver nota del modulo).
    df["congestion_x_siniestros"] = df["congestion_media"] * df["siniestros_12m"]
    df["severidad_flag"] = (df["severidad_media"] > 0).astype(float)
    df["congestion_alta"] = (df["congestion_media"] > 30).astype(float)

    return df


def split_temporal(df: pd.DataFrame, fecha_corte: pd.Timestamp):
    """Misma logica que ml/data/build_dataset.py: entrenamiento hasta
    fecha_corte - 8 semanas, validacion en las ultimas 8 semanas."""
    corte_val = fecha_corte - pd.Timedelta(weeks=8)
    train = df[df["semana_corte"] < corte_val].copy()
    val = df[df["semana_corte"] >= corte_val].copy()
    if len(train) == 0 or len(val) == 0:
        raise ValueError(
            f"Split temporal vacio (train={len(train)}, val={len(val)}). "
            "Revisa que --fecha-corte coincida con la del dataset."
        )
    return train, val


def score_heuristico(df: pd.DataFrame) -> pd.Series:
    """Reimplementa el nodo 'Calcular score de riesgo' de Central vr5.

    Formula original (n8n, por incidente puntual en un radio de 500 m):
        score = min(cantidad_siniestros * 0.5, 6)
        if total_fallecidos > 0: score += 2
        if congestion_cercana > 30: score += 2
        score = min(round(score, 1), 10)

    El dataset de HT-46 T01 agrega los datos por zona x franja x semana
    (no hay conteo puntual en 500 m ni fallecidos separados de lesionados),
    asi que se usa el equivalente agregado disponible:
        cantidad_siniestros -> siniestros_12m
        total_fallecidos > 0 -> severidad_media > 0 (fallecidos + lesionados)
        congestion_cercana   -> congestion_media
    """
    score = np.minimum(df["siniestros_12m"].astype(float) * 0.5, 6.0)
    score = score + np.where(df["severidad_media"] > 0, 2.0, 0.0)
    score = score + np.where(df["congestion_media"] > 30, 2.0, 0.0)
    score = np.minimum(np.round(score, 1), 10.0)
    return score


def score_a_nivel(score: pd.Series) -> pd.Series:
    """Convierte el score heuristico (0-10) a los 3 niveles, con los mismos
    cortes que ya usa el equipo para interpretar el score en el chat:
    bajo < 4, medio [4, 7), alto >= 7."""
    return pd.cut(score, bins=[-np.inf, 4, 7, np.inf], labels=NIVELES).astype(str)


def construir_preprocesador() -> ColumnTransformer:
    return ColumnTransformer([
        ("num", StandardScaler(), FEATURES_NUM),
        ("cat", OneHotEncoder(handle_unknown="ignore"), FEATURES_CAT),
    ])


def calcular_metricas(y_true, y_pred) -> dict:
    return {
        "f1_macro": f1_score(y_true, y_pred, labels=NIVELES, average="macro", zero_division=0),
        "recall_alto": recall_score(y_true, y_pred, labels=["alto"], average="macro", zero_division=0),
    }


def guardar_matriz_confusion(y_true, y_pred, titulo: str, nombre_archivo: str) -> str:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    ruta = os.path.join(OUTPUT_DIR, nombre_archivo)
    cm = confusion_matrix(y_true, y_pred, labels=NIVELES)
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=NIVELES)
    fig, ax = plt.subplots(figsize=(4, 4))
    disp.plot(ax=ax, cmap="Blues", colorbar=False)
    ax.set_title(titulo)
    fig.tight_layout()
    fig.savefig(ruta)
    plt.close(fig)
    return ruta


def reportar(nombre: str, y_true, y_pred, metricas: dict):
    print(f"\n[{nombre}] f1_macro={metricas['f1_macro']:.3f}  recall_alto={metricas['recall_alto']:.3f}")
    print(classification_report(y_true, y_pred, labels=NIVELES, zero_division=0))


def run_baseline(train: pd.DataFrame, val: pd.DataFrame) -> dict:
    with mlflow.start_run(run_name="baseline_heuristico", nested=True):
        mlflow.log_param("model", "heuristico_central_vr5")
        pred_val = score_a_nivel(score_heuristico(val))
        m = calcular_metricas(val[TARGET], pred_val)
        mlflow.log_metrics(m)
        ruta_png = guardar_matriz_confusion(val[TARGET], pred_val, "Baseline heuristico", "cm_baseline.png")
        mlflow.log_artifact(ruta_png)
        reportar("heuristico", val[TARGET], pred_val, m)
        return m


def run_logreg(train: pd.DataFrame, val: pd.DataFrame):
    with mlflow.start_run(run_name="logreg", nested=True) as run:
        pipe = Pipeline([
            ("prep", construir_preprocesador()),
            ("clf", LogisticRegression(max_iter=2000, class_weight="balanced")),
        ])
        pipe.fit(train[FEATURES], train[TARGET])
        pred_val = pipe.predict(val[FEATURES])
        m = calcular_metricas(val[TARGET], pred_val)

        mlflow.log_param("model", "logistic_regression")
        mlflow.log_param("class_weight", "balanced")
        mlflow.log_metrics(m)
        ruta_png = guardar_matriz_confusion(val[TARGET], pred_val, "Regresion logistica", "cm_logreg.png")
        mlflow.log_artifact(ruta_png)
        mlflow.sklearn.log_model(pipe, "model")
        reportar("logreg", val[TARGET], pred_val, m)
        return m, pipe, run.info.run_id


def run_gradient_boosting(train: pd.DataFrame, val: pd.DataFrame):
    with mlflow.start_run(run_name="gradient_boosting", nested=True) as run:
        mejor_pipe, mejor_params, mejor_f1 = None, None, -1.0
        for params in GRID_GRADIENT_BOOSTING:
            pipe = Pipeline([
                ("prep", construir_preprocesador()),
                ("clf", HistGradientBoostingClassifier(random_state=42, **params)),
            ])
            pipe.fit(train[FEATURES], train[TARGET])
            pred_val = pipe.predict(val[FEATURES])
            f1 = f1_score(val[TARGET], pred_val, labels=NIVELES, average="macro", zero_division=0)
            print(f"  [gradient_boosting] candidato {params} -> f1_macro={f1:.3f}")
            if f1 > mejor_f1:
                mejor_pipe, mejor_params, mejor_f1 = pipe, params, f1

        pred_val = mejor_pipe.predict(val[FEATURES])
        m = calcular_metricas(val[TARGET], pred_val)

        mlflow.log_param("model", "gradient_boosting")
        mlflow.log_params(mejor_params)
        mlflow.log_metrics(m)
        ruta_png = guardar_matriz_confusion(val[TARGET], pred_val, "Gradient Boosting", "cm_gradient_boosting.png")
        mlflow.log_artifact(ruta_png)
        mlflow.sklearn.log_model(mejor_pipe, "model")
        reportar("gradient_boosting", val[TARGET], pred_val, m)
        return m, mejor_pipe, run.info.run_id


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fecha-corte", required=True, help="Debe coincidir con la del dataset generado en T01, y caer dentro del periodo con reporte completo del ONSV")
    parser.add_argument("--dataset", default=None, help="Ruta al parquet; por defecto ml/data/output/dataset_<fecha-corte>.parquet")
    args = parser.parse_args()
    fecha_corte = pd.Timestamp(args.fecha_corte)

    df = cargar_dataset(fecha_corte, args.dataset)
    train, val = split_temporal(df, fecha_corte)
    print(f"Dataset: {len(df)} filas totales | train: {len(train)} | val: {len(val)}")
    print(f"Distribucion de nivel_riesgo en train:\n{train[TARGET].value_counts()}")
    print(f"Distribucion de nivel_riesgo en val:\n{val[TARGET].value_counts()}")

    mlflow.set_experiment("riesgo-vial")
    with mlflow.start_run(run_name=f"comparacion_{fecha_corte.date()}"):
        mlflow.log_param("fecha_corte", str(fecha_corte.date()))
        mlflow.log_param("train_filas", len(train))
        mlflow.log_param("val_filas", len(val))
        mlflow.log_param("features", ",".join(FEATURES))

        resultados = {}
        resultados["heuristico"] = run_baseline(train, val)
        resultados["logreg"], modelo_logreg, run_id_logreg = run_logreg(train, val)
        resultados["gradient_boosting"], modelo_gb, run_id_gb = run_gradient_boosting(train, val)

        print("\n=== Comparacion final (F1-macro en validacion) ===")
        for nombre, m in resultados.items():
            print(f"{nombre:18s} f1_macro={m['f1_macro']:.3f}  recall_alto={m['recall_alto']:.3f}")

        # El heuristico no es un modelo sklearn entrenado, no se registra en
        # el Model Registry; se compara solo como referencia (criterio de
        # aceptacion de HT-46: el modelo debe superar al calculo heuristico).
        candidatos = {"logreg": run_id_logreg, "gradient_boosting": run_id_gb}
        mejor_nombre = max(candidatos, key=lambda n: resultados[n]["f1_macro"])
        mejor_run_id = candidatos[mejor_nombre]

        supera_heuristico = resultados[mejor_nombre]["f1_macro"] > resultados["heuristico"]["f1_macro"]
        print(f"\nMejor modelo entrenado: {mejor_nombre} (run {mejor_run_id})")
        print(f"¿Supera al heuristico actual? {'si' if supera_heuristico else 'NO - requiere nuevas features (ver docstring del script), no es un problema de ajuste'}")

        model_uri = f"runs:/{mejor_run_id}/model"
        resultado_registro = mlflow.register_model(model_uri, "riesgo_vial")
        client = mlflow.tracking.MlflowClient()
        client.set_registered_model_alias("riesgo_vial", "challenger", resultado_registro.version)
        client.set_model_version_tag(
            "riesgo_vial", resultado_registro.version, "supera_heuristico", str(supera_heuristico)
        )
        print(f"Registrado riesgo_vial v{resultado_registro.version} con alias 'challenger' ({mejor_nombre}).")


if __name__ == "__main__":
    main()
