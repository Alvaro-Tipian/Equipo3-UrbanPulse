"""Pruebas de calidad de datos del modelo de riesgo (HT-48 T01).

Envuelven la suite de Great Expectations en pytest para que CI tenga un unico
comando y un unico reporte. Cuando una expectativa falla, el test imprime que
expectativa fue y sobre cuantas filas, en vez del volcado completo de GX.
"""

from __future__ import annotations

import pandas as pd

from expectativas.suite_prediccion_riesgo import NIVELES_VALIDOS, validar


def _expectativas_fallidas(resultado) -> list[str]:
    fallos = []
    for item in resultado.results:
        if item.success:
            continue
        configuracion = item.expectation_config
        columna = configuracion.kwargs.get("column", "tabla completa")
        inesperados = item.result.get("unexpected_count", "n/d")
        fallos.append(f"{configuracion.type} sobre '{columna}' ({inesperados} valor(es) inesperado(s))")
    return fallos


def test_lote_cumple_el_contrato_de_datos(predicciones: pd.DataFrame) -> None:
    resultado = validar(predicciones)

    assert resultado.success, (
        "El lote de predicciones no cumple el contrato de datos:\n  - "
        + "\n  - ".join(_expectativas_fallidas(resultado))
    )


def test_la_suite_detecta_un_lote_corrupto(predicciones: pd.DataFrame) -> None:
    """Meta-prueba: una suite que nunca falla no protege nada.

    Se corrompe una copia del lote con los tres fallos que mas preocupan
    (probabilidad fuera de rango, nivel desconocido y zona nula) y se exige que
    la suite los marque.
    """
    corrupto = predicciones.copy()
    corrupto.loc[corrupto.index[0], "probabilidad"] = 1.7
    corrupto.loc[corrupto.index[1], "nivel"] = "critico"
    corrupto.loc[corrupto.index[2], "zona_id"] = None

    resultado = validar(corrupto)

    assert not resultado.success, "La suite dio por bueno un lote deliberadamente corrupto."

    tipos_fallidos = {item.expectation_config.type for item in resultado.results if not item.success}
    assert "expect_column_values_to_be_between" in tipos_fallidos
    assert "expect_column_values_to_be_in_set" in tipos_fallidos
    assert "expect_column_values_to_not_be_null" in tipos_fallidos


def test_el_nivel_es_coherente_con_la_probabilidad(predicciones: pd.DataFrame) -> None:
    """El nivel categorico debe derivarse de la probabilidad, no ir por libre.

    Great Expectations valida cada columna por separado y no puede expresar esta
    relacion entre dos columnas, pero es justo donde se cuelan los errores de
    postproceso: el mapa pinta `nivel` mientras el asistente NLQ razona sobre
    `probabilidad`, y si discrepan la plataforma se contradice a si misma.
    """
    # right=False hace los intervalos [0,0.4), [0.4,0.7), [0.7,1]; el limite
    # superior se pasa de 1.0 para que una probabilidad de exactamente 1.0 caiga
    # en 'alto' y no quede fuera de todos los bins como NaN.
    esperado = pd.cut(
        predicciones["probabilidad"],
        bins=[0.0, 0.4, 0.7, 1.001],
        labels=NIVELES_VALIDOS,
        right=False,
    ).astype(str)

    discrepancias = predicciones.loc[predicciones["nivel"] != esperado, ["zona_id", "franja", "probabilidad", "nivel"]]

    assert discrepancias.empty, (
        f"{len(discrepancias)} fila(s) con nivel incoherente con su probabilidad:\n"
        f"{discrepancias.head(10).to_string(index=False)}"
    )


def test_no_hay_predicciones_duplicadas(predicciones: pd.DataFrame) -> None:
    """Una zona/franja/fecha solo puede tener una prediccion vigente.

    Un duplicado no rompe ninguna restriccion de la tabla (la PK es un BIGSERIAL),
    pero hace que el mapa muestre dos riesgos distintos para la misma celda
    segun cual gane la carrera en el frontend.
    """
    duplicados = predicciones.duplicated(subset=["zona_id", "franja", "fecha_objetivo"])

    assert not duplicados.any(), (
        f"{int(duplicados.sum())} prediccion(es) duplicada(s) para la misma zona, franja y fecha."
    )
