"""Suite de Great Expectations para la salida del modelo de riesgo (HT-48 T01).

Codifica el contrato de datos de la tabla `prediccion_riesgo`
(database/migrations/20260928000001_create_prediccion_riesgo_table.sql) como
expectativas ejecutables. La idea es que un reentrenamiento que cambie el rango
de probabilidades, introduzca nulos o invente un nivel nuevo falle aqui antes de
que esos datos lleguen al mapa o al asistente NLQ.

La suite se construye en codigo (no como JSON exportado) para que viva bajo
revision de codigo y los umbrales esten junto a su justificacion.
"""

from __future__ import annotations

import great_expectations as gx
import pandas as pd
from great_expectations import expectations as gxe
from great_expectations.core import ExpectationSuiteValidationResult

NOMBRE_SUITE = "prediccion_riesgo"

# Mismos cortes que usa datos/generar_fixtures.py y que asume el prompt
# nlq_ciudadano para decidir cuando advertir al ciudadano.
NIVELES_VALIDOS = ["bajo", "medio", "alto"]
FRANJAS_VALIDAS = ["madrugada", "manana", "tarde", "noche"]

COLUMNAS_ESPERADAS = [
    "id",
    "creado_en",
    "zona_id",
    "franja",
    "fecha_objetivo",
    "nivel",
    "probabilidad",
    "model_version",
    "nivel_socioeconomico",
    "ocurrio_siniestro",
]


def construir_suite() -> gx.ExpectationSuite:
    suite = gx.ExpectationSuite(name=NOMBRE_SUITE)

    # --- Estructura -------------------------------------------------------
    suite.add_expectation(
        gxe.ExpectTableColumnsToMatchSet(column_set=COLUMNAS_ESPERADAS)
    )
    # Un lote vacio es el fallo silencioso mas peligroso: el pipeline "pasa"
    # pero el mapa se queda sin capa de riesgo.
    suite.add_expectation(gxe.ExpectTableRowCountToBeBetween(min_value=1))

    # --- Completitud ------------------------------------------------------
    # La migracion declara NOT NULL en todas estas columnas; la expectativa
    # atrapa el caso en que el modelo las emita vacias antes del INSERT.
    for columna in ["zona_id", "franja", "fecha_objetivo", "nivel", "probabilidad", "model_version"]:
        suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column=columna))

    # --- Dominios ---------------------------------------------------------
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeInSet(column="nivel", value_set=NIVELES_VALIDOS)
    )
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeInSet(column="franja", value_set=FRANJAS_VALIDAS)
    )
    # NUMERIC(4,3) en la tabla: una probabilidad fuera de [0,1] ni siquiera
    # entraria, pero conviene detectarlo antes del INSERT y con mejor mensaje.
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeBetween(column="probabilidad", min_value=0.0, max_value=1.0)
    )
    suite.add_expectation(
        gxe.ExpectColumnValuesToMatchRegex(column="zona_id", regex=r"^LIM-\d{2}$")
    )
    # Versionado semantico obligatorio: sin el no se puede rastrear que modelo
    # produjo una prediccion cuando haya que auditar una decision.
    suite.add_expectation(
        gxe.ExpectColumnValuesToMatchRegex(
            column="model_version", regex=r"^[a-z0-9\-]+-\d+\.\d+\.\d+$"
        )
    )

    # --- Unicidad ---------------------------------------------------------
    suite.add_expectation(gxe.ExpectColumnValuesToBeUnique(column="id"))

    # --- Deriva (drift) ---------------------------------------------------
    # Rangos tomados del lote de referencia con holgura. Si una version nueva
    # del modelo desplaza la probabilidad media fuera de esta banda, puede ser
    # legitimo, pero exige revision humana: la alerta es el punto.
    suite.add_expectation(
        gxe.ExpectColumnMeanToBeBetween(column="probabilidad", min_value=0.30, max_value=0.75)
    )
    # Un modelo que colapsa a una sola categoria (todo "bajo", o todo "alto")
    # pasa todas las validaciones fila a fila y aun asi es inutil para priorizar
    # patrullaje. Sobre un lote de ciudad completa deben aparecer los tres
    # niveles; si alguno desaparece, hay que mirar el modelo antes de publicar.
    suite.add_expectation(
        gxe.ExpectColumnDistinctValuesToContainSet(column="nivel", value_set=NIVELES_VALIDOS)
    )

    return suite


def validar(dataframe: pd.DataFrame) -> ExpectationSuiteValidationResult:
    """Corre la suite contra un DataFrame y devuelve el resultado de GX.

    Usa un contexto efimero (en memoria): el banco de pruebas no necesita
    persistir Data Docs ni un store entre corridas, y asi el workflow de CI no
    arrastra un directorio gx/ versionado.
    """
    contexto = gx.get_context(mode="ephemeral")
    fuente = contexto.data_sources.add_pandas(name="predicciones_riesgo")
    activo = fuente.add_dataframe_asset(name="lote_predicciones")
    definicion_lote = activo.add_batch_definition_whole_dataframe("lote_completo")

    suite = contexto.suites.add(construir_suite())
    lote = definicion_lote.get_batch(batch_parameters={"dataframe": dataframe})

    return lote.validate(suite)
