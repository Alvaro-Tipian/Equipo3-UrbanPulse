"""Suite de Great Expectations para el dataset de entrenamiento (HT-48 CA1).

Valida el lote ANTES de entrenar. Si falla, el pipeline se detiene: entrenar
sobre datos rotos cuesta mas que no entrenar, porque el modelo resultante parece
funcionar y toma decisiones sobre patrullaje con basura dentro.

Codifica el contrato de la tabla `reports`
(database/migrations/20260814000001_create_reports_table.sql) mas la columna
`distrito`, que la tabla no guarda pero el entrenamiento necesita para controlar
la cobertura geografica.
"""

from __future__ import annotations

import great_expectations as gx
import pandas as pd
from great_expectations import expectations as gxe
from great_expectations.core import ExpectationSuiteValidationResult

NOMBRE_SUITE = "dataset_entrenamiento"

# Volumen minimo. Por debajo de esto no hay suficientes reportes por distrito
# para que el modelo aprende algo util de cada zona: 15 distritos x ~33.
FILAS_MINIMAS = 500
REPORTES_MINIMOS_POR_DISTRITO = 20

# Bounding box de Lima Metropolitana y Callao.
LIMA_LAT = (-12.52, -11.72)
LIMA_LNG = (-77.20, -76.70)

CATEGORIAS_VALIDAS = [
    "SINIESTRO_VIAL",
    "INFRAESTRUCTURA",
    "CONGESTION",
    "ANOMALIA_AMBIENTAL",
]
SEVERIDADES_VALIDAS = ["ALTA", "MEDIA", "BAJA"]
ESTADOS_VALIDOS = ["pending", "en_proceso", "resolved"]

DISTRITOS_ESPERADOS = [
    "Cercado de Lima",
    "Miraflores",
    "San Isidro",
    "Santiago de Surco",
    "La Molina",
    "San Juan de Lurigancho",
    "Villa El Salvador",
    "Comas",
    "Callao",
    "Ate",
    "San Miguel",
    "Barranco",
    "Chorrillos",
    "Los Olivos",
    "San Borja",
]

# Columnas sin las cuales una fila no sirve para entrenar. `image_url` o
# `status` pueden faltar; una coordenada o una categoria, no.
COLUMNAS_CRITICAS = [
    "created_at",
    "description",
    "incident_type",
    "severity",
    "latitude",
    "longitude",
    "distrito",
]

COLUMNAS_ESPERADAS = [
    "id",
    "created_at",
    "description",
    "incident_type",
    "severity",
    "priority",
    "status",
    "latitude",
    "longitude",
    "distrito",
]


def construir_suite() -> gx.ExpectationSuite:
    suite = gx.ExpectationSuite(name=NOMBRE_SUITE)

    # --- Estructura y volumen --------------------------------------------
    suite.add_expectation(gxe.ExpectTableColumnsToMatchSet(column_set=COLUMNAS_ESPERADAS))
    suite.add_expectation(gxe.ExpectTableRowCountToBeBetween(min_value=FILAS_MINIMAS))

    # --- Sin nulos criticos ----------------------------------------------
    for columna in COLUMNAS_CRITICAS:
        suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column=columna))

    # --- Coordenadas dentro de Lima --------------------------------------
    # Coordenadas invertidas o con el signo cambiado son el error de carga mas
    # comun, y entrenan al modelo sobre ubicaciones que no existen.
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeBetween(
            column="latitude", min_value=LIMA_LAT[0], max_value=LIMA_LAT[1]
        )
    )
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeBetween(
            column="longitude", min_value=LIMA_LNG[0], max_value=LIMA_LNG[1]
        )
    )

    # --- Categorias permitidas -------------------------------------------
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeInSet(column="incident_type", value_set=CATEGORIAS_VALIDAS)
    )
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeInSet(column="severity", value_set=SEVERIDADES_VALIDAS)
    )
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeInSet(column="status", value_set=ESTADOS_VALIDOS)
    )
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeBetween(column="priority", min_value=1, max_value=5)
    )

    # --- Cobertura por distrito ------------------------------------------
    # Un dataset que solo trae reportes de Miraflores y San Isidro produce un
    # modelo que no sabe nada de Lima Norte.
    suite.add_expectation(
        gxe.ExpectColumnDistinctValuesToContainSet(
            column="distrito", value_set=DISTRITOS_ESPERADOS
        )
    )

    # --- Unicidad ---------------------------------------------------------
    suite.add_expectation(gxe.ExpectColumnValuesToBeUnique(column="id"))

    return suite


def validar(dataframe: pd.DataFrame) -> ExpectationSuiteValidationResult:
    contexto = gx.get_context(mode="ephemeral")
    fuente = contexto.data_sources.add_pandas(name="dataset_entrenamiento")
    activo = fuente.add_dataframe_asset(name="lote_entrenamiento")
    definicion_lote = activo.add_batch_definition_whole_dataframe("lote_completo")

    suite = contexto.suites.add(construir_suite())
    lote = definicion_lote.get_batch(batch_parameters={"dataframe": dataframe})

    return lote.validate(suite)
