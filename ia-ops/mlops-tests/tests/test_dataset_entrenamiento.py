"""Validacion del dataset antes de entrenar (HT-48 CA1).

Si alguna de estas pruebas falla, el pipeline MLOps se detiene y no se entrena.
Es deliberado: un modelo entrenado sobre datos rotos no falla de forma visible,
simplemente toma peores decisiones sobre patrullaje sin que nadie lo note.
"""

from __future__ import annotations

import pandas as pd
import pytest

from expectativas.suite_dataset_entrenamiento import (
    DISTRITOS_ESPERADOS,
    FILAS_MINIMAS,
    LIMA_LAT,
    LIMA_LNG,
    REPORTES_MINIMOS_POR_DISTRITO,
    validar,
)

# Fecha de corte del lote de referencia. Fija y no "hoy": una fecha dinamica
# haria que la prueba cambiara de significado cada dia, y el fixture esta
# generado contra esta misma constante (datos/generar_dataset_entrenamiento.py).
FECHA_CORTE = pd.Timestamp("2026-10-05")
ARRANQUE_PROYECTO = pd.Timestamp("2026-01-01")


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


def test_el_dataset_cumple_el_contrato(dataset_entrenamiento: pd.DataFrame) -> None:
    resultado = validar(dataset_entrenamiento)

    assert resultado.success, (
        "El dataset de entrenamiento no cumple el contrato:\n  - "
        + "\n  - ".join(_expectativas_fallidas(resultado))
    )


def test_el_volumen_alcanza_el_minimo(dataset_entrenamiento: pd.DataFrame) -> None:
    assert len(dataset_entrenamiento) >= FILAS_MINIMAS, (
        f"Solo {len(dataset_entrenamiento)} reportes, por debajo del minimo de {FILAS_MINIMAS}."
    )


def test_cobertura_suficiente_en_cada_distrito(dataset_entrenamiento: pd.DataFrame) -> None:
    """Cada distrito necesita reportes suficientes para aportar senal.

    Great Expectations comprueba que los distritos esten presentes, pero no
    cuantos reportes trae cada uno: un distrito con tres reportes figura en el
    dataset y aun asi no ensena nada al modelo.
    """
    conteo = dataset_entrenamiento["distrito"].value_counts()

    ausentes = sorted(set(DISTRITOS_ESPERADOS) - set(conteo.index))
    assert not ausentes, f"Distritos sin ningun reporte: {', '.join(ausentes)}"

    escasos = conteo[conteo < REPORTES_MINIMOS_POR_DISTRITO]
    assert escasos.empty, (
        f"Distritos por debajo de {REPORTES_MINIMOS_POR_DISTRITO} reportes:\n"
        f"{escasos.to_string()}"
    )


def test_las_fechas_son_validas(dataset_entrenamiento: pd.DataFrame) -> None:
    """Sin fechas futuras ni anteriores al arranque del proyecto.

    Una fecha futura delata un reloj mal configurado o un parseo de formato
    equivocado (dia/mes invertidos), y arrastra al modelo a aprender
    estacionalidad que no existe.
    """
    fechas = pd.to_datetime(dataset_entrenamiento["created_at"], errors="coerce")

    invalidas = int(fechas.isna().sum())
    assert invalidas == 0, f"{invalidas} fecha(s) no se pudieron interpretar."

    futuras = fechas[fechas > FECHA_CORTE]
    assert futuras.empty, f"{len(futuras)} reporte(s) con fecha posterior a {FECHA_CORTE.date()}."

    antiguas = fechas[fechas < ARRANQUE_PROYECTO]
    assert antiguas.empty, (
        f"{len(antiguas)} reporte(s) anteriores a {ARRANQUE_PROYECTO.date()}."
    )


def test_las_coordenadas_caen_dentro_de_lima(dataset_entrenamiento: pd.DataFrame) -> None:
    fuera = dataset_entrenamiento[
        ~dataset_entrenamiento["latitude"].between(*LIMA_LAT)
        | ~dataset_entrenamiento["longitude"].between(*LIMA_LNG)
    ]

    assert fuera.empty, (
        f"{len(fuera)} reporte(s) con coordenadas fuera de Lima:\n"
        f"{fuera[['id', 'distrito', 'latitude', 'longitude']].head(10).to_string(index=False)}"
    )


@pytest.mark.parametrize(
    "tipo_de_defecto",
    [
        "expect_column_values_to_be_between",
        "expect_column_values_to_be_in_set",
        "expect_column_values_to_not_be_null",
        "expect_column_distinct_values_to_contain_set",
    ],
)
def test_la_suite_detiene_un_dataset_invalido(
    dataset_entrenamiento_invalido: pd.DataFrame, tipo_de_defecto: str
) -> None:
    """Meta-prueba: la suite debe marcar cada clase de defecto, no solo una.

    El fixture invalido trae un defecto de cada tipo que nombra el criterio de
    aceptacion. Comprobar solo que la validacion falla no bastaria: podria estar
    detectando el nulo e ignorando las coordenadas fuera de Lima.
    """
    resultado = validar(dataset_entrenamiento_invalido)

    assert not resultado.success, "La suite dio por bueno un dataset invalido."

    fallidas = {item.expectation_config.type for item in resultado.results if not item.success}
    assert tipo_de_defecto in fallidas, (
        f"La suite no detecto el defecto de tipo '{tipo_de_defecto}'. Detecto: {sorted(fallidas)}"
    )
