"""Guarda predicciones en una tabla prediccion_riesgo real, creada con la
migracion del repositorio (HT-49 T01). Se omite si no hay TEST_DATABASE_URL:

  TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/urbanpulse pytest
"""

import os
from datetime import date
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg")

DSN = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="TEST_DATABASE_URL no configurado")

MIGRACION = Path(__file__).resolve().parents[3] / "database/migrations/20260928000001_create_prediccion_riesgo_table.sql"


@pytest.fixture()
def repo():
    from repository import RepositorioPostgres

    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS prediccion_riesgo")
        conn.execute(MIGRACION.read_text(encoding="utf-8"))
    return RepositorioPostgres(DSN)


def test_guarda_con_las_columnas_de_la_migracion(repo):
    repo.guardar([
        {
            "zona_id": "Ovalo Higuereta",
            "franja": "noche",
            "fecha_objetivo": date(2026, 10, 12),
            "variables": {"siniestros_12m": 3, "severidad_media": 0.5, "congestion_media": 41.2, "reportes_30d": 2},
            "nivel": "medio",
            "probabilidad": 0.617,
            "model_version": "4",
        }
    ])
    assert repo.comprobar() is True
    with psycopg.connect(DSN) as conn:
        fila = conn.execute(
            "SELECT zona_id, franja, fecha_objetivo, variables->>'congestion_media', nivel, probabilidad, model_version "
            "FROM prediccion_riesgo"
        ).fetchone()
    assert fila[:5] == ("Ovalo Higuereta", "noche", date(2026, 10, 12), "41.2", "medio")
    assert float(fila[5]) == 0.617
    assert fila[6] == "4"
