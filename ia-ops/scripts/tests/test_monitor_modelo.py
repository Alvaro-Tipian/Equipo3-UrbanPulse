"""ml/monitoring/monitor.py (HT-49 T02/T03): que version del modelo se monitorea.

El Model Registry de DagsHub respondio con un cuerpo vacio a
get_model_version_by_alias desde el monitoreo, y el workflow fallaba antes de
mirar las predicciones. El modelo que hay que vigilar es el que hizo las
predicciones, y la API lo guarda en prediccion_riesgo.model_version.
"""
import importlib.util
import os

import pandas as pd
import pytest

from conftest import RAIZ

RUTA = os.path.join(RAIZ, "ml", "monitoring", "monitor.py")


@pytest.fixture()
def monitor():
    spec = importlib.util.spec_from_file_location("monitor_modelo", RUTA)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def predicciones(n, versiones=("riesgo_vial@4",)):
    ahora = pd.Timestamp("2026-10-15T12:00:00Z")
    return pd.DataFrame({
        "creado_en": [ahora - pd.Timedelta(minutes=n - i) for i in range(n)],
        "zona_id": [f"Z{i}" for i in range(n)],
        "franja": ["manana"] * n,
        "fecha_objetivo": [ahora.normalize()] * n,
        "nivel": ["bajo"] * n,
        "model_version": [versiones[i * len(versiones) // n] for i in range(n)],
    })


class ClienteQueNoSeDebeUsar:
    def __init__(self, *a, **k):
        raise AssertionError("no hace falta MLflow si no hay predicciones suficientes")


class ClienteSinAlias:
    def get_model_version_by_alias(self, *a):
        raise RuntimeError("Response body: ''")

    def get_model_version(self, nombre, numero):
        return type("Version", (), {"version": numero, "nombre": nombre})()


class Detener(Exception):
    pass


@pytest.fixture()
def entorno(monkeypatch):
    monkeypatch.setenv("MLFLOW_TRACKING_URI", "http://mlflow.invalido")
    monkeypatch.setattr("sys.argv", ["monitor.py"])


def test_version_de_las_predicciones_mas_recientes(monitor):
    assert monitor.version_de_predicciones(predicciones(40, ("riesgo_vial@3", "riesgo_vial@4"))) == "4"


@pytest.mark.parametrize("valor", ["heuristica", "riesgo_vial@", "otro_modelo@4", ""])
def test_version_que_no_es_del_modelo(monitor, valor):
    assert monitor.version_de_predicciones(predicciones(3, (valor,))) is None


def test_sin_predicciones_no_hay_version(monitor):
    assert monitor.version_de_predicciones(pd.DataFrame()) is None


def test_sin_predicciones_suficientes_no_consulta_mlflow(monitor, entorno, monkeypatch, capsys):
    monkeypatch.setattr(monitor, "get_engine", lambda: None)
    monkeypatch.setattr(monitor, "cargar_predicciones", lambda *a: predicciones(3))
    monkeypatch.setattr("mlflow.tracking.MlflowClient", ClienteQueNoSeDebeUsar)
    with pytest.raises(SystemExit) as fin:
        monitor.main()
    assert fin.value.code == 0
    assert "DERIVA_DETECTADA=false" in capsys.readouterr().out


def test_monitorea_la_version_que_hizo_las_predicciones(monitor, entorno, monkeypatch):
    monkeypatch.setattr(monitor, "get_engine", lambda: None)
    monkeypatch.setattr(monitor, "cargar_predicciones", lambda *a: predicciones(monitor.MIN_FILAS))
    monkeypatch.setattr("mlflow.tracking.MlflowClient", ClienteSinAlias)

    def cargar_referencia(cliente, version):
        raise Detener(version.version)

    monkeypatch.setattr(monitor, "cargar_referencia", cargar_referencia)
    with pytest.raises(Detener, match="^4$"):
        monitor.main()
