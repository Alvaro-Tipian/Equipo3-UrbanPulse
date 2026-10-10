"""
Motor de inferencia del modelo de riesgo vial (HT-47 T02).

Carga desde el Model Registry de MLflow (DagsHub) el modelo "riesgo_vial" que
registra ml/train/train.py (HT-46). Que version se sirve lo decide el pipeline
MLOps (HT-47 T03):

  - MODEL_VERSION=<n>: version fija. Es lo que usa el despliegue del pipeline,
    para que el servicio desplegado sea reproducible y el rollback sea volver
    a desplegar el numero anterior.
  - Sin MODEL_VERSION: la version que tenga el alias MODEL_ALIAS (por defecto
    "champion"). Sirve para desarrollo local.

Si no hay modelo que cargar (no hay campeon promovido todavia, MLflow no
responde, etc.) la API sigue respondiendo con la heuristica de Central vr5,
pero lo dice: `fuente="heuristico"` en cada prediccion y `modo="heuristico"`
con el motivo en /model/info. Nunca se presenta la heuristica como el modelo.
"""

import logging
import os
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

import numpy as np

from features import NIVELES, construir_matriz, score_a_nivel, score_heuristico

logger = logging.getLogger("urbanpulse.model_engine")

NOMBRE_MODELO_DEFECTO = "riesgo_vial"
VERSION_HEURISTICA = "heuristico-central-vr5"


@dataclass
class ModeloCargado:
    modelo: Any
    version: str
    run_id: Optional[str] = None
    tags: Dict[str, str] = field(default_factory=dict)


def cargar_desde_mlflow(nombre: str, version: Optional[str], alias: str) -> ModeloCargado:
    """Carga el Pipeline de scikit-learn tal como lo registro train.py.

    Se usa el flavor sklearn (no pyfunc) porque hace falta predict_proba: pyfunc
    solo expone predict, que devuelve la etiqueta.
    """
    import mlflow
    import mlflow.sklearn
    from mlflow.tracking import MlflowClient

    tracking_uri = os.getenv("MLFLOW_TRACKING_URI")
    if not tracking_uri:
        raise RuntimeError("MLFLOW_TRACKING_URI no esta configurado")
    mlflow.set_tracking_uri(tracking_uri)
    cliente = MlflowClient()

    if version:
        mv = cliente.get_model_version(nombre, version)
    else:
        mv = cliente.get_model_version_by_alias(nombre, alias)

    modelo = mlflow.sklearn.load_model(f"models:/{nombre}/{mv.version}")
    if not hasattr(modelo, "predict_proba"):
        raise RuntimeError(f"{nombre} v{mv.version} no expone predict_proba")
    return ModeloCargado(modelo=modelo, version=str(mv.version), run_id=mv.run_id, tags=dict(mv.tags or {}))


class RiskModelEngine:
    def __init__(
        self,
        nombre: str = NOMBRE_MODELO_DEFECTO,
        version: Optional[str] = None,
        alias: str = "champion",
        cargador: Callable[[str, Optional[str], str], ModeloCargado] = cargar_desde_mlflow,
    ):
        self.nombre = nombre
        self.version_solicitada = version
        self.alias = alias
        self._cargador = cargador
        self._lock = threading.Lock()
        self._cargado: Optional[ModeloCargado] = None
        self.motivo_heuristico: Optional[str] = None
        self.ultimo_error_inferencia: Optional[str] = None

    @classmethod
    def desde_entorno(cls) -> "RiskModelEngine":
        return cls(
            nombre=os.getenv("MODEL_NAME", NOMBRE_MODELO_DEFECTO),
            version=os.getenv("MODEL_VERSION") or None,
            alias=os.getenv("MODEL_ALIAS", "champion"),
        )

    def cargar(self) -> None:
        objetivo = f"v{self.version_solicitada}" if self.version_solicitada else f"@{self.alias}"
        try:
            cargado = self._cargador(self.nombre, self.version_solicitada, self.alias)
        except Exception as e:  # el servicio debe arrancar igual, en modo heuristico
            with self._lock:
                self._cargado = None
                self.motivo_heuristico = f"No se pudo cargar {self.nombre} {objetivo}: {e}"
            logger.warning(self.motivo_heuristico)
            return
        with self._lock:
            self._cargado = cargado
            self.motivo_heuristico = None
        logger.info("Modelo %s v%s cargado (%s)", self.nombre, cargado.version, objetivo)

    @property
    def modo(self) -> str:
        return "modelo" if self._cargado else "heuristico"

    @property
    def version_activa(self) -> str:
        return self._cargado.version if self._cargado else VERSION_HEURISTICA

    def info(self) -> Dict[str, Any]:
        cargado = self._cargado
        return {
            "modelo": self.nombre,
            "modo": self.modo,
            "version": self.version_activa,
            "version_solicitada": self.version_solicitada,
            "alias": None if self.version_solicitada else self.alias,
            "run_id": cargado.run_id if cargado else None,
            "supera_heuristico": cargado.tags.get("supera_heuristico") if cargado else None,
            "motivo_heuristico": self.motivo_heuristico,
            "ultimo_error_inferencia": self.ultimo_error_inferencia,
        }

    def predecir(self, filas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Predice el nivel de riesgo de cada fila (variables base de HT-46)."""
        X = construir_matriz(filas)
        cargado = self._cargado
        if cargado is not None:
            try:
                return self._predecir_modelo(cargado, X)
            except Exception as e:
                # Un fallo del modelo con datos validos es un defecto, no un caso
                # normal: queda registrado y visible en /model/info.
                self.ultimo_error_inferencia = f"{type(e).__name__}: {e}"
                logger.exception("Fallo la inferencia con %s v%s; se usa la heuristica", self.nombre, cargado.version)
        return self._predecir_heuristico(X)

    def _predecir_modelo(self, cargado: ModeloCargado, X) -> List[Dict[str, Any]]:
        probas = cargado.modelo.predict_proba(X)
        clases = [str(c) for c in cargado.modelo.classes_]
        resultados = []
        for fila in probas:
            por_clase = {nivel: 0.0 for nivel in NIVELES}
            for clase, p in zip(clases, fila):
                por_clase[clase] = float(p)
            nivel = clases[int(np.argmax(fila))]
            resultados.append({
                "nivel": nivel,
                "probabilidad": round(por_clase[nivel], 3),
                "probabilidades": {k: round(v, 3) for k, v in por_clase.items()},
                "model_version": cargado.version,
                "fuente": "modelo",
            })
        return resultados

    def _predecir_heuristico(self, X) -> List[Dict[str, Any]]:
        scores = score_heuristico(X)
        niveles = score_a_nivel(scores)
        # La heuristica no da probabilidades: se informa el score normalizado
        # (0-1) en "probabilidad" y "probabilidades" queda vacio.
        return [
            {
                "nivel": nivel,
                "probabilidad": round(float(s) / 10.0, 3),
                "probabilidades": None,
                "model_version": VERSION_HEURISTICA,
                "fuente": "heuristico",
            }
            for s, nivel in zip(scores, niveles)
        ]
