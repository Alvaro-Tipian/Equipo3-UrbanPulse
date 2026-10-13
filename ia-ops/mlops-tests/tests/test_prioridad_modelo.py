"""Calidad y equidad del modelo de priorizacion (HT-48 CA2).

Tres cosas, que el criterio de aceptacion pide juntas porque se compensan entre
si: un modelo puede subir la exactitud global y a la vez empeorar para un
distrito concreto, y mirar solo el promedio no lo revelaria.

1. Metrica minima absoluta.
2. No empeorar frente a la version en produccion (el campeon).
3. Que la prioridad no cambie de forma desigual entre distritos o tipos de
   incidente.

Sobre la equidad: NO se usa paridad demografica. Exigir que la prioridad alta se
reparta por igual entre tipos de incidente obligaria al modelo a priorizar un
atasco igual que un atropello, que es justo lo contrario de lo que debe hacer.
Lo que si debe repartirse por igual es el ERROR: el modelo tiene que acertar con
la misma frecuencia en Comas que en San Isidro, y con los baches igual que con
los choques. Esa es la metrica que se mide aqui.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

EXACTITUD_MINIMA = 0.85

# Margen al comparar contra produccion. Absorbe el ruido normal entre lotes de
# evaluacion sin dejar pasar una degradacion real.
TOLERANCIA_REGRESION = 0.02

# Diferencia maxima admitida entre el grupo donde el modelo mas se equivoca y
# aquel donde menos. Se mide como brecha absoluta y no como cociente: con un
# grupo de error cero el cociente se va a cero y la prueba dejaria de significar
# nada, cuando un grupo sin errores es exactamente lo que se quiere.
BRECHA_ERROR_MAXIMA = 0.10

ATRIBUTOS_PROTEGIDOS = ["distrito", "incident_type"]

RUTA_METRICAS_PRODUCCION = Path(__file__).parent.parent / "datos" / "metricas_produccion.json"

# Minimo de filas por grupo para que una tasa sea interpretable.
MINIMO_POR_GRUPO = 20


def exactitud(predicciones: pd.DataFrame) -> float:
    return float((predicciones["prioridad_real"] == predicciones["prioridad_predicha"]).mean())


def tasa_de_error_por_grupo(predicciones: pd.DataFrame, atributo: str) -> pd.Series:
    datos = predicciones.assign(
        fallo=predicciones["prioridad_real"] != predicciones["prioridad_predicha"]
    )
    grupos = datos.groupby(atributo)
    return grupos["fallo"].mean()[grupos.size() >= MINIMO_POR_GRUPO]


def tasa_de_subprioridad_por_grupo(predicciones: pd.DataFrame, atributo: str) -> pd.Series:
    """Proporcion de reportes a los que el modelo asigna MENOS prioridad de la real.

    Los dos sentidos del error no duelen igual: sobrevalorar gasta una patrulla,
    subvalorar deja sin atender una emergencia real. Esta metrica aisla el lado
    que hace dano.
    """
    datos = predicciones.assign(
        subvalorado=predicciones["prioridad_predicha"] < predicciones["prioridad_real"]
    )
    grupos = datos.groupby(atributo)
    return grupos["subvalorado"].mean()[grupos.size() >= MINIMO_POR_GRUPO]


def brecha(tasas: pd.Series) -> float:
    return 0.0 if tasas.empty else float(tasas.max() - tasas.min())


def _formatear(tasas: pd.Series) -> str:
    peores = tasas.sort_values(ascending=False).head(4)
    return ", ".join(f"{grupo}={valor:.3f}" for grupo, valor in peores.items())


@pytest.fixture(scope="session")
def metricas_produccion() -> dict:
    if not RUTA_METRICAS_PRODUCCION.exists():
        pytest.skip(
            "No hay metricas del modelo en produccion todavia "
            f"({RUTA_METRICAS_PRODUCCION.name}); no hay contra que comparar."
        )
    return json.loads(RUTA_METRICAS_PRODUCCION.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Metrica minima y regresion frente a produccion
# ---------------------------------------------------------------------------

def test_exactitud_alcanza_el_minimo(prioridades: pd.DataFrame) -> None:
    obtenida = exactitud(prioridades)

    assert obtenida >= EXACTITUD_MINIMA, (
        f"Exactitud {obtenida:.3f} por debajo del minimo {EXACTITUD_MINIMA}."
    )


def test_no_empeora_frente_a_produccion(
    prioridades: pd.DataFrame, metricas_produccion: dict
) -> None:
    obtenida = exactitud(prioridades)
    campeona = metricas_produccion["exactitud"]
    piso = campeona - TOLERANCIA_REGRESION

    assert obtenida >= piso, (
        f"Regresion frente a produccion: el candidato obtiene {obtenida:.3f} y el modelo "
        f"{metricas_produccion['model_version']} obtiene {campeona:.3f} "
        f"(piso admitido {piso:.3f})."
    )


@pytest.mark.parametrize("atributo", ATRIBUTOS_PROTEGIDOS)
def test_la_equidad_no_empeora_frente_a_produccion(
    prioridades: pd.DataFrame, metricas_produccion: dict, atributo: str
) -> None:
    """Un modelo mas exacto en promedio puede serlo a costa de un distrito."""
    clave = f"brecha_error_por_{'tipo_incidente' if atributo == 'incident_type' else atributo}"
    if clave not in metricas_produccion:
        pytest.skip(f"Produccion no registra '{clave}'; no hay contra que comparar.")

    obtenida = brecha(tasa_de_error_por_grupo(prioridades, atributo))
    techo = metricas_produccion[clave] + TOLERANCIA_REGRESION

    assert obtenida <= techo, (
        f"La brecha de error por {atributo} empeoro: {obtenida:.3f} frente a "
        f"{metricas_produccion[clave]:.3f} en produccion (techo admitido {techo:.3f})."
    )


# ---------------------------------------------------------------------------
# Equidad entre distritos y tipos de incidente
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("atributo", ATRIBUTOS_PROTEGIDOS)
def test_paridad_de_error(prioridades: pd.DataFrame, atributo: str) -> None:
    tasas = tasa_de_error_por_grupo(prioridades, atributo)
    diferencia = brecha(tasas)

    assert diferencia <= BRECHA_ERROR_MAXIMA, (
        f"El modelo se equivoca de forma desigual segun {atributo}: brecha {diferencia:.3f} "
        f"por encima del maximo {BRECHA_ERROR_MAXIMA}. Peores grupos: {_formatear(tasas)}"
    )


@pytest.mark.parametrize("atributo", ATRIBUTOS_PROTEGIDOS)
def test_paridad_de_subprioridad(prioridades: pd.DataFrame, atributo: str) -> None:
    tasas = tasa_de_subprioridad_por_grupo(prioridades, atributo)
    diferencia = brecha(tasas)

    assert diferencia <= BRECHA_ERROR_MAXIMA, (
        f"Hay grupos cuyos reportes se subvaloran mas que otros segun {atributo}: "
        f"brecha {diferencia:.3f} por encima del maximo {BRECHA_ERROR_MAXIMA}. "
        f"Peores grupos: {_formatear(tasas)}"
    )


# ---------------------------------------------------------------------------
# Meta-pruebas: el detector debe marcar el lote sesgado
# ---------------------------------------------------------------------------

def test_el_detector_marca_el_sesgo_por_distrito(prioridades_sesgadas: pd.DataFrame) -> None:
    diferencia = brecha(tasa_de_error_por_grupo(prioridades_sesgadas, "distrito"))

    assert diferencia > BRECHA_ERROR_MAXIMA, (
        f"El detector dio por bueno un lote sesgado por distrito: brecha de solo {diferencia:.3f}."
    )


def test_el_detector_marca_el_sesgo_por_tipo(
    prioridades_sesgadas_tipo: pd.DataFrame,
) -> None:
    """Cada atributo se prueba con el lote sesgado en ESE atributo.

    Usar el lote sesgado por distrito para probar el detector por tipo medira
    solo el rebote del primer sesgo sobre las categorias, que resulta quedar
    justo en el umbral: la prueba pasaria o fallaria por un artefacto, no porque
    el detector funcione.
    """
    diferencia = brecha(tasa_de_error_por_grupo(prioridades_sesgadas_tipo, "incident_type"))

    assert diferencia > BRECHA_ERROR_MAXIMA, (
        f"El detector dio por bueno un lote sesgado por tipo: brecha de solo {diferencia:.3f}."
    )


def test_el_detector_marca_la_subprioridad_sistematica(
    prioridades_sesgadas_tipo: pd.DataFrame,
) -> None:
    """Enterrar una categoria es subvaloracion pura: el detector debe verlo."""
    diferencia = brecha(tasa_de_subprioridad_por_grupo(prioridades_sesgadas_tipo, "incident_type"))

    assert diferencia > BRECHA_ERROR_MAXIMA, (
        f"No se detecto la subvaloracion sistematica de una categoria: brecha {diferencia:.3f}."
    )


@pytest.mark.parametrize("lote", ["prioridades_sesgadas", "prioridades_sesgadas_tipo"])
def test_los_lotes_sesgados_caen_en_exactitud(lote: str, request) -> None:
    """Confirma que el sesgo inyectado degrada de verdad el modelo.

    Si un lote sesgado mantuviera la exactitud, el sesgo seria cosmetico y las
    meta-pruebas de equidad no estarian demostrando gran cosa.
    """
    assert exactitud(request.getfixturevalue(lote)) < EXACTITUD_MINIMA
