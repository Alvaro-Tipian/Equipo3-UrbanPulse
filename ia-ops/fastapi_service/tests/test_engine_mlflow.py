"""Carga real desde un Model Registry de MLflow (sqlite local), registrando
el modelo exactamente como lo hace ml/train/train.py: nombre "riesgo_vial",
flavor sklearn y alias en lugar de stages."""

import mlflow
import mlflow.sklearn
import pytest
from mlflow.tracking import MlflowClient

from conftest import zona
from model_engine import VERSION_HEURISTICA, RiskModelEngine


@pytest.fixture()
def registry(tmp_path, monkeypatch, pipeline_ht46):
    monkeypatch.chdir(tmp_path)
    uri = f"sqlite:///{tmp_path}/mlflow.db"
    monkeypatch.setenv("MLFLOW_TRACKING_URI", uri)
    mlflow.set_tracking_uri(uri)
    exp = mlflow.create_experiment("riesgo-vial", artifact_location=str(tmp_path / "artefactos"))
    cliente = MlflowClient()
    versiones = []
    for _ in range(2):
        with mlflow.start_run(experiment_id=exp) as run:
            mlflow.sklearn.log_model(pipeline_ht46, "model")
        mv = mlflow.register_model(f"runs:/{run.info.run_id}/model", "riesgo_vial")
        cliente.set_model_version_tag("riesgo_vial", mv.version, "supera_heuristico", "True")
        versiones.append(str(mv.version))
    cliente.set_registered_model_alias("riesgo_vial", "champion", versiones[0])
    cliente.set_registered_model_alias("riesgo_vial", "challenger", versiones[1])
    yield versiones
    mlflow.set_tracking_uri("")


def test_carga_por_alias_champion(registry):
    engine = RiskModelEngine(alias="champion")
    engine.cargar()
    assert engine.modo == "modelo"
    assert engine.version_activa == registry[0]
    assert engine.info()["supera_heuristico"] == "True"

    [r] = engine.predecir([zona()])
    assert r["fuente"] == "modelo"
    assert r["nivel"] in ("bajo", "medio", "alto")
    assert sum(r["probabilidades"].values()) == pytest.approx(1.0, abs=0.01)
    assert r["probabilidad"] == r["probabilidades"][r["nivel"]]


def test_version_fija_tiene_prioridad_sobre_alias(registry):
    engine = RiskModelEngine(version=registry[1], alias="champion")
    engine.cargar()
    assert engine.version_activa == registry[1]


def test_sin_campeon_responde_con_heuristica_y_lo_dice(registry):
    engine = RiskModelEngine(alias="no-existe")
    engine.cargar()
    assert engine.modo == "heuristico"
    assert engine.version_activa == VERSION_HEURISTICA
    assert "no-existe" in engine.info()["motivo_heuristico"]
    [r] = engine.predecir([zona()])
    assert r["fuente"] == "heuristico"


def test_sin_tracking_uri_responde_con_heuristica(monkeypatch):
    monkeypatch.delenv("MLFLOW_TRACKING_URI", raising=False)
    engine = RiskModelEngine()
    engine.cargar()
    assert engine.modo == "heuristico"
    assert "MLFLOW_TRACKING_URI" in engine.info()["motivo_heuristico"]
