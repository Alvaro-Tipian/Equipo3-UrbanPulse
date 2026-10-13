"""Fixtures compartidas del banco de pruebas MLOps (HT-48).

El origen de las predicciones es configurable para que la misma suite sirva en
dos momentos del proyecto:

* Hoy, mientras HT-46 (modelo de riesgo vial) no publica salidas reales, se
  valida el lote de referencia versionado en ``datos/``.
* Cuando el modelo este entrenado, basta exportar sus predicciones a CSV y
  apuntar ``PREDICCIONES_CSV`` a ese archivo: las expectativas y los umbrales
  de equidad se aplican sin tocar el codigo de las pruebas.
"""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd
import pytest

DIRECTORIO_DATOS = Path(__file__).parent / "datos"
LOTE_SANO = DIRECTORIO_DATOS / "predicciones_muestra.csv"
LOTE_SESGADO = DIRECTORIO_DATOS / "predicciones_sesgadas.csv"
DATASET_ENTRENAMIENTO = DIRECTORIO_DATOS / "dataset_entrenamiento.csv"
DATASET_INVALIDO = DIRECTORIO_DATOS / "dataset_entrenamiento_invalido.csv"
PRIORIDADES = DIRECTORIO_DATOS / "prioridades_predichas.csv"
PRIORIDADES_SESGADAS = DIRECTORIO_DATOS / "prioridades_sesgadas.csv"
PRIORIDADES_SESGADAS_TIPO = DIRECTORIO_DATOS / "prioridades_sesgadas_tipo.csv"


def _leer(ruta: Path, fechas: list[str] | None = None) -> pd.DataFrame:
    if not ruta.exists():
        pytest.fail(
            f"No se encontro el archivo de datos {ruta}. "
            "Regenera los fixtures con: python datos/generar_fixtures.py"
        )
    return pd.read_csv(ruta, parse_dates=["fecha_objetivo"] if fechas is None else fechas)


@pytest.fixture(scope="session")
def predicciones() -> pd.DataFrame:
    """Lote bajo prueba: el fixture de referencia o el que indique el entorno."""
    ruta = Path(os.environ.get("PREDICCIONES_CSV", LOTE_SANO))
    return _leer(ruta)


@pytest.fixture(scope="session")
def predicciones_sesgadas() -> pd.DataFrame:
    """Lote con sesgo inyectado, para las meta-pruebas de los detectores."""
    return _leer(LOTE_SESGADO)


@pytest.fixture(scope="session")
def dataset_entrenamiento() -> pd.DataFrame:
    """Lote de reportes que alimentaria el entrenamiento.

    Igual que las predicciones, el origen es configurable: cuando exista el
    export real de la tabla `reports`, basta apuntar DATASET_ENTRENAMIENTO_CSV.
    """
    ruta = Path(os.environ.get("DATASET_ENTRENAMIENTO_CSV", DATASET_ENTRENAMIENTO))
    return _leer(ruta, fechas=[])


@pytest.fixture(scope="session")
def dataset_entrenamiento_invalido() -> pd.DataFrame:
    """Dataset con un defecto de cada tipo, para las meta-pruebas."""
    return _leer(DATASET_INVALIDO, fechas=[])


@pytest.fixture(scope="session")
def prioridades() -> pd.DataFrame:
    """Prioridades que el modelo asigna a cada reporte, con su valor real."""
    ruta = Path(os.environ.get("PRIORIDADES_CSV", PRIORIDADES))
    return _leer(ruta, fechas=[])


@pytest.fixture(scope="session")
def prioridades_sesgadas() -> pd.DataFrame:
    """Prioridades con sesgo inyectado por distrito, para las meta-pruebas."""
    return _leer(PRIORIDADES_SESGADAS, fechas=[])


@pytest.fixture(scope="session")
def prioridades_sesgadas_tipo() -> pd.DataFrame:
    """Prioridades con una categoria entera enterrada, para las meta-pruebas."""
    return _leer(PRIORIDADES_SESGADAS_TIPO, fechas=[])


@pytest.fixture(scope="session")
def predicciones_con_deriva() -> pd.DataFrame:
    """Lote con la distribucion desplazada, para las pruebas de deriva."""
    return _leer(DIRECTORIO_DATOS / "predicciones_con_deriva.csv")
