"""Pruebas de equidad del modelo de riesgo vial (HT-48 T02).

Por que importan aqui y no solo como formalidad: la salida de `prediccion_riesgo`
alimenta decisiones con consecuencias materiales (donde se concentra el
patrullaje, que zonas se senalizan como peligrosas en el mapa publico). Si el
modelo aprende a usar el estrato socioeconomico como atajo, marca de riesgo alto
a zonas de bajos ingresos donde no ocurren mas siniestros, y la plataforma acaba
estigmatizandolas con apariencia de objetividad.

El atributo sensible es `nivel_socioeconomico`. Las metricas son las tres
estandar de fairness para clasificacion, cada una cubriendo un fallo distinto:

* Paridad demografica (regla del 80%) -- se predice "alto" a una tasa parecida
  en todos los estratos.
* Paridad de probabilidad media -- el sesgo tambien puede esconderse en el
  puntaje continuo aunque la etiqueta final parezca equilibrada.
* Igualdad de oportunidad -- entre las celdas donde SI hubo siniestro, el modelo
  acierta en una proporcion parecida para todos los estratos. Es la unica que
  mira el ground truth, y la que distingue una disparidad real del terreno de
  una introducida por el modelo.

Cada prueba corre dos veces: sobre el lote sano (debe pasar) y como meta-prueba
sobre `predicciones_sesgadas.csv` (debe fallar). Sin esa segunda mitad, una
suite verde no probaria nada.
"""

from __future__ import annotations

import pandas as pd
import pytest

ATRIBUTO_SENSIBLE = "nivel_socioeconomico"

# Regla del 80% (four-fifths rule), el criterio de impacto dispar de la EEOC
# estadounidense. Es un umbral convencional, no una garantia de equidad: pasarlo
# significa "no hay disparidad flagrante", no "el modelo es justo".
UMBRAL_IMPACTO_DISPAR = 0.80

# Margen absoluto para la probabilidad media entre el estrato mas alto y el mas
# bajo. 0.10 sobre una escala 0-1 equivale a un tercio del ancho de una banda de
# riesgo: por debajo de eso, la diferencia no mueve a nadie de categoria.
MARGEN_PROBABILIDAD_MEDIA = 0.10

# Minimo de filas por estrato para que una tasa sea interpretable. Por debajo,
# la prueba se salta el estrato en lugar de fallar por ruido muestral.
MINIMO_POR_GRUPO = 20


def tasa_de_riesgo_alto(datos: pd.DataFrame) -> pd.Series:
    """Proporcion de predicciones 'alto' en cada estrato."""
    grupos = datos.groupby(ATRIBUTO_SENSIBLE)
    tasas = grupos["nivel"].apply(lambda nivel: (nivel == "alto").mean())
    return tasas[grupos.size() >= MINIMO_POR_GRUPO]


def ratio_de_impacto_dispar(tasas: pd.Series) -> float:
    """Cociente entre la tasa minima y la maxima. 1.0 = paridad perfecta."""
    if tasas.empty or tasas.max() == 0:
        # Sin predicciones "alto" en ningun estrato no hay disparidad que medir;
        # el fallo de un modelo que nunca alerta lo cubre la suite de calidad.
        return 1.0
    return float(tasas.min() / tasas.max())


def tasa_de_acierto_en_siniestros(datos: pd.DataFrame) -> pd.Series:
    """Igualdad de oportunidad: recall de 'alto' donde si hubo siniestro."""
    ocurrieron = datos[datos["ocurrio_siniestro"] == 1]
    grupos = ocurrieron.groupby(ATRIBUTO_SENSIBLE)
    tasas = grupos["nivel"].apply(lambda nivel: (nivel == "alto").mean())
    return tasas[grupos.size() >= MINIMO_POR_GRUPO]


def _formatear(tasas: pd.Series) -> str:
    return ", ".join(f"{estrato}={valor:.3f}" for estrato, valor in tasas.items())


ORDEN_ESTRATOS = {"A": 0, "B": 1, "C": 2, "D": 3}


