"""
HT-46 T03 - API de inferencia de riesgo vial (contrato 4.1).

Sirve el modelo registrado "riesgo_vial" (alias challenger, entrenado en
HT-46 T02) para que n8n (flujo "Central") lo llame en vez de calcular el
score heuristico directamente. El respaldo ante fallas NO vive aqui: se
implementa en el propio flujo de n8n (HTTP Request con 3s de timeout,
salida de error -> calculo heuristico actual), tal como pide la guia.

El modelo y la tabla de severidad historica por zona se cargan UNA SOLA
VEZ al arrancar el proceso (archivos ya horneados en la imagen por
export_model.py y build_lookup.py durante el build de Docker) -- no se
vuelve a consultar MLflow ni la base de datos en cada peticion.

Nota sobre severidad_media: el contrato 4.1 no la envia (es un dato
historico, no algo que se calcule en el momento). Se completa desde
severidad_por_zona.json (ver build_lookup.py); si la zona no aparece
ahi, se usa 0.0 (mismo criterio que el pipeline de entrenamiento).

Uso local (sin Docker):
  uvicorn ml.api.main:app --reload --port 8000
"""
import json
import os
from datetime import datetime, timezone
from typing import Optional

import mlflow.sklearn
import pandas as pd
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MODEL_DIR = os.path.join(os.path.dirname(__file__), "model")
MAX_ZONAS = 200
NIVELES = ["bajo", "medio", "alto"]

# Mismas columnas y mismo orden que ml/train/train.py (FEATURES).
FEATURES_NUM_BASE = ["siniestros_12m", "severidad_media", "congestion_media", "reportes_30d"]
FEATURES_NUM_DERIVADAS = ["congestion_x_siniestros", "severidad_flag", "congestion_alta"]
FEATURES_CAT = ["franja"]
FEATURES = FEATURES_NUM_BASE + FEATURES_NUM_DERIVADAS + FEATURES_CAT

FRANJAS_VALIDAS = {"manana", "tarde", "noche"}


# --------------------------------------------------------------------------
# Esquemas (contrato 4.1)
# --------------------------------------------------------------------------
class ZonaRequest(BaseModel):
    zona_id: str
    distrito: Optional[str] = None
    siniestros_12m: float = Field(ge=0)
    congestion_media: float = Field(ge=0)
    reportes_30d: float = Field(ge=0)
    tipo_via: Optional[str] = None  # no se usa en el modelo actual (ver train.py); se acepta por contrato


class PredictRequest(BaseModel):
    franja: str
    fecha: str
    zonas: list[ZonaRequest] = Field(min_length=1, max_length=MAX_ZONAS)


class Prediccion(BaseModel):
    zona_id: str
    nivel: str
    probabilidad: float
    motivos: list[str]


class PredictResponse(BaseModel):
    model_version: str
    predicciones: list[Prediccion]


class HealthResponse(BaseModel):
    status: str
    model_version: str
    entrenado: str


# --------------------------------------------------------------------------
# Carga del modelo y de los datos auxiliares (una sola vez, al arrancar)
# --------------------------------------------------------------------------
app = FastAPI(title="UrbanPulse - API de riesgo vial", version="1.0.0")

_modelo = None
_metadata = None
_severidad_por_zona = {}
_motivos_globales: list[str] = []


