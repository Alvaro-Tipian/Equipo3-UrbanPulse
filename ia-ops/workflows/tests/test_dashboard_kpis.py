"""Webhook report-image del workflow Dashboard KPIs."""

import json
from pathlib import Path

import pytest

from test_nodos_codigo import evaluar

RAIZ = Path(__file__).resolve().parents[3]
DASHBOARD = RAIZ / "src" / "n8n-workflows" / "production" / "UrbanPulse - Dashboard KPIs vr2.json"
NODOS = {n["name"]: n for n in json.loads(DASHBOARD.read_text(encoding="utf-8"))["nodes"]}
UUID = "4f6c1a2e-9b3d-4c5e-8f7a-1b2c3d4e5f60"


def parametros_de_imagen(query):
    reemplazo = NODOS["Imagen del reporte"]["parameters"]["options"]["queryReplacement"]
    return evaluar(reemplazo, {"query": query})


def test_id_uuid_llega_a_la_consulta():
    assert parametros_de_imagen({"id": UUID}) == [UUID]
    assert parametros_de_imagen({"id": UUID.upper()}) == [UUID.upper()]


@pytest.mark.parametrize("query", [{"id": "1"}, {"id": "1 OR 1=1"}, {"id": ""}, {}])
def test_id_que_no_es_uuid_no_llega_a_postgres(query):
    # reports.id es UUID: "?id=1" hacia fallar la consulta y el webhook respondia 500.
    assert parametros_de_imagen(query) == [None]
