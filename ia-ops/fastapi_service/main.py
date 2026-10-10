"""
API de inferencia del riesgo vial de UrbanPulse (HT-47 T02).

Sirve el modelo "riesgo_vial" de HT-46 por zona x franja. La consumen los
workflows de n8n (HU-08 T04, panel de riesgo) desde el servidor, no el
navegador: por eso /predict exige X-API-Key y CORS esta cerrado por defecto.

Variables de entorno:
  MLFLOW_TRACKING_URI, MLFLOW_TRACKING_USERNAME, MLFLOW_TRACKING_PASSWORD
  MODEL_NAME (riesgo_vial), MODEL_VERSION (fija) o MODEL_ALIAS (champion)
  DATABASE_URL           Neon; sin ella no se guarda en prediccion_riesgo
  INFERENCE_API_KEY      clave que deben enviar los clientes en X-API-Key
  APP_ENV                "production" exige INFERENCE_API_KEY y DATABASE_URL
  CORS_ALLOWED_ORIGINS   lista separada por comas; vacio = sin CORS
"""

import hmac
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import date
from typing import Any, Dict, List, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

import repository
from model_engine import RiskModelEngine

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("urbanpulse.api")

MAX_LOTE = 500


class VariablesZona(BaseModel):
    """Variables base de HT-46 T01 para una zona x franja (ver ml/README.md)."""

    zona_id: str = Field(..., min_length=1, max_length=120, description="Punto de monitoreo TomTom")
    franja: Literal["manana", "tarde", "noche"]
    fecha_objetivo: date = Field(..., description="Dia para el que se predice el riesgo")
    siniestros_12m: int = Field(..., ge=0, le=10_000)
    severidad_media: float = Field(..., ge=0, le=1_000)
    congestion_media: float = Field(..., ge=0, le=100, description="% de congestion TomTom")
    reportes_30d: int = Field(..., ge=0, le=100_000)


class Prediccion(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    zona_id: str
    franja: str
    fecha_objetivo: date
    nivel: Literal["bajo", "medio", "alto"]
    probabilidad: float
    probabilidades: Optional[Dict[str, float]]
    model_version: str
    fuente: Literal["modelo", "heuristico"]
    registrada: bool


class LotePredicciones(BaseModel):
    zonas: List[VariablesZona] = Field(..., min_length=1, max_length=MAX_LOTE)


class RespuestaLote(BaseModel):
    predicciones: List[Prediccion]
    tiempo_ms: float


def validar_configuracion(api_key: Optional[str], repo_habilitado: bool) -> None:
    if os.getenv("APP_ENV") == "production":
        faltantes = [n for n, ok in (("INFERENCE_API_KEY", api_key), ("DATABASE_URL", repo_habilitado)) if not ok]
        if faltantes:
            raise RuntimeError(f"APP_ENV=production requiere: {', '.join(faltantes)}")


def crear_app(
    engine: Optional[RiskModelEngine] = None,
    repo: Optional[repository.RepositorioPredicciones] = None,
    api_key: Optional[str] = None,
) -> FastAPI:
    engine = engine or RiskModelEngine.desde_entorno()
    repo = repo or repository.desde_entorno()
    api_key = api_key if api_key is not None else os.getenv("INFERENCE_API_KEY")
    validar_configuracion(api_key, repo.habilitado)
    if not api_key:
        logger.warning("INFERENCE_API_KEY no configurada: /predict queda abierto (solo para desarrollo local)")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        engine.cargar()
        yield

    app = FastAPI(
        title="UrbanPulse - API de riesgo vial",
        description="Inferencia del modelo riesgo_vial (HT-46) por zona y franja",
        version="2.0.0",
        lifespan=lifespan,
    )

    origenes = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    if origenes:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origenes,
            allow_credentials=False,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type", "X-API-Key"],
        )

    def exigir_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
        if api_key and not (x_api_key and hmac.compare_digest(x_api_key, api_key)):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="X-API-Key invalida o ausente")

    def predecir_y_registrar(zonas: List[VariablesZona]) -> List[Prediccion]:
        filas = [z.model_dump() for z in zonas]
        resultados = engine.predecir(filas)
        registros = [
            {
                "zona_id": f["zona_id"],
                "franja": f["franja"],
                "fecha_objetivo": f["fecha_objetivo"],
                "variables": {k: f[k] for k in ("siniestros_12m", "severidad_media", "congestion_media", "reportes_30d")},
                "nivel": r["nivel"],
                "probabilidad": r["probabilidad"],
                "model_version": r["model_version"],
            }
            for f, r in zip(filas, resultados)
        ]
        registrada = False
        if repo.habilitado:
            try:
                repo.guardar(registros)
                registrada = True
            except Exception:
                # La prediccion se entrega igual; la perdida queda en el log y
                # en "registrada": false para que el cliente pueda verla.
                logger.exception("No se pudieron guardar %d predicciones en prediccion_riesgo", len(registros))
        return [
            Prediccion(
                zona_id=f["zona_id"],
                franja=f["franja"],
                fecha_objetivo=f["fecha_objetivo"],
                registrada=registrada,
                **r,
            )
            for f, r in zip(filas, resultados)
        ]

    @app.get("/health")
    def health() -> Dict[str, Any]:
        """Liveness para Lightsail: responde mientras el proceso este vivo,
        incluso en modo heuristico (el modo se informa, no tumba el servicio)."""
        return {"status": "ok", "modo": engine.modo, "version_modelo": engine.version_activa}

    @app.get("/model/info", dependencies=[Depends(exigir_api_key)])
    def model_info() -> Dict[str, Any]:
        info = engine.info()
        info["registro_predicciones"] = repo.comprobar() if repo.habilitado else False
        return info

    @app.post("/predict", response_model=Prediccion, dependencies=[Depends(exigir_api_key)])
    def predict(zona: VariablesZona) -> Prediccion:
        return predecir_y_registrar([zona])[0]

    @app.post("/predict/lote", response_model=RespuestaLote, dependencies=[Depends(exigir_api_key)])
    def predict_lote(lote: LotePredicciones) -> RespuestaLote:
        inicio = time.perf_counter()
        predicciones = predecir_y_registrar(lote.zonas)
        return RespuestaLote(predicciones=predicciones, tiempo_ms=round((time.perf_counter() - inicio) * 1000, 2))

    return app


app = crear_app()