def _cargar_recursos():
    global _modelo, _metadata, _severidad_por_zona, _motivos_globales

    ruta_modelo = os.path.join(MODEL_DIR, "sklearn_model")
    ruta_metadata = os.path.join(MODEL_DIR, "metadata.json")
    ruta_severidad = os.path.join(MODEL_DIR, "severidad_por_zona.json")

    if not os.path.isdir(ruta_modelo) or not os.path.exists(ruta_metadata):
        raise RuntimeError(
            f"No se encontro el modelo horneado en {MODEL_DIR}. "
            "Corre 'python ml/api/export_model.py' antes de levantar la API "
            "(o reconstruye la imagen Docker, que lo hace automaticamente)."
        )

    _modelo = mlflow.sklearn.load_model(ruta_modelo)

    with open(ruta_metadata) as f:
        _metadata = json.load(f)

    if os.path.exists(ruta_severidad):
        with open(ruta_severidad) as f:
            _severidad_por_zona = json.load(f)
    else:
        _severidad_por_zona = {}

    # Motivos: para un HistGradientBoostingClassifier no hay un
    # feature_importances_ directo por arbol individual accesible de forma
    # simple y barata por prediccion (a diferencia de RandomForest). En vez
    # de inventar una explicacion por-prediccion con una libreria adicional
    # (SHAP) -- fuera del alcance de 3h de esta sub-tarea -- se devuelven
    # las 2 variables que, por diseno del dataset y el score heuristico que
    # el equipo ya usa, mas pesan en el riesgo: siniestros_12m y
    # congestion_media. Esto queda documentado aqui como simplificacion
    # conocida, no oculta.
    _motivos_globales = ["siniestros_12m", "congestion_media"]


@app.on_event("startup")
def startup():
    _cargar_recursos()


# --------------------------------------------------------------------------
# Seguridad: X-API-Key
# --------------------------------------------------------------------------
def _verificar_api_key(x_api_key: Optional[str]):
    api_key_esperada = os.environ.get("API_KEY")
    if not api_key_esperada:
        raise HTTPException(status_code=500, detail="API_KEY no configurada en el servidor")
    if not x_api_key or x_api_key != api_key_esperada:
        raise HTTPException(status_code=401, detail="X-API-Key invalida o ausente")


# --------------------------------------------------------------------------
# Logica de prediccion
# --------------------------------------------------------------------------
def _severidad_de(zona_id: str, franja: str) -> float:
    return float(_severidad_por_zona.get(zona_id, {}).get(franja, 0.0))


def _armar_dataframe(req: PredictRequest) -> pd.DataFrame:
    filas = []
    for z in req.zonas:
        severidad_media = _severidad_de(z.zona_id, req.franja)
        filas.append({
            "zona_id": z.zona_id,
            "siniestros_12m": z.siniestros_12m,
            "severidad_media": severidad_media,
            "congestion_media": z.congestion_media,
            "reportes_30d": z.reportes_30d,
            "franja": req.franja,
        })
    df = pd.DataFrame(filas)
    # Mismas features derivadas que ml/train/train.py (cargar_dataset).
    df["congestion_x_siniestros"] = df["congestion_media"] * df["siniestros_12m"]
    df["severidad_flag"] = (df["severidad_media"] > 0).astype(float)
    df["congestion_alta"] = (df["congestion_media"] > 30).astype(float)
    return df


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse)
def health():
    entrenado_ms = _metadata.get("entrenado")
    entrenado_fecha = (
        datetime.fromtimestamp(entrenado_ms / 1000, tz=timezone.utc).date().isoformat()
        if entrenado_ms else "desconocido"
    )
    return HealthResponse(
        status="ok",
        model_version=_metadata["model_version_tag"],
        entrenado=entrenado_fecha,
    )


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest, x_api_key: Optional[str] = Header(default=None)):
    _verificar_api_key(x_api_key)

    if req.franja not in FRANJAS_VALIDAS:
        raise HTTPException(status_code=400, detail=f"franja debe ser una de {sorted(FRANJAS_VALIDAS)}")

    df = _armar_dataframe(req)
    niveles_predichos = _modelo.predict(df[FEATURES])
    probas = _modelo.predict_proba(df[FEATURES])
    clases = list(_modelo.classes_)

    predicciones = []
    for i, z in enumerate(req.zonas):
        nivel = str(niveles_predichos[i])
        idx_clase = clases.index(nivel) if nivel in clases else int(probas[i].argmax())
        probabilidad = float(probas[i][idx_clase])
        predicciones.append(Prediccion(
            zona_id=z.zona_id,
            nivel=nivel,
            probabilidad=round(probabilidad, 3),
            motivos=_motivos_globales,
        ))

    return PredictResponse(
        model_version=_metadata["model_version_tag"],
        predicciones=predicciones,
    )
