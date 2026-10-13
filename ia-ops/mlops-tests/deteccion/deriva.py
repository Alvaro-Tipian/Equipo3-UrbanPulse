"""Deteccion de deriva del modelo de riesgo (HT-48 CA5).

Compara la distribucion de un lote de predicciones contra el lote de referencia
con el que se valido el modelo. Las validaciones fila a fila no sirven aqui: en
una deriva tipica cada prediccion sigue siendo valida por separado -- rango
correcto, nivel coherente, sin nulos -- y lo que cambio es la forma del conjunto.

La metrica es el PSI (Population Stability Index), el estandar de la industria
para esto. Compara la proporcion de casos que cae en cada tramo:

    PSI = suma( (actual_i - esperado_i) * ln(actual_i / esperado_i) )

Este modulo produce la SENAL. Abrir el ticket en Jira Service Management y
disparar el reentrenamiento es trabajo de HT-49
(.github/workflows/ml-monitoring.yml): `construir_alerta` devuelve el payload
que ese flujo consume.

SIN DEPENDENCIAS EXTERNAS, a proposito. ia-ops/scripts/monitor_drift.py importa
de aqui y lo ejecuta un workflow que no hace `pip install`, asi que todo el
modulo tiene que funcionar con la libreria estandar. Acepta cualquier iterable
de numeros, incluida una Series de pandas.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone

# Tramos de probabilidad. Los dos primeros cortes son las fronteras entre
# niveles de riesgo (0.4 y 0.7), para que un PSI alto se pueda leer como
# "se movieron casos de un nivel a otro" y no solo como un numero.
TRAMOS = [0.0, 0.2, 0.4, 0.55, 0.7, 0.85, 1.0]

UMBRAL_DERIVA_MODERADA = 0.10

# 0.20 es el umbral que ya usaba el equipo en ia-ops/scripts/monitor_drift.py y
# en el quality gate de HT-47. La convencion de credit scoring, de donde viene
# el PSI, situa el corte en 0.25; se adopta el del equipo para que el proyecto
# tenga un unico numero y no dos criterios que se contradigan.
UMBRAL_DERIVA_ALTA = 0.20

# Suelo para evitar divisiones por cero y logaritmos de cero cuando un tramo se
# queda vacio en uno de los dos lotes.
EPSILON = 1e-6


@dataclass
class ResultadoDeriva:
    psi: float
    severidad: str
    hay_deriva: bool
    variable: str
    por_tramo: dict[str, float] = field(default_factory=dict)


def _indice_de_tramo(valor: float) -> int:
    for indice in range(len(TRAMOS) - 1):
        if valor < TRAMOS[indice + 1]:
            return indice
    return len(TRAMOS) - 2


def _proporciones(valores: Iterable[float]) -> list[float]:
    conteo = [0] * (len(TRAMOS) - 1)
    total = 0
    for valor in valores:
        conteo[_indice_de_tramo(float(valor))] += 1
        total += 1

    total = max(total, 1)
    return [max(c / total, EPSILON) for c in conteo]


def calcular_psi(referencia: Iterable[float], actual: Iterable[float]) -> float:
    esperado = _proporciones(referencia)
    observado = _proporciones(actual)
    return float(sum((o - e) * math.log(o / e) for e, o in zip(esperado, observado)))


def clasificar_severidad(psi: float) -> str:
    if psi >= UMBRAL_DERIVA_ALTA:
        return "alta"
    if psi >= UMBRAL_DERIVA_MODERADA:
        return "moderada"
    return "ninguna"


def evaluar_deriva(
    referencia: Iterable[float], actual: Iterable[float], variable: str = "probabilidad"
) -> ResultadoDeriva:
    # Se materializan por si llegan generadores: se recorren dos veces.
    referencia = list(referencia)
    actual = list(actual)

    psi = calcular_psi(referencia, actual)
    esperado = _proporciones(referencia)
    observado = _proporciones(actual)

    por_tramo = {
        f"{TRAMOS[i]:.2f}-{TRAMOS[i + 1]:.2f}": round(observado[i] - esperado[i], 4)
        for i in range(len(TRAMOS) - 1)
    }

    severidad = clasificar_severidad(psi)

    return ResultadoDeriva(
        psi=round(psi, 4),
        severidad=severidad,
        # Solo la deriva alta se considera accionable. Con el umbral moderado se
        # abririan tickets por fluctuacion estacional normal, y un canal de
        # alertas que grita todos los meses deja de leerse.
        hay_deriva=severidad == "alta",
        variable=variable,
        por_tramo=por_tramo,
    )


def construir_alerta(resultado: ResultadoDeriva, model_version: str) -> dict:
    """Payload que consume el flujo de monitoreo de HT-49.

    Lleva todo lo necesario para abrir el ticket y lanzar el reentrenamiento sin
    volver a consultar nada: quien deriva, cuanto, desde cuando y que hacer.
    """
    tramo_mas_movido = max(resultado.por_tramo.items(), key=lambda par: abs(par[1]))

    return {
        "tipo": "deriva_modelo",
        "hay_deriva": resultado.hay_deriva,
        "severidad": resultado.severidad,
        "variable": resultado.variable,
        "psi": resultado.psi,
        "umbral": UMBRAL_DERIVA_ALTA,
        "model_version": model_version,
        "detectado_en": datetime.now(timezone.utc).isoformat(),
        "accion_requerida": "reentrenar" if resultado.hay_deriva else "ninguna",
        "resumen": (
            f"El PSI de '{resultado.variable}' es {resultado.psi} "
            f"(umbral {UMBRAL_DERIVA_ALTA}). El tramo {tramo_mas_movido[0]} cambio "
            f"{tramo_mas_movido[1]:+.1%} respecto al lote de referencia del modelo "
            f"{model_version}."
        ),
        "por_tramo": resultado.por_tramo,
    }