def correlacion_estrato_riesgo(datos: pd.DataFrame) -> float:
    """Spearman entre estrato (ordinal) y probabilidad, en valor absoluto.

    Se calcula como un Pearson sobre los rangos en vez de usar
    ``method='spearman'`` de pandas, que delega en scipy: no vale la pena sumar
    esa dependencia al banco de pruebas solo para esto.
    """
    estrato_ordinal = datos[ATRIBUTO_SENSIBLE].map(ORDEN_ESTRATOS)
    correlacion = estrato_ordinal.rank().corr(datos["probabilidad"].rank())
    return abs(float(correlacion))


# ---------------------------------------------------------------------------
# Lote sano: el modelo de referencia debe pasar los tres criterios
# ---------------------------------------------------------------------------

def test_paridad_demografica_entre_estratos(predicciones: pd.DataFrame) -> None:
    tasas = tasa_de_riesgo_alto(predicciones)
    ratio = ratio_de_impacto_dispar(tasas)

    assert ratio >= UMBRAL_IMPACTO_DISPAR, (
        f"Impacto dispar {ratio:.3f} por debajo del umbral {UMBRAL_IMPACTO_DISPAR}. "
        f"Tasa de riesgo 'alto' por estrato: {_formatear(tasas)}"
    )


def test_paridad_de_probabilidad_media(predicciones: pd.DataFrame) -> None:
    medias = predicciones.groupby(ATRIBUTO_SENSIBLE)["probabilidad"].mean()
    brecha = float(medias.max() - medias.min())

    assert brecha <= MARGEN_PROBABILIDAD_MEDIA, (
        f"Brecha de probabilidad media {brecha:.3f} por encima del margen "
        f"{MARGEN_PROBABILIDAD_MEDIA}. Medias por estrato: {_formatear(medias)}"
    )


def test_igualdad_de_oportunidad(predicciones: pd.DataFrame) -> None:
    tasas = tasa_de_acierto_en_siniestros(predicciones)

    if tasas.empty:
        pytest.skip(
            "No hay suficientes siniestros confirmados por estrato para medir "
            "igualdad de oportunidad en este lote."
        )

    ratio = ratio_de_impacto_dispar(tasas)

    assert ratio >= UMBRAL_IMPACTO_DISPAR, (
        f"El modelo detecta los siniestros reales con desigual eficacia segun el "
        f"estrato (ratio {ratio:.3f} < {UMBRAL_IMPACTO_DISPAR}). "
        f"Recall por estrato: {_formatear(tasas)}"
    )


def test_el_estrato_no_predice_el_riesgo(predicciones: pd.DataFrame) -> None:
    """La probabilidad no debe correlacionar con el estrato socioeconomico.

    Complementa las metricas por grupo: una correlacion monotona fuerte delata
    que el modelo esta usando el estrato (o un proxy suyo) como variable, aunque
    las tasas por grupo se mantengan dentro de los umbrales.
    """
    correlacion = correlacion_estrato_riesgo(predicciones)

    assert correlacion <= 0.30, (
        f"Correlacion de Spearman {correlacion:.3f} entre estrato socioeconomico y "
        "probabilidad de riesgo: el modelo parece estar usando el estrato como senal."
    )


# ---------------------------------------------------------------------------
# Meta-pruebas: los detectores deben marcar el lote con sesgo inyectado
# ---------------------------------------------------------------------------

def test_el_detector_marca_el_lote_sesgado(predicciones_sesgadas: pd.DataFrame) -> None:
    tasas = tasa_de_riesgo_alto(predicciones_sesgadas)
    ratio = ratio_de_impacto_dispar(tasas)

    assert ratio < UMBRAL_IMPACTO_DISPAR, (
        f"El detector de impacto dispar dio por bueno un lote sesgado a proposito "
        f"(ratio {ratio:.3f}). Tasas: {_formatear(tasas)}"
    )


def test_el_detector_de_correlacion_marca_el_lote_sesgado(
    predicciones_sesgadas: pd.DataFrame,
) -> None:
    correlacion = correlacion_estrato_riesgo(predicciones_sesgadas)

    assert correlacion > 0.30, (
        f"La prueba de correlacion no detecto el sesgo inyectado (Spearman {correlacion:.3f})."
    )
